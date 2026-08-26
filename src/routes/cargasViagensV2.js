import { Router } from "express";
import { pool } from "../db/pool.js";
import { clientPool } from "../db/clientPool.js";
import { tableName } from "../config.js";

export const cargasViagensV2Router = Router();

const CARGAS = () => tableName("cargas_v2");
const VIAGENS = () => tableName("viagens_v2");
const VINCULOS = () => tableName("viagem_cargas_v2");
const ROTAS = () => tableName("carga_rotas_v2");
const DOCUMENTOS = () => tableName("carga_documentos_v2");
const APROVACAO_AUDITORIA = () => tableName("carga_aprovacao_auditoria_v2");
const APPROVAL_STATUSES = new Set(["rascunho", "aguardando_aprovacao", "aprovada", "correcao_solicitada", "reprovada", "cancelada"]);
const canApprove = (user) => Boolean(user?.admin || user?.permissions?.["aprovar-viagens"]);

const EMPTY_FINANCIAL = Object.freeze({
  status: "sem_cte",
  titulos: 0,
  valorTotal: 0,
  valorAberto: 0,
  ctes: 0,
  parcelas: [],
});

function text(value, fallback = null) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function number(value, fallback = 0) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function date(value) {
  return text(value, new Date().toISOString().slice(0, 10));
}

function pagination(query = {}) {
  const requestedPage = Number.parseInt(query.page, 10);
  const requestedSize = Number.parseInt(query.pageSize, 10);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pageSize = Number.isInteger(requestedSize) ? Math.min(100, Math.max(10, requestedSize)) : 25;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function auditUser(user = {}) {
  return {
    id: Number.isFinite(Number(user.id)) ? Number(user.id) : null,
    login: text(user.login || user.email),
  };
}

function isoDate(value) {
  if (!value) return "";
  return value.toISOString?.().slice(0, 10) || String(value).slice(0, 10);
}

function isCte(documento = {}) {
  return String(documento.tipo || documento.tipo_documento || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "") === "CTE";
}

function roundMoney(value) {
  return Math.round((number(value) + Number.EPSILON) * 100) / 100;
}

export function aggregateFinancialStatuses(statuses = [], cteCount = 0) {
  if (!cteCount) return { ...EMPTY_FINANCIAL };
  const valid = statuses.filter(Boolean);
  if (!valid.length) return { ...EMPTY_FINANCIAL, status: "sem_titulo", ctes: cteCount };

  let titulos = valid.reduce((sum, item) => sum + number(item.titulos), 0);
  let valorTotal = roundMoney(valid.reduce((sum, item) => sum + number(item.valorTotal), 0));
  let valorAberto = roundMoney(valid.reduce((sum, item) => sum + number(item.valorAberto), 0));
  const parcelasMap = new Map();
  for (const parcela of valid.flatMap((item) => item.parcelas || [])) {
    const key = parcela.id || `${parcela.empresa}:${parcela.serie}:${parcela.duplicata}:${parcela.parcela}`;
    parcelasMap.set(key, parcela);
  }
  const parcelas = [...parcelasMap.values()].sort((a, b) =>
    String(a.vencimento || "9999-12-31").localeCompare(String(b.vencimento || "9999-12-31")),
  );
  const parcelasAtivas = parcelas.filter((parcela) => parcela.status !== "cancelado");
  if (parcelas.length) {
    titulos = parcelasAtivas.length;
    valorTotal = roundMoney(parcelasAtivas.reduce((sum, parcela) => sum + number(parcela.valorTotal), 0));
    valorAberto = roundMoney(parcelasAtivas.reduce((sum, parcela) => sum + number(parcela.valorAberto), 0));
  }
  const statusSet = new Set(valid.map((item) => item.status));
  let status;
  if (statusSet.has("revisar")) status = "revisar";
  else if (valid.length < cteCount || statusSet.has("sem_titulo")) status = titulos > 0 ? "parcial" : "sem_titulo";
  else if ([...statusSet].every((item) => item === "quitado")) status = "quitado";
  else if (statusSet.has("parcial") || (statusSet.has("quitado") && statusSet.size > 1)) status = "parcial";
  else if (statusSet.has("em_aberto")) status = "em_aberto";
  else status = "sem_titulo";

  return { status, titulos, valorTotal, valorAberto, ctes: cteCount, parcelas };
}

function mapDocumento(row) {
  return {
    id: Number(row.id),
    tipo: row.tipo_documento || "CT-e",
    numero: row.numero_documento || "",
    chave: row.chave_documento || "",
    link: row.link_documento || "",
    observacoes: row.observacoes || "",
  };
}

function mapParada(row) {
  return {
    id: Number(row.id),
    ordem: Number(row.ordem || 0),
    tipo: row.tipo_parada || "entrega",
    cidade: row.cidade || "",
    uf: row.uf || "",
    cliente: row.cliente || "",
    endereco: row.endereco || "",
    nf: row.numero_nota_fiscal || "",
    observacoes: row.observacoes || "",
  };
}

function mapCarga(row) {
  const documentos = Array.isArray(row.documentos) ? row.documentos.filter(Boolean) : [];
  const paradas = Array.isArray(row.paradas) ? row.paradas.filter(Boolean) : [];
  return {
    id: Number(row.id),
    legadoId: row.legado_id ? Number(row.legado_id) : null,
    codigo: row.codigo_carga || `C-${String(row.id).padStart(6, "0")}`,
    data: isoDate(row.data),
    cliente: row.cliente || "",
    clienteFinal: row.cliente_final || "",
    tomadorServico: row.tomador_servico || "",
    vendedor: row.vendedor || "",
    origem: row.cidade_origem || "",
    ufOrigem: row.uf_origem || "",
    destino: row.cidade_destino || "",
    ufDestino: row.uf_destino || "",
    material: row.material || "",
    peso: Number(row.peso_kg || 0),
    valorCliente: Number(row.valor_cliente || 0),
    valorTon: Number(row.peso_kg || 0) > 0
      ? Number(row.valor_cliente || 0) / (Number(row.peso_kg) / 1000)
      : 0,
    condicaoPagamento: row.condicao_pagamento || "",
    custoEstimado: row.custo_estimado === null ? null : Number(row.custo_estimado),
    precoMinimo: row.preco_minimo_calculado === null ? null : Number(row.preco_minimo_calculado),
    precoSugerido: row.preco_sugerido_calculado === null ? null : Number(row.preco_sugerido_calculado),
    margemEstimada: row.margem_estimada === null ? null : Number(row.margem_estimada),
    calculoPreco: row.calculo_preco || {},
    observacoes: row.observacoes || "",
    status: row.status || "aguardando_viagem",
    statusAprovacao: row.status_aprovacao || "rascunho",
    motivoAprovacao: row.motivo_aprovacao || "",
    aprovadoPor: row.aprovado_por_login || "",
    aprovadoEm: row.aprovado_em || null,
    viagemId: row.viagem_id ? Number(row.viagem_id) : null,
    numeroViagem: row.numero_viagem || "",
    placa: row.placa_veiculo || "",
    motorista: row.motorista || "",
    documentos: documentos.map(mapDocumento),
    paradas: paradas.map(mapParada),
    financeiro: row.financeiro || { ...EMPTY_FINANCIAL },
    criadoPor: row.criado_por_login || "",
    atualizadoPor: row.atualizado_por_login || "",
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
  };
}

function mapViagem(row) {
  const cargas = Array.isArray(row.cargas) ? row.cargas.filter(Boolean) : [];
  return {
    id: Number(row.id),
    numero: row.numero_viagem,
    data: isoDate(row.data),
    placa: row.placa_veiculo || "",
    tipoPropriedade: row.tipo_propriedade || "",
    motorista: row.motorista || "",
    km: row.km_viagem === null ? null : Number(row.km_viagem),
    numeroMotorista: row.numero_motorista || "",
    cnh: row.cnh_motorista || "",
    antt: row.antt_veiculo || "",
    contaDeposito: row.conta_deposito || "",
    chavePix: row.chave_pix || "",
    valorMotorista: Number(row.valor_motorista || 0),
    rotaMapsUrl: row.rota_maps_url || "",
    observacoes: row.observacoes || "",
    situacao: row.situacao || "aguardando_cte",
    docs: {
      placas: Boolean(row.doc_placas),
      antt: Boolean(row.doc_antt),
      contaDeposito: Boolean(row.doc_conta_deposito),
      chavePix: Boolean(row.doc_chave_pix),
      cnh: Boolean(row.doc_cnh_motorista),
      consultaMotorista: Boolean(row.doc_consulta_motorista),
      comprovanteResidencia: Boolean(row.doc_comprovante_residencia),
      numeroMotorista: Boolean(row.doc_numero_motorista),
    },
    cargas: cargas.map((carga) => ({
      id: Number(carga.id),
      codigo: carga.codigo || "",
      cliente: carga.cliente || "",
      clienteFinal: carga.clienteFinal || "",
      tomadorServico: carga.tomadorServico || "",
      origem: carga.origem || "",
      ufOrigem: carga.ufOrigem || "",
      destino: carga.destino || "",
      ufDestino: carga.ufDestino || "",
      peso: Number(carga.peso || 0),
      valorCliente: Number(carga.valorCliente || 0),
      status: carga.status || "",
      documentos: Array.isArray(carga.documentos) ? carga.documentos : [],
      financeiro: carga.financeiro || { ...EMPTY_FINANCIAL },
    })),
    criadoPor: row.criado_por_login || "",
    atualizadoPor: row.atualizado_por_login || "",
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
    financeiro: row.financeiro || { ...EMPTY_FINANCIAL },
  };
}

async function savePricingFields(client, cargaId, input = {}) {
  const calculo = input.calculoPreco && typeof input.calculoPreco === "object" ? input.calculoPreco : {};
  await client.query(
    `UPDATE ${CARGAS()} SET custo_estimado=$2,preco_minimo_calculado=$3,preco_sugerido_calculado=$4,
     margem_estimada=$5,calculo_preco=$6::jsonb
     WHERE id=$1`,
    [cargaId, number(calculo.custoEstimado, null), number(calculo.precoMinimo, null),
      number(calculo.precoSugerido, null), number(calculo.margemEstimada, null), JSON.stringify(calculo)],
  );
}

const cargaSelect = () => `
  SELECT c.*, v.id AS viagem_id, v.numero_viagem, v.placa_veiculo, v.motorista,
    COALESCE((
      SELECT JSONB_AGG(TO_JSONB(r) ORDER BY r.ordem, r.id)
       FROM ${ROTAS()} r WHERE r.carga_id = c.id
    ), '[]'::jsonb) AS paradas,
    COALESCE((
      SELECT JSONB_AGG(TO_JSONB(d) ORDER BY d.id)
       FROM ${DOCUMENTOS()} d WHERE d.carga_id = c.id
    ), '[]'::jsonb) AS documentos
  FROM ${CARGAS()} c
   LEFT JOIN ${VINCULOS()} vc ON vc.carga_id = c.id
   LEFT JOIN ${VIAGENS()} v ON v.id = vc.viagem_id
`;

const viagemSelect = () => `
  SELECT v.*,
    COALESCE((
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'id', c.id, 'codigo', c.codigo_carga, 'cliente', c.cliente,
        'clienteFinal', c.cliente_final, 'tomadorServico', c.tomador_servico,
        'origem', c.cidade_origem, 'ufOrigem', c.uf_origem,
        'destino', c.cidade_destino, 'ufDestino', c.uf_destino,
         'peso', c.peso_kg, 'valorCliente', c.valor_cliente, 'status', c.status,
        'documentos', COALESCE((
          SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
            'id', d.id, 'tipo', d.tipo_documento, 'numero', d.numero_documento,
            'chave', d.chave_documento, 'link', d.link_documento,
            'observacoes', d.observacoes
          ) ORDER BY d.id) FROM ${DOCUMENTOS()} d WHERE d.carga_id = c.id
        ), '[]'::jsonb)
      ) ORDER BY c.id)
       FROM ${VINCULOS()} vc
       JOIN ${CARGAS()} c ON c.id = vc.carga_id
       WHERE vc.viagem_id = v.id
    ), '[]'::jsonb) AS cargas
  FROM ${VIAGENS()} v
`;

async function financialByCteDocuments(cargas = []) {
  const references = cargas.flatMap((carga) => (carga.documentos || []).filter(isCte));
  const keys = [...new Set(references.map((item) => text(item.chave)).filter(Boolean))];
  const numbers = [...new Set(references.map((item) => text(item.numero)).filter(Boolean).map((value) => String(Number(value))))];
  if (!keys.length && !numbers.length) return { byKey: new Map(), byNumber: new Map() };

  const { rows } = await clientPool.query(`
    WITH cte_documentos AS (
      SELECT DISTINCT
        con.empresacon,
        con.seriecon,
        con.codigocon,
        con.codigocon::text AS numero,
        NULLIF(TRIM(con.chavectecon), '') AS chave
      FROM logistica.conhecimentos con
      WHERE COALESCE(con.statuscon, 0) <> 3
        AND (
          (CARDINALITY($1::text[]) > 0 AND TRIM(COALESCE(con.chavectecon, '')) = ANY($1::text[]))
          OR (CARDINALITY($2::text[]) > 0 AND con.codigocon::text = ANY($2::text[]))
        )
    ),
    recebimentos AS (
      SELECT
        empresarcb, seriercb, duplicatarcb, parcelarcb,
        MAX(datarecebimentorcb)::date AS data_recebimento,
        COALESCE(SUM(valorrecebidorcb), 0)::numeric AS valor_recebido
      FROM financeiro.receberrecebimentos
      GROUP BY empresarcb, seriercb, duplicatarcb, parcelarcb
    ),
    vinculos AS (
      SELECT DISTINCT
        cd.empresacon, cd.seriecon, cd.codigocon, cd.numero, cd.chave,
        rec.empresarec, rec.serierec, rec.duplicatarec, rec.parcelarec,
        rec.statusrec, COALESCE(rec.valorduplicatarec, 0)::numeric AS valor_total,
        COALESCE(rec.valorabertorec, 0)::numeric AS valor_aberto,
        rec.dataemissaorec::date AS data_emissao,
        rec.datavencimentorec::date AS data_vencimento,
        COALESCE(NULLIF(TRIM(rec.documentorec::text), ''), rec.duplicatarec::text) AS documento,
        rcb.data_recebimento,
        COALESCE(rcb.valor_recebido, GREATEST(COALESCE(rec.valorduplicatarec, 0) - COALESCE(rec.valorabertorec, 0), 0))::numeric AS valor_recebido
      FROM cte_documentos cd
      JOIN financeiro.receberconhecimentosvinculados rcv
        ON rcv.empresa = cd.empresacon
       AND rcv.serieconhecimento = cd.seriecon
       AND rcv.codigoconhecimento = cd.codigocon
      JOIN financeiro.receber rec
        ON rec.empresarec = rcv.empresa
       AND rec.serierec = rcv.serie
       AND rec.duplicatarec = rcv.duplicata
      LEFT JOIN recebimentos rcb
        ON rcb.empresarcb = rec.empresarec
       AND rcb.seriercb = rec.serierec
       AND rcb.duplicatarcb = rec.duplicatarec
       AND rcb.parcelarcb = rec.parcelarec

      UNION

      SELECT DISTINCT
        cd.empresacon, cd.seriecon, cd.codigocon, cd.numero, cd.chave,
        rec.empresarec, rec.serierec, rec.duplicatarec, rec.parcelarec,
        rec.statusrec, COALESCE(rec.valorduplicatarec, 0)::numeric AS valor_total,
        COALESCE(rec.valorabertorec, 0)::numeric AS valor_aberto,
        rec.dataemissaorec::date AS data_emissao,
        rec.datavencimentorec::date AS data_vencimento,
        COALESCE(NULLIF(TRIM(rec.documentorec::text), ''), rec.duplicatarec::text) AS documento,
        rcb.data_recebimento,
        COALESCE(rcb.valor_recebido, GREATEST(COALESCE(rec.valorduplicatarec, 0) - COALESCE(rec.valorabertorec, 0), 0))::numeric AS valor_recebido
      FROM cte_documentos cd
      JOIN financeiro.receberconhecimentos rcc
        ON rcc.empresarcc = cd.empresacon
       AND rcc.conhecimentorcc = cd.codigocon
      JOIN financeiro.receber rec
        ON rec.empresarec = rcc.empresarcc
       AND rec.serierec = rcc.seriercc
       AND rec.duplicatarec = rcc.duplicatarcc
       AND rec.parcelarec = rcc.parcelarcc
      LEFT JOIN recebimentos rcb
        ON rcb.empresarcb = rec.empresarec
       AND rcb.seriercb = rec.serierec
       AND rcb.duplicatarcb = rec.duplicatarec
       AND rcb.parcelarcb = rec.parcelarec
    ),
    totais AS (
      SELECT
        cd.empresacon, cd.seriecon, cd.codigocon, cd.numero, cd.chave,
        COUNT(v.duplicatarec) FILTER (WHERE v.statusrec IN (1, 2, 5, 6))::int AS titulos,
        COALESCE(SUM(v.valor_total) FILTER (WHERE v.statusrec IN (1, 2, 5, 6)), 0)::numeric AS valor_total,
        COALESCE(SUM(v.valor_aberto) FILTER (WHERE v.statusrec IN (1, 2, 5, 6)), 0)::numeric AS valor_aberto,
        COUNT(v.duplicatarec) FILTER (WHERE v.statusrec = 2)::int AS quitados,
        COUNT(v.duplicatarec) FILTER (WHERE v.statusrec IN (5, 6))::int AS revisar,
        COALESCE(SUM(GREATEST(v.valor_total - v.valor_aberto, 0)) FILTER (WHERE v.statusrec IN (1, 2, 5, 6)), 0)::numeric AS recebido,
        COALESCE(JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
          'id', v.empresarec || ':' || v.serierec || ':' || v.duplicatarec || ':' || v.parcelarec,
          'empresa', v.empresarec,
          'serie', v.serierec,
          'duplicata', v.duplicatarec,
          'parcela', v.parcelarec,
          'documento', v.documento,
          'emissao', v.data_emissao,
          'vencimento', v.data_vencimento,
          'dataRecebimento', v.data_recebimento,
          'valorTotal', v.valor_total,
          'valorRecebido', v.valor_recebido,
          'valorAberto', v.valor_aberto,
          'status', CASE
            WHEN v.statusrec = 3 THEN 'cancelado'
            WHEN v.statusrec IN (5, 6) THEN 'revisar'
            WHEN v.statusrec = 2 AND v.valor_aberto <= 0.009 THEN 'quitado'
            WHEN v.valor_recebido > 0.009 AND v.valor_aberto > 0.009 THEN 'parcial'
            ELSE 'em_aberto'
          END
        )) FILTER (WHERE v.duplicatarec IS NOT NULL), '[]'::jsonb) AS parcelas
      FROM cte_documentos cd
      LEFT JOIN vinculos v
        ON v.empresacon = cd.empresacon
       AND v.seriecon = cd.seriecon
       AND v.codigocon = cd.codigocon
      GROUP BY cd.empresacon, cd.seriecon, cd.codigocon, cd.numero, cd.chave
    )
    SELECT *, CASE
      WHEN titulos = 0 THEN 'sem_titulo'
      WHEN revisar > 0 THEN 'revisar'
      WHEN valor_aberto <= 0.009 AND quitados = titulos THEN 'quitado'
      WHEN recebido > 0.009 THEN 'parcial'
      ELSE 'em_aberto'
    END AS status_financeiro
    FROM totais
  `, [keys, numbers]);

  const byKey = new Map();
  const byNumber = new Map();
  for (const row of rows) {
    const item = {
      status: row.status_financeiro,
      titulos: number(row.titulos),
      valorTotal: roundMoney(row.valor_total),
      valorAberto: roundMoney(row.valor_aberto),
      ctes: 1,
      parcelas: Array.isArray(row.parcelas) ? row.parcelas.map((parcela) => ({
        ...parcela,
        valorTotal: roundMoney(parcela.valorTotal),
        valorRecebido: roundMoney(parcela.valorRecebido),
        valorAberto: roundMoney(parcela.valorAberto),
      })) : [],
    };
    if (row.chave) byKey.set(String(row.chave).trim(), item);
    if (row.numero) byNumber.set(String(Number(row.numero)), item);
  }
  return { byKey, byNumber };
}

export async function enrichCargasFinancial(cargas = [], logger = null) {
  try {
    const lookup = await financialByCteDocuments(cargas);
    return cargas.map((carga) => {
      const ctes = (carga.documentos || []).filter(isCte);
      const statuses = ctes.map((documento) => {
        const key = text(documento.chave);
        const numero = text(documento.numero);
        return (key && lookup.byKey.get(key))
          || (numero && lookup.byNumber.get(String(Number(numero))))
          || null;
      });
      return { ...carga, financeiro: aggregateFinancialStatuses(statuses, ctes.length) };
    });
  } catch (error) {
    logger?.warn?.({ err: error }, "Falha ao consultar situacao financeira das cargas V2");
    return cargas.map((carga) => ({
      ...carga,
      financeiro: { ...EMPTY_FINANCIAL, status: "indisponivel" },
    }));
  }
}

async function enrichViagensFinancial(viagens = [], logger = null) {
  const flat = viagens.flatMap((viagem) => viagem.cargas || []);
  const enriched = await enrichCargasFinancial(flat, logger);
  const queues = new Map();
  for (const carga of enriched) {
    if (!queues.has(carga.id)) queues.set(carga.id, []);
    queues.get(carga.id).push(carga);
  }
  return viagens.map((viagem) => {
    const cargas = (viagem.cargas || []).map((carga) => queues.get(carga.id)?.shift() || carga);
    const statuses = cargas.filter((carga) => carga.financeiro?.ctes > 0).map((carga) => carga.financeiro);
    const financeiro = aggregateFinancialStatuses(statuses, cargas.length);
    financeiro.ctes = cargas.reduce((sum, carga) => sum + number(carga.financeiro?.ctes), 0);
    return { ...viagem, cargas, financeiro };
  });
}

async function replaceRotas(client, cargaId, paradas = []) {
  await client.query(`DELETE FROM ${ROTAS()} WHERE carga_id=$1`, [cargaId]);
  for (const [index, parada] of (Array.isArray(paradas) ? paradas : []).entries()) {
    await client.query(
      `INSERT INTO ${ROTAS()} (carga_id,ordem,tipo_parada,cidade,uf,cliente,endereco,numero_nota_fiscal,observacoes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [cargaId, number(parada.ordem, index + 1), text(parada.tipo, "entrega"), text(parada.cidade),
        text(parada.uf, "").slice(0, 2).toUpperCase(), text(parada.cliente), text(parada.endereco),
        text(parada.nf || parada.numeroNotaFiscal), text(parada.observacoes || parada.obs)],
    );
  }
}

async function syncViagemStatus(client, viagemId) {
  const current = await client.query(`SELECT situacao FROM ${VIAGENS()} WHERE id=$1`, [viagemId]);
  if (["entregue", "cancelado"].includes(current.rows[0]?.situacao)) return;
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE c.status IN ('em_transito','entregue'))::int AS com_cte,
       COUNT(*) FILTER (WHERE c.status='entregue')::int AS entregues
     FROM ${VINCULOS()} vc JOIN ${CARGAS()} c ON c.id=vc.carga_id WHERE vc.viagem_id=$1`,
    [viagemId],
  );
  const status = rows[0].total > 0 && rows[0].total === rows[0].entregues
    ? "entregue"
    : rows[0].total > 0 && rows[0].total === rows[0].com_cte ? "em_transito" : "aguardando_cte";
  await client.query(`UPDATE ${VIAGENS()} SET situacao=$2,atualizado_em=NOW() WHERE id=$1`, [viagemId, status]);
}

let deliverySyncPromise = null;
let lastDeliverySyncAt = 0;

async function syncDeliveredCargasV2() {
  if (deliverySyncPromise) return deliverySyncPromise;
  if (Date.now() - lastDeliverySyncAt < 60_000) return { updated: 0 };
  deliverySyncPromise = (async () => {
    const pending = await pool.query(`
      SELECT c.id AS carga_id, UPPER(REGEXP_REPLACE(COALESCE(v.placa_veiculo,''),'[^A-Z0-9]','','g')) AS placa,
        NULLIF(TRIM(d.numero_documento),'') AS numero, NULLIF(TRIM(d.chave_documento),'') AS chave
      FROM ${CARGAS()} c
      JOIN ${VINCULOS()} vc ON vc.carga_id=c.id
      JOIN ${VIAGENS()} v ON v.id=vc.viagem_id
      JOIN ${DOCUMENTOS()} d ON d.carga_id=c.id
      WHERE c.status='em_transito'
        AND REGEXP_REPLACE(UPPER(COALESCE(d.tipo_documento,'')),'[^A-Z]','','g')='CTE'
        AND (NULLIF(TRIM(d.numero_documento),'') IS NOT NULL OR NULLIF(TRIM(d.chave_documento),'') IS NOT NULL)
    `);
    if (!pending.rowCount) { lastDeliverySyncAt = Date.now(); return { updated: 0 }; }
    const keys = [...new Set(pending.rows.map((row) => row.chave).filter(Boolean))];
    const numbers = [...new Set(pending.rows.map((row) => row.numero).filter(Boolean).map((value) => String(Number(value))))];
    const delivered = await clientPool.query(`
      SELECT con.codigocon::text AS numero, NULLIF(TRIM(con.chavectecon),'') AS chave,
        UPPER(REGEXP_REPLACE(COALESCE(con.veiculocon::text,''),'[^A-Z0-9]','','g')) AS placa
      FROM logistica.conhecimentos con
      WHERE COALESCE(con.statuscon,0) <> 3
        AND (con.datahoraentregacon IS NOT NULL OR con.dataentregacon IS NOT NULL)
        AND ((CARDINALITY($1::text[]) > 0 AND TRIM(COALESCE(con.chavectecon,'')) = ANY($1::text[]))
          OR (CARDINALITY($2::text[]) > 0 AND con.codigocon::text = ANY($2::text[])))
    `, [keys, numbers]);
    const deliveredKeys = new Set(delivered.rows.map((row) => row.chave).filter(Boolean));
    const deliveredNumberPlates = new Set(delivered.rows.filter((row) => row.placa).map((row) => `${row.numero}|${row.placa}`));
    const cargaIds = [...new Set(pending.rows.filter((row) =>
      (row.chave && deliveredKeys.has(row.chave))
      || (row.numero && row.placa && deliveredNumberPlates.has(`${String(Number(row.numero))}|${row.placa}`)),
    ).map((row) => Number(row.carga_id)))];
    if (!cargaIds.length) { lastDeliverySyncAt = Date.now(); return { updated: 0 }; }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE ${CARGAS()} SET status='entregue',atualizado_em=NOW() WHERE id=ANY($1::bigint[]) AND status='em_transito'`, [cargaIds]);
      const trips = await client.query(`SELECT DISTINCT viagem_id FROM ${VINCULOS()} WHERE carga_id=ANY($1::bigint[])`, [cargaIds]);
      for (const row of trips.rows) await syncViagemStatus(client, row.viagem_id);
      await client.query("COMMIT");
      lastDeliverySyncAt = Date.now();
      return { updated: cargaIds.length };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  })();
  try { return await deliverySyncPromise; }
  finally { deliverySyncPromise = null; }
}

cargasViagensV2Router.get("/cargas-viagens-v2/resumo", async (req, res, next) => {
  try {
    await syncDeliveredCargasV2().catch((error) => req.log?.warn({ err: error }, "Falha ao sincronizar entregas V2"));
    const [localResult, financialRows] = await Promise.all([
      pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM ${CARGAS()}) AS cargas,
        (SELECT COUNT(*)::int FROM ${CARGAS()} WHERE status='aguardando_viagem') AS aguardando_veiculo,
        (SELECT COUNT(DISTINCT carga_id)::int FROM ${VINCULOS()}) AS cargas_vinculadas,
        (SELECT COUNT(*)::int FROM ${CARGAS()} WHERE status='aguardando_cte') AS aguardando_cte,
        (SELECT COUNT(*)::int FROM ${CARGAS()} WHERE status='em_transito') AS cargas_em_transito,
        (SELECT COUNT(*)::int FROM ${CARGAS()} WHERE status='entregue') AS cargas_entregues,
        (SELECT COUNT(*)::int FROM ${VIAGENS()}) AS viagens,
        (SELECT COUNT(*)::int FROM ${VIAGENS()} WHERE situacao='aguardando_cte') AS viagens_aguardando_cte,
        (SELECT COUNT(*)::int FROM ${VIAGENS()} WHERE situacao='em_transito') AS viagens_em_transito,
        (SELECT COUNT(*)::int FROM ${VIAGENS()} WHERE situacao='entregue') AS viagens_entregues
      `),
      pool.query(`
        SELECT c.id, c.status, vc.viagem_id,
          COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
            'tipo', d.tipo_documento, 'numero', d.numero_documento, 'chave', d.chave_documento
          )) FILTER (WHERE d.id IS NOT NULL), '[]'::jsonb) AS documentos
        FROM ${CARGAS()} c
        LEFT JOIN ${VINCULOS()} vc ON vc.carga_id = c.id
        LEFT JOIN ${DOCUMENTOS()} d ON d.carga_id = c.id
          AND REGEXP_REPLACE(UPPER(COALESCE(d.tipo_documento, '')), '[^A-Z]', '', 'g') = 'CTE'
        GROUP BY c.id, c.status, vc.viagem_id
      `),
    ]);
    const financialLoads = await enrichCargasFinancial(financialRows.rows.map((row) => ({
      id: Number(row.id),
      status: row.status,
      viagemId: row.viagem_id ? Number(row.viagem_id) : null,
      documentos: row.documentos || [],
    })), req.log);
    const cargaQuitadas = financialLoads.filter((carga) => carga.financeiro.status === "quitado").length;
    const byTrip = new Map();
    for (const carga of financialLoads.filter((item) => item.viagemId)) {
      if (!byTrip.has(carga.viagemId)) byTrip.set(carga.viagemId, []);
      byTrip.get(carga.viagemId).push(carga);
    }
    const viagensQuitadas = [...byTrip.values()].filter((cargas) =>
      cargas.length > 0 && cargas.every((carga) => carga.financeiro.status === "quitado"),
    ).length;
    res.json({
      ...localResult.rows[0],
      em_transito: localResult.rows[0].cargas_em_transito,
      quitadas: cargaQuitadas,
      viagens_quitadas: viagensQuitadas,
    });
  } catch (error) { next(error); }
});

cargasViagensV2Router.get("/cargas-viagens-v2/filtros", async (_req, res, next) => {
  try {
    const [{ rows }, activeSellers] = await Promise.all([pool.query(`
      SELECT
        ARRAY(SELECT DISTINCT cliente FROM ${CARGAS()} WHERE NULLIF(TRIM(cliente),'') IS NOT NULL ORDER BY cliente) AS empresas,
        ARRAY(SELECT DISTINCT cidade_origem FROM ${CARGAS()} WHERE NULLIF(TRIM(cidade_origem),'') IS NOT NULL ORDER BY cidade_origem) AS origens,
        ARRAY(SELECT DISTINCT uf_origem FROM ${CARGAS()} WHERE NULLIF(TRIM(uf_origem),'') IS NOT NULL ORDER BY uf_origem) AS ufs_origem,
        ARRAY(SELECT DISTINCT cidade_destino FROM ${CARGAS()} WHERE NULLIF(TRIM(cidade_destino),'') IS NOT NULL ORDER BY cidade_destino) AS destinos,
        ARRAY(SELECT DISTINCT uf_destino FROM ${CARGAS()} WHERE NULLIF(TRIM(uf_destino),'') IS NOT NULL ORDER BY uf_destino) AS ufs_destino,
        ARRAY(SELECT DISTINCT material FROM ${CARGAS()} WHERE NULLIF(TRIM(material),'') IS NOT NULL ORDER BY material) AS materiais
    `), clientPool.query(`
      SELECT DISTINCT TRIM(p.nomepes::text) AS nome
      FROM logistica.representantes r
      INNER JOIN gerais.pessoas p ON p.codigorepresentantepes = r.codigorep
      WHERE NULLIF(TRIM(p.nomepes::text), '') IS NOT NULL
        AND p.ativopes::text = 'S'
        AND UPPER(TRIM(p.nomepes::text)) IN ('MAICON STEINBACH', 'MAURICIO STEINBACK')
      ORDER BY nome
    `)]);
    res.json({
      empresas: rows[0].empresas || [],
      origens: rows[0].origens || [],
      ufsOrigem: rows[0].ufs_origem || [],
      destinos: rows[0].destinos || [],
      ufsDestino: rows[0].ufs_destino || [],
      materiais: rows[0].materiais || [],
      vendedores: activeSellers.rows.map((row) => row.nome),
    });
  } catch (error) { next(error); }
});

cargasViagensV2Router.get("/cargas-viagens-v2/cargas", async (req, res, next) => {
  try {
    await syncDeliveredCargasV2().catch((error) => req.log?.warn({ err: error }, "Falha ao sincronizar entregas V2"));
    const values = [];
    const where = [];
    if (text(req.query.status)) {
      values.push(text(req.query.status));
      where.push(`c.status=$${values.length}`);
    }
    if (text(req.query.q)) {
      values.push(`%${text(req.query.q)}%`);
      where.push(`CONCAT_WS(' ',c.codigo_carga,c.cliente,c.cliente_final,c.cidade_origem,c.uf_origem,c.cidade_destino,c.uf_destino,c.material,v.numero_viagem,v.placa_veiculo,v.motorista) ILIKE $${values.length}`);
    }
    const partialFilters = [
      ["empresa", "c.cliente"],
      ["origem", "c.cidade_origem"],
      ["destino", "c.cidade_destino"],
      ["material", "c.material"],
      ["vendedor", "c.vendedor"],
    ];
    for (const [queryKey, column] of partialFilters) {
      if (!text(req.query[queryKey])) continue;
      values.push(`%${text(req.query[queryKey])}%`);
      where.push(`${column} ILIKE $${values.length}`);
    }
    const exactFilters = [
      ["ufOrigem", "c.uf_origem"],
      ["ufDestino", "c.uf_destino"],
    ];
    for (const [queryKey, column] of exactFilters) {
      if (!text(req.query[queryKey])) continue;
      values.push(text(req.query[queryKey]).toUpperCase());
      where.push(`UPPER(${column})=$${values.length}`);
    }
    const financialFilter = text(req.query.financeiro, "").toLowerCase();
    if (financialFilter && financialFilter !== "sem_cte") {
      where.push(`EXISTS (
        SELECT 1 FROM ${DOCUMENTOS()} fd
        WHERE fd.carga_id = c.id
          AND REGEXP_REPLACE(UPPER(COALESCE(fd.tipo_documento, '')), '[^A-Z]', '', 'g') = 'CTE'
      )`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const paged = req.query.page !== undefined || req.query.pageSize !== undefined;
    if (!paged) {
      const { rows } = await pool.query(`${cargaSelect()} ${whereSql} ORDER BY c.data DESC,c.id DESC LIMIT 500`, values);
      const items = await enrichCargasFinancial(rows.map(mapCarga), req.log);
      return res.json(financialFilter ? items.filter((item) => item.financeiro.status === financialFilter) : items);
    }
    const { page, pageSize, offset } = pagination(req.query);
    if (financialFilter) {
      const { rows } = await pool.query(`${cargaSelect()} ${whereSql} ORDER BY c.data DESC,c.id DESC`, values);
      const enriched = await enrichCargasFinancial(rows.map(mapCarga), req.log);
      const filtered = enriched.filter((item) => item.financeiro.status === financialFilter);
      return res.json({
        items: filtered.slice(offset, offset + pageSize),
        total: filtered.length,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
      });
    }
    const countResult = await pool.query(
      `SELECT COUNT(DISTINCT c.id)::int AS total FROM ${CARGAS()} c
       LEFT JOIN ${VINCULOS()} vc ON vc.carga_id=c.id
       LEFT JOIN ${VIAGENS()} v ON v.id=vc.viagem_id ${whereSql}`,
      values,
    );
    const total = Number(countResult.rows[0]?.total || 0);
    const pagedValues = [...values, pageSize, offset];
    const { rows } = await pool.query(
      `${cargaSelect()} ${whereSql} ORDER BY c.data DESC,c.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      pagedValues,
    );
    const items = await enrichCargasFinancial(rows.map(mapCarga), req.log);
    res.json({ items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) { next(error); }
});

cargasViagensV2Router.get("/cargas-viagens-v2/cargas/:id", async (req, res, next) => {
  try {
    const { rows } = await pool.query(`${cargaSelect()} WHERE c.id=$1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Carga nao encontrada." });
    const [item] = await enrichCargasFinancial([mapCarga(rows[0])], req.log);
    res.json(item);
  } catch (error) { next(error); }
});

cargasViagensV2Router.post("/cargas-viagens-v2/cargas", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = req.body || {};
    if (!text(input.cliente) || !text(input.clienteFinal) || !text(input.tomadorServico)
      || !text(input.origem) || !text(input.ufOrigem) || !text(input.destino) || !text(input.ufDestino)) {
      return res.status(400).json({ error: "Informe cliente inicial, cliente final, tomador do servico, origem e destino." });
    }
    const user = auditUser(req.user);
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO ${CARGAS()} (data,cliente,cliente_final,tomador_servico,vendedor,cidade_origem,uf_origem,cidade_destino,uf_destino,material,peso_kg,valor_cliente,condicao_pagamento,observacoes,status,status_aprovacao,criado_por_id,criado_por_login,atualizado_por_id,atualizado_por_login)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'aguardando_viagem',$15,$16,$17,$16,$17) RETURNING id`,
      [date(input.data), text(input.cliente, ""), text(input.clienteFinal), text(input.tomadorServico), text(input.vendedor),
        text(input.origem, ""), text(input.ufOrigem, "").slice(0, 2).toUpperCase(), text(input.destino, ""),
        text(input.ufDestino, "").slice(0, 2).toUpperCase(), text(input.material), number(input.peso),
        number(input.valorCliente), text(input.condicaoPagamento), text(input.observacoes), text(input.statusAprovacao, "rascunho"),
        user.id, user.login],
    );
    const id = rows[0].id;
    await client.query(`UPDATE ${CARGAS()} SET codigo_carga='C-'||LPAD(id::text,6,'0') WHERE id=$1`, [id]);
    await savePricingFields(client, id, input);
    await replaceRotas(client, id, input.paradas);
    await client.query("COMMIT");
    const saved = await pool.query(`${cargaSelect()} WHERE c.id=$1`, [id]);
    const [item] = await enrichCargasFinancial([mapCarga(saved.rows[0])], req.log);
    res.status(201).json(item);
  } catch (error) {
    await client.query("ROLLBACK"); next(error);
  } finally { client.release(); }
});

cargasViagensV2Router.put("/cargas-viagens-v2/cargas/:id", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = req.body || {};
    if (!text(input.cliente) || !text(input.clienteFinal) || !text(input.tomadorServico)
      || !text(input.origem) || !text(input.ufOrigem) || !text(input.destino) || !text(input.ufDestino)) {
      return res.status(400).json({ error: "Informe cliente inicial, cliente final, tomador do servico, origem e destino." });
    }
    const user = auditUser(req.user);
    await client.query("BEGIN");
    const { rowCount } = await client.query(
      `UPDATE ${CARGAS()} SET data=$2,cliente=$3,cliente_final=$4,tomador_servico=$5,vendedor=$6,cidade_origem=$7,uf_origem=$8,cidade_destino=$9,uf_destino=$10,material=$11,peso_kg=$12,valor_cliente=$13,condicao_pagamento=$14,observacoes=$15,atualizado_por_id=$16,atualizado_por_login=$17,atualizado_em=NOW() WHERE id=$1`,
      [req.params.id, date(input.data), text(input.cliente, ""), text(input.clienteFinal), text(input.tomadorServico), text(input.vendedor),
        text(input.origem, ""), text(input.ufOrigem, "").slice(0, 2).toUpperCase(), text(input.destino, ""),
        text(input.ufDestino, "").slice(0, 2).toUpperCase(), text(input.material), number(input.peso), number(input.valorCliente),
        text(input.condicaoPagamento), text(input.observacoes), user.id, user.login],
    );
    if (!rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Carga nao encontrada." }); }
    await savePricingFields(client, req.params.id, input);
    await replaceRotas(client, req.params.id, input.paradas);
    await client.query("COMMIT");
    const saved = await pool.query(`${cargaSelect()} WHERE c.id=$1`, [req.params.id]);
    const [item] = await enrichCargasFinancial([mapCarga(saved.rows[0])], req.log);
    res.json(item);
  } catch (error) { await client.query("ROLLBACK"); next(error); }
  finally { client.release(); }
});

cargasViagensV2Router.post("/cargas-viagens-v2/cargas/:id/aprovacao", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const action = text(req.body?.acao, "").toLowerCase();
    const reason = text(req.body?.motivo, "");
    const transitions = {
      enviar: "aguardando_aprovacao",
      aprovar: "aprovada",
      corrigir: "correcao_solicitada",
      reprovar: "reprovada",
      reabrir: "correcao_solicitada",
      cancelar: "cancelada",
    };
    const nextStatus = transitions[action];
    if (!APPROVAL_STATUSES.has(nextStatus)) return res.status(400).json({ error: "Acao de aprovacao invalida." });
    if (["aprovar", "corrigir", "reprovar", "reabrir"].includes(action) && !canApprove(req.user)) {
      return res.status(403).json({ error: "Apenas Comercial ou administrador pode realizar esta acao." });
    }
    if (["corrigir", "reprovar", "reabrir", "cancelar"].includes(action) && !reason) {
      return res.status(400).json({ error: "Informe uma justificativa." });
    }
    await client.query("BEGIN");
    const currentResult = await client.query(`SELECT * FROM ${CARGAS()} WHERE id=$1 FOR UPDATE`, [req.params.id]);
    const current = currentResult.rows[0];
    if (!current) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Carga nao encontrada." });
    }
    if (action === "enviar" && !["rascunho", "correcao_solicitada", "reprovada"].includes(current.status_aprovacao)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Esta carga nao pode ser enviada neste estado." });
    }
    if (action === "aprovar") {
      const missing = [
        ["cliente", current.cliente], ["origem", current.cidade_origem],
        ["destino", current.cidade_destino], ["material", current.material],
        ["valor do cliente", Number(current.valor_cliente) > 0],
      ].filter(([, value]) => !value).map(([label]) => label);
      if (missing.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `Nao e possivel aprovar. Faltam: ${missing.join(", ")}.` });
      }
    }
    const user = auditUser(req.user);
    await client.query(
      `UPDATE ${CARGAS()} SET status_aprovacao=$2::varchar,motivo_aprovacao=$3,
       aprovado_por_id=CASE WHEN $2::varchar='aprovada' THEN $4 ELSE aprovado_por_id END,
       aprovado_por_login=CASE WHEN $2::varchar='aprovada' THEN $5 ELSE aprovado_por_login END,
       aprovado_em=CASE WHEN $2::varchar='aprovada' THEN NOW() ELSE aprovado_em END,
       atualizado_por_id=$4,atualizado_por_login=$5,atualizado_em=NOW() WHERE id=$1`,
      [req.params.id, nextStatus, reason || null, user.id, user.login],
    );
    await client.query(
      `INSERT INTO ${APROVACAO_AUDITORIA()} (carga_id,acao,status_anterior,status_novo,motivo,usuario_id,usuario_login)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [req.params.id, action, current.status_aprovacao, nextStatus, reason || null, user.id, user.login],
    );
    await client.query("COMMIT");
    const saved = await pool.query(`${cargaSelect()} WHERE c.id=$1`, [req.params.id]);
    const [item] = await enrichCargasFinancial([mapCarga(saved.rows[0])], req.log);
    res.json(item);
  } catch (error) { await client.query("ROLLBACK"); next(error); }
  finally { client.release(); }
});

cargasViagensV2Router.delete("/cargas-viagens-v2/cargas/:id", async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(`SELECT id FROM ${CARGAS()} WHERE id=$1 FOR UPDATE`, [req.params.id]);
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Carga nao encontrada." });
    }
    const link = await client.query(`SELECT viagem_id FROM ${VINCULOS()} WHERE carga_id=$1`, [req.params.id]);
    if (link.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Esta carga pertence a uma viagem. Exclua a viagem antes de excluir a carga." });
    }
    await client.query(`DELETE FROM ${CARGAS()} WHERE id=$1`, [req.params.id]);
    await client.query("COMMIT");
    res.status(204).end();
  } catch (error) { await client.query("ROLLBACK"); next(error); }
  finally { client.release(); }
});

cargasViagensV2Router.get("/cargas-viagens-v2/viagens", async (req, res, next) => {
  try {
    await syncDeliveredCargasV2().catch((error) => req.log?.warn({ err: error }, "Falha ao sincronizar entregas V2"));
    const values = [];
    const where = [];
    if (text(req.query.status)) { values.push(text(req.query.status)); where.push(`v.situacao=$${values.length}`); }
    if (text(req.query.q)) {
      values.push(`%${text(req.query.q)}%`);
      where.push(`CONCAT_WS(' ',v.numero_viagem,v.placa_veiculo,v.motorista) ILIKE $${values.length}`);
    }
    if (text(req.query.vendedor)) {
      values.push(`%${text(req.query.vendedor)}%`);
      where.push(`EXISTS (
        SELECT 1 FROM ${VINCULOS()} fvc
        JOIN ${CARGAS()} fc ON fc.id = fvc.carga_id
        WHERE fvc.viagem_id = v.id AND fc.vendedor ILIKE $${values.length}
      )`);
    }
    const financialFilter = text(req.query.financeiro, "").toLowerCase();
    if (financialFilter && financialFilter !== "sem_cte") {
      where.push(`EXISTS (
        SELECT 1 FROM ${VINCULOS()} fvc
        JOIN ${DOCUMENTOS()} fd ON fd.carga_id = fvc.carga_id
        WHERE fvc.viagem_id = v.id
          AND REGEXP_REPLACE(UPPER(COALESCE(fd.tipo_documento, '')), '[^A-Z]', '', 'g') = 'CTE'
      )`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const paged = req.query.page !== undefined || req.query.pageSize !== undefined;
    if (!paged) {
      const { rows } = await pool.query(`${viagemSelect()} ${whereSql} ORDER BY v.data DESC,v.id DESC LIMIT 500`, values);
      const items = await enrichViagensFinancial(rows.map(mapViagem), req.log);
      return res.json(financialFilter ? items.filter((item) => item.financeiro.status === financialFilter) : items);
    }
    const { page, pageSize, offset } = pagination(req.query);
    if (financialFilter) {
      const { rows } = await pool.query(`${viagemSelect()} ${whereSql} ORDER BY v.data DESC,v.id DESC`, values);
      const enriched = await enrichViagensFinancial(rows.map(mapViagem), req.log);
      const filtered = enriched.filter((item) => item.financeiro.status === financialFilter);
      return res.json({
        items: filtered.slice(offset, offset + pageSize),
        total: filtered.length,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
      });
    }
    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM ${VIAGENS()} v ${whereSql}`, values);
    const total = Number(countResult.rows[0]?.total || 0);
    const pagedValues = [...values, pageSize, offset];
    const { rows } = await pool.query(
      `${viagemSelect()} ${whereSql} ORDER BY v.data DESC,v.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      pagedValues,
    );
    const items = await enrichViagensFinancial(rows.map(mapViagem), req.log);
    res.json({ items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) { next(error); }
});

cargasViagensV2Router.get("/cargas-viagens-v2/viagens/:id", async (req, res, next) => {
  try {
    const { rows } = await pool.query(`${viagemSelect()} WHERE v.id=$1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Viagem nao encontrada." });
    const [item] = await enrichViagensFinancial([mapViagem(rows[0])], req.log);
    res.json(item);
  } catch (error) { next(error); }
});

cargasViagensV2Router.post("/cargas-viagens-v2/viagens", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = req.body || {};
    const cargaIds = [...new Set((Array.isArray(input.cargaIds) ? input.cargaIds : []).map(Number).filter(Number.isInteger))];
    if (!text(input.placa) || !cargaIds.length) return res.status(400).json({ error: "Selecione o veiculo e pelo menos uma carga." });
    const frota = String(input.tipoPropriedade || "").trim().toUpperCase() === "FROTA";
    if (!frota && !text(input.motorista)) return res.status(400).json({ error: "Informe o motorista do veiculo terceiro." });
    const user = auditUser(req.user);
    await client.query("BEGIN");
    const available = await client.query(
      `SELECT c.id FROM ${CARGAS()} c LEFT JOIN ${VINCULOS()} vc ON vc.carga_id=c.id WHERE c.id=ANY($1::bigint[]) AND vc.carga_id IS NULL FOR UPDATE OF c`,
      [cargaIds],
    );
    if (available.rowCount !== cargaIds.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Uma ou mais cargas ja foram programadas. Atualize a lista e tente novamente." });
    }
    const sequence = await client.query(`SELECT nextval(pg_get_serial_sequence('${VIAGENS().replaceAll('"', '')}','id')) AS id`);
    const id = Number(sequence.rows[0].id);
    const numero = text(input.numero, `V-${new Date().getFullYear()}-${String(id).padStart(4, "0")}`);
    const docs = input.docs || {};
    await client.query(
      `INSERT INTO ${VIAGENS()} (id,numero_viagem,data,placa_veiculo,tipo_propriedade,motorista,km_viagem,numero_motorista,cnh_motorista,antt_veiculo,conta_deposito,chave_pix,valor_motorista,doc_placas,doc_antt,doc_conta_deposito,doc_chave_pix,doc_cnh_motorista,doc_consulta_motorista,doc_comprovante_residencia,doc_numero_motorista,rota_maps_url,observacoes,situacao,criado_por_id,criado_por_login,atualizado_por_id,atualizado_por_login)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,'aguardando_cte',$24,$25,$24,$25)`,
      [id, numero, date(input.data), text(input.placa), text(input.tipoPropriedade), text(input.motorista), number(input.km, null),
        text(input.numeroMotorista), text(input.cnh), text(input.antt), text(input.contaDeposito), text(input.chavePix),
        frota ? 0 : number(input.valorMotorista), Boolean(docs.placas), Boolean(docs.antt), Boolean(docs.contaDeposito),
        Boolean(docs.chavePix), Boolean(docs.cnh), Boolean(docs.consultaMotorista), Boolean(docs.comprovanteResidencia),
        Boolean(docs.numeroMotorista), text(input.rotaMapsUrl), text(input.observacoes), user.id, user.login],
    );
    for (const cargaId of cargaIds) {
      await client.query(`INSERT INTO ${VINCULOS()} (viagem_id,carga_id) VALUES($1,$2)`, [id, cargaId]);
      await client.query(`UPDATE ${CARGAS()} SET status='aguardando_cte',atualizado_por_id=$2,atualizado_por_login=$3,atualizado_em=NOW() WHERE id=$1`, [cargaId, user.id, user.login]);
    }
    await client.query("COMMIT");
    const saved = await pool.query(`${viagemSelect()} WHERE v.id=$1`, [id]);
    const [item] = await enrichViagensFinancial([mapViagem(saved.rows[0])], req.log);
    res.status(201).json(item);
  } catch (error) { await client.query("ROLLBACK"); next(error); }
  finally { client.release(); }
});

cargasViagensV2Router.put("/cargas-viagens-v2/viagens/:id", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = req.body || {};
    const viagemId = Number(req.params.id);
    const cargaIds = [...new Set((Array.isArray(input.cargaIds) ? input.cargaIds : []).map(Number).filter(Number.isInteger))];
    if (!text(input.placa) || !cargaIds.length) return res.status(400).json({ error: "Selecione o veiculo e pelo menos uma carga." });
    const frota = String(input.tipoPropriedade || "").trim().toUpperCase() === "FROTA";
    if (!frota && !text(input.motorista)) return res.status(400).json({ error: "Informe o motorista do veiculo terceiro." });
    const user = auditUser(req.user);
    const docs = input.docs || {};
    await client.query("BEGIN");
    const current = await client.query(`SELECT id FROM ${VIAGENS()} WHERE id=$1 FOR UPDATE`, [viagemId]);
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Viagem nao encontrada." });
    }
    const allowed = await client.query(
      `SELECT c.id FROM ${CARGAS()} c
       LEFT JOIN ${VINCULOS()} vc ON vc.carga_id=c.id
       WHERE c.id=ANY($1::bigint[]) AND (vc.viagem_id IS NULL OR vc.viagem_id=$2)
       FOR UPDATE OF c`,
      [cargaIds, viagemId],
    );
    if (allowed.rowCount !== cargaIds.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Uma ou mais cargas pertencem a outra viagem. Atualize a lista e tente novamente." });
    }
    const previous = await client.query(`SELECT carga_id FROM ${VINCULOS()} WHERE viagem_id=$1`, [viagemId]);
    const previousIds = previous.rows.map((row) => Number(row.carga_id));
    const removedIds = previousIds.filter((id) => !cargaIds.includes(id));
    await client.query(
      `UPDATE ${VIAGENS()} SET numero_viagem=$2,data=$3,placa_veiculo=$4,tipo_propriedade=$5,motorista=$6,
       km_viagem=$7,numero_motorista=$8,cnh_motorista=$9,antt_veiculo=$10,conta_deposito=$11,chave_pix=$12,
       valor_motorista=$13,doc_placas=$14,doc_antt=$15,doc_conta_deposito=$16,doc_chave_pix=$17,
       doc_cnh_motorista=$18,doc_consulta_motorista=$19,doc_comprovante_residencia=$20,doc_numero_motorista=$21,
       rota_maps_url=$22,observacoes=$23,atualizado_por_id=$24,atualizado_por_login=$25,atualizado_em=NOW()
       WHERE id=$1`,
      [viagemId, text(input.numero), date(input.data), text(input.placa), text(input.tipoPropriedade), text(input.motorista),
        number(input.km, null), text(input.numeroMotorista), text(input.cnh), text(input.antt), text(input.contaDeposito),
        text(input.chavePix), frota ? 0 : number(input.valorMotorista), Boolean(docs.placas), Boolean(docs.antt),
        Boolean(docs.contaDeposito), Boolean(docs.chavePix), Boolean(docs.cnh), Boolean(docs.consultaMotorista),
        Boolean(docs.comprovanteResidencia), Boolean(docs.numeroMotorista), text(input.rotaMapsUrl),
        text(input.observacoes), user.id, user.login],
    );
    await client.query(`DELETE FROM ${VINCULOS()} WHERE viagem_id=$1`, [viagemId]);
    for (const cargaId of cargaIds) {
      await client.query(`INSERT INTO ${VINCULOS()} (viagem_id,carga_id) VALUES($1,$2)`, [viagemId, cargaId]);
      await client.query(
        `UPDATE ${CARGAS()} SET status=CASE WHEN EXISTS (
          SELECT 1 FROM ${DOCUMENTOS()} d WHERE d.carga_id=$1 AND REGEXP_REPLACE(UPPER(d.tipo_documento),'[^A-Z]','','g')='CTE'
        ) THEN 'em_transito' ELSE 'aguardando_cte' END,atualizado_por_id=$2,atualizado_por_login=$3,atualizado_em=NOW() WHERE id=$1`,
        [cargaId, user.id, user.login],
      );
    }
    if (removedIds.length) {
      await client.query(
        `UPDATE ${CARGAS()} SET status='aguardando_viagem',atualizado_por_id=$2,atualizado_por_login=$3,atualizado_em=NOW()
         WHERE id=ANY($1::bigint[])`,
        [removedIds, user.id, user.login],
      );
    }
    await syncViagemStatus(client, viagemId);
    await client.query("COMMIT");
    const saved = await pool.query(`${viagemSelect()} WHERE v.id=$1`, [viagemId]);
    const [item] = await enrichViagensFinancial([mapViagem(saved.rows[0])], req.log);
    res.json(item);
  } catch (error) { await client.query("ROLLBACK"); next(error); }
  finally { client.release(); }
});

cargasViagensV2Router.delete("/cargas-viagens-v2/viagens/:id", async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(`SELECT id FROM ${VIAGENS()} WHERE id=$1 FOR UPDATE`, [req.params.id]);
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Viagem nao encontrada." });
    }
    const links = await client.query(`SELECT carga_id FROM ${VINCULOS()} WHERE viagem_id=$1`, [req.params.id]);
    await client.query(`DELETE FROM ${VIAGENS()} WHERE id=$1`, [req.params.id]);
    const cargaIds = links.rows.map((row) => Number(row.carga_id));
    if (cargaIds.length) {
      await client.query(
        `UPDATE ${CARGAS()} SET status='aguardando_viagem',atualizado_por_id=$2,atualizado_por_login=$3,atualizado_em=NOW() WHERE id=ANY($1::bigint[])`,
        [cargaIds, auditUser(req.user).id, auditUser(req.user).login],
      );
    }
    await client.query("COMMIT");
    res.status(204).end();
  } catch (error) { await client.query("ROLLBACK"); next(error); }
  finally { client.release(); }
});

cargasViagensV2Router.put("/cargas-viagens-v2/cargas/:id/documentos", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const documentos = Array.isArray(req.body?.documentos) ? req.body.documentos : [];
    const user = auditUser(req.user);
    await client.query("BEGIN");
    const carga = await client.query(`SELECT id,status FROM ${CARGAS()} WHERE id=$1 FOR UPDATE`, [req.params.id]);
    if (!carga.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Carga nao encontrada." }); }
    await client.query(`DELETE FROM ${DOCUMENTOS()} WHERE carga_id=$1`, [req.params.id]);
    for (const documento of documentos) {
      await client.query(
        `INSERT INTO ${DOCUMENTOS()} (carga_id,tipo_documento,numero_documento,chave_documento,link_documento,observacoes,criado_por_id,criado_por_login,atualizado_por_id,atualizado_por_login)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7,$8)`,
        [req.params.id, text(documento.tipo || documento.tipoDocumento, "CT-e"), text(documento.numero || documento.numeroDocumento),
          text(documento.chave || documento.chaveDocumento), text(documento.link || documento.linkDocumento),
          text(documento.observacoes), user.id, user.login],
      );
    }
    const hasCte = documentos.some((documento) => {
      const tipo = String(documento.tipo || documento.tipoDocumento || "").toUpperCase().replace(/[^A-Z]/g, "");
      return tipo === "CTE" && Boolean(text(documento.numero || documento.numeroDocumento || documento.chave || documento.chaveDocumento));
    });
    const nextStatus = ["entregue", "cancelado"].includes(carga.rows[0].status)
      ? carga.rows[0].status
      : hasCte ? "em_transito" : "aguardando_cte";
    await client.query(`UPDATE ${CARGAS()} SET status=$2,atualizado_por_id=$3,atualizado_por_login=$4,atualizado_em=NOW() WHERE id=$1`,
      [req.params.id, nextStatus, user.id, user.login]);
    const trip = await client.query(`SELECT viagem_id FROM ${VINCULOS()} WHERE carga_id=$1`, [req.params.id]);
    if (trip.rows[0]) await syncViagemStatus(client, trip.rows[0].viagem_id);
    await client.query("COMMIT");
    const saved = await pool.query(`${cargaSelect()} WHERE c.id=$1`, [req.params.id]);
    const [item] = await enrichCargasFinancial([mapCarga(saved.rows[0])], req.log);
    res.json(item);
  } catch (error) { await client.query("ROLLBACK"); next(error); }
  finally { client.release(); }
});
