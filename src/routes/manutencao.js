import express from "express";
import { tableName } from "../config.js";
import { clientPool } from "../db/clientPool.js";
import { pool } from "../db/pool.js";
import { getVeiculosPool } from "../db/pool-veiculos.js";
import { selectCurrentOdometer } from "../services/odometerSelection.js";

export const manutencaoRouter = express.Router();

const TABLE = () => tableName("automacao_mensagem_manutencao");
const CONTACT_TABLE = () => tableName("manutencao_contatos");
const HISTORY_TABLE = () => tableName("historico_manutencao_veiculo");
const COMPONENT_TABLE = () => tableName("manutencao_componentes_posicao");
const COMPONENT_INTERVALS = {
  "Lona de freio": 100000, "Graxa": 15000, "Tambor": 200000,
  "Rolamento": 150000, "Cubo": 150000, "Amortecedor": 100000,
  "Mola": 150000, "Suspensão": 100000,
};
const HISTORY_TYPES = new Set([
  "troca_oleo_motor", "revisao", "filtro_combustivel", "filtro_ar",
  "oleo_cambio", "oleo_diferencial", "lubrificacao", "afericao_tacografo", "outro",
]);

function normalizePhone(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function normalizePhoneList(value) {
  return String(value || "")
    .split(/[,;\s]+/)
    .map(normalizePhone)
    .filter(Boolean);
}

async function resolveContato(payload = {}) {
  const numerosDiretos = normalizePhoneList(payload.numeros || payload.contato_numero);
  const numeroDireto = numerosDiretos[0];
  if (payload.contato_id) {
    const { rows } = await pool.query(
      `SELECT id, nome, numero FROM ${CONTACT_TABLE()} WHERE id = $1 AND ativo = TRUE`,
      [Number(payload.contato_id)]
    );
    if (rows[0]) {
      return {
        contato_id: null,
        contato_nome: null,
        contato_numero: null,
        numeros: rows[0].numero,
      };
    }
  }

  if (numeroDireto) {
    return {
      contato_id: null,
      contato_nome: null,
      contato_numero: null,
      numeros: numerosDiretos.join(","),
    };
  }

  return { contato_id: null, contato_nome: null, contato_numero: null, numeros: null };
}

// Aceita array ou string ("123, 456; 789") e devolve "123,456,789"
function normalizarNumeros(input) {
  const lista = Array.isArray(input) ? input : String(input || "").split(/[,;\n]+/);
  return lista
    .map(n => String(n).replace(/[^\d+]/g, ""))
    .filter(Boolean)
    .join(",");
}

function proximoKmProgramado(kmAtual, intervaloKm) {
  const km = Number(kmAtual || 0);
  const intervalo = Number(intervaloKm || 0);
  if (!Number.isFinite(km) || !Number.isFinite(intervalo) || intervalo <= 0) return 0;
  if (km <= 0) return intervalo;
  return Math.ceil(km / intervalo) * intervalo;
}

function normalizePlate(value) {
  return String(value || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function maintenanceTags(value) {
  const text = normalizeSearchText(value);
  const tags = new Set();
  if (text.includes("OLEOMOTOR") || text.includes("OLEO MOTOR") || text.includes("TROCA DE OLEO") || text.includes("FILTRO OLEO") || text.includes("FILTRO LUBRIFICANTE")) tags.add("oleo_motor");
  if (text.includes("FILTROCOMBUSTIVEL") || text.includes("FILTRO COMBUSTIVEL") || text.includes("FILTRO SEPARADOR") || text.includes("RACOR") || text.includes("RACCOR")) tags.add("filtro_combustivel");
  if (text.includes("FILTROAR") || text.includes("FILTRO AR")) tags.add("filtro_ar");
  if (text.includes("OLEOCAIXA") || text.includes("OLEO CAIXA") || text.includes("OLEO CAMBIO") || text.includes("CAMBIO") || text.includes("I-SHIFT")) tags.add("oleo_cambio");
  if (text.includes("OLEODIFERENCIAL") || text.includes("OLEO DIFERENCIAL") || text.includes("DIFERENCIAL")) tags.add("oleo_diferencial");
  if (text.includes("LUBRIFIC")) tags.add("lubrificacao");
  if (text.includes("ARLA")) tags.add("arla");
  return [...tags];
}

function desiredMaintenanceTags(titulo) {
  const tags = maintenanceTags(titulo);
  if (tags.length) return tags;
  return ["oleo_motor", "filtro_combustivel", "filtro_ar", "oleo_cambio", "oleo_diferencial", "lubrificacao"];
}

function eventToMaintenance(row) {
  return {
    data: row.data_manutencao,
    km: row.km_manutencao,
    tipoDocumento: row.tipo_documento,
    numeroDocumento: row.numero_documento,
    descricao: row.descricao,
    fornecedor: row.fornecedor,
    origem: row.origem,
    tags: maintenanceTags(`${row.componente || ""} ${row.descricao || ""}`),
  };
}

async function loadEngates(placas = []) {
  const normalized = [...new Set(placas.map(normalizePlate).filter(Boolean))];
  if (!normalized.length) return new Map();
  const { rows } = await clientPool.query(`
    SELECT
      regexp_replace(upper(placa_principal::text), '[^A-Z0-9]', '', 'g') AS placa_principal,
      regexp_replace(upper(reboque.placa::text), '[^A-Z0-9]', '', 'g') AS placa_reboque,
      vei.numeroeixosvei AS eixos,
      COALESCE(vei.nomevei, vei.modelovei, vei.marcamodelorenavamvei) AS modelo
    FROM frotas.veiculosreboquesmotoristas engate
    CROSS JOIN LATERAL (VALUES (placa_reboque1), (placa_reboque2), (placa_reboque3)) reboque(placa)
    LEFT JOIN frotas.veiculos vei
      ON regexp_replace(upper(vei.placavei::text), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(reboque.placa::text), '[^A-Z0-9]', '', 'g')
    WHERE regexp_replace(upper(placa_principal::text), '[^A-Z0-9]', '', 'g') = ANY($1::text[])
      AND NULLIF(TRIM(reboque.placa::text), '') IS NOT NULL
  `, [normalized]);
  const result = new Map();
  for (const row of rows) {
    if (!result.has(row.placa_principal)) result.set(row.placa_principal, []);
    result.get(row.placa_principal).push({ placa: row.placa_reboque, eixos: Number(row.eixos) || 3, modelo: row.modelo || "Implemento" });
  }
  return result;
}

function maintenanceMovementType(titulo) {
  const tags = desiredMaintenanceTags(titulo);
  if (tags.includes("filtro_ar")) return "filtro_ar";
  if (tags.includes("filtro_combustivel")) return "filtro_combustivel";
  if (tags.includes("oleo_cambio")) return "oleo_cambio";
  if (tags.includes("oleo_diferencial")) return "oleo_diferencial";
  if (tags.includes("lubrificacao")) return "lubrificacao";
  return "troca_oleo_motor";
}

function addDays(dateValue, days) {
  if (!dateValue || !Number.isFinite(Number(days)) || Number(days) <= 0) return null;
  const date = new Date(`${String(dateValue).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + Number(days));
  return date.toISOString().slice(0, 10);
}

async function loadHistoricoManual(placas = []) {
  const normalized = [...new Set(placas.map(normalizePlate).filter(Boolean))];
  if (!normalized.length) return new Map();
  const { rows } = await pool.query(`
    SELECT id, automacao_id, placa, tipo_movimento, descricao, data_servico,
           km_servico, fornecedor, documento, observacao
    FROM ${HISTORY_TABLE()}
    WHERE regexp_replace(upper(placa), '[^A-Z0-9]', '', 'g') = ANY($1::text[])
    ORDER BY data_servico DESC, km_servico DESC, id DESC
  `, [normalized]);
  const byPlate = new Map();
  for (const row of rows) {
    const plate = normalizePlate(row.placa);
    if (!byPlate.has(plate)) byPlate.set(plate, []);
    byPlate.get(plate).push({
      id: row.id,
      automacaoId: row.automacao_id,
      data: row.data_servico,
      km: row.km_servico,
      tipoDocumento: "Registro manual",
      numeroDocumento: row.documento || "",
      descricao: row.descricao,
      fornecedor: row.fornecedor || "",
      origem: "historico_manutencao_veiculo",
      observacao: row.observacao || "",
      tags: row.tipo_movimento === "revisao"
        ? ["oleo_motor", "filtro_combustivel", "filtro_ar", "oleo_cambio", "oleo_diferencial", "lubrificacao"]
        : [row.tipo_movimento],
    });
  }
  return byPlate;
}

function mergeHistoricos(systemHistory, manualHistory) {
  const result = new Map(systemHistory);
  for (const [plate, items] of manualHistory) {
    result.set(plate, [...(result.get(plate) || []), ...items].sort((a, b) => {
      const dataA = a?.data ? new Date(a.data).getTime() : 0;
      const dataB = b?.data ? new Date(b.data).getTime() : 0;
      return dataB - dataA || Number(b.km || 0) - Number(a.km || 0);
    }));
  }
  return result;
}

function pickUltimaManutencao(row, historico = []) {
  const desired = desiredMaintenanceTags(row?.titulo);
  const withKm = historico.filter((item) => Number(item?.km) > 0);
  const candidates = withKm.filter((item) => item.tags?.some((tag) => desired.includes(tag)));
  return candidates[0] || null;
}

async function loadDetalhesVeiculos(placas = []) {
  const normalized = [...new Set(placas.map(normalizePlate).filter(Boolean))];
  if (!normalized.length) return new Map();

  const { rows } = await clientPool.query(`
    SELECT DISTINCT ON (placa_norm)
      placa_norm,
      placavei,
      nomevei,
      marca_nome,
      marcavei,
      modelovei,
      marcamodelorenavamvei,
      chassivei,
      anomodelovei,
      tipopropriedadevei,
      numeroeixosvei
    FROM (
      SELECT
        regexp_replace(upper(placavei::text), '[^A-Z0-9]', '', 'g') AS placa_norm,
        placavei,
        nomevei,
        marca.nomemar AS marca_nome,
        marcavei,
        modelovei,
        marcamodelorenavamvei,
        chassivei,
        anomodelovei,
        tipopropriedadevei,
        numeroeixosvei,
        empresavei
      FROM frotas.veiculos
      LEFT JOIN frotas.marcas marca ON marca.codigomar = marcavei
      WHERE NULLIF(TRIM(placavei::text), '') IS NOT NULL
    ) v
    WHERE placa_norm = ANY($1::text[])
    ORDER BY placa_norm, empresavei
  `, [normalized]);

  return new Map(rows.map((row) => [row.placa_norm, row]));
}

async function loadDetalhesTelemetria(placas = []) {
  const normalized = [...new Set(placas.map(normalizePlate).filter(Boolean))];
  if (!normalized.length) return new Map();

  const vPool = getVeiculosPool();
  const { rows } = await vPool.query(`
    SELECT DISTINCT ON (placa_norm)
      placa_norm,
      placa,
      vehicle_model,
      identificacao_equipamento,
      chassi,
      odometro,
      odometro_data
    FROM (
      SELECT
        regexp_replace(upper(placa::text), '[^A-Z0-9]', '', 'g') AS placa_norm,
        placa,
        vehicle_model,
        identificacao_equipamento,
        chassi,
        telemetria.odometro,
        telemetria.data_hora AS odometro_data,
        updated_at
      FROM rodobach.veiculos v
      LEFT JOIN LATERAL (
        SELECT mcb.odometro, mcb.data_hora
        FROM rodobach.mensagens_cb mcb
        WHERE mcb.veiculo_id = v.veiculo_id
        ORDER BY mcb.data_hora DESC
        LIMIT 1
      ) telemetria ON TRUE
      WHERE NULLIF(TRIM(placa::text), '') IS NOT NULL
    ) v
    WHERE placa_norm = ANY($1::text[])
    ORDER BY placa_norm, updated_at DESC NULLS LAST
  `, [normalized]);

  return new Map(rows.map((row) => [row.placa_norm, row]));
}

async function loadHistoricoManutencoes(placas = []) {
  const normalized = [...new Set(placas.map(normalizePlate).filter(Boolean))];
  if (!normalized.length) return new Map();

  const { rows } = await clientPool.query(`
    WITH produtos_uniq AS (
      SELECT DISTINCT ON (codigopro) codigopro, nomepro
      FROM estoque.produtos
      ORDER BY codigopro, empresapro
    ),
    fornecedores_uniq AS (
      SELECT DISTINCT ON (codigofor) codigofor, nomefor, fantasiafor
      FROM gerais.fornecedores
      ORDER BY codigofor, empresafor
    ),
    eventos AS (
      SELECT
        regexp_replace(upper(COALESCE(NULLIF(i.veiculooep, ''), o.veiculoose)::text), '[^A-Z0-9]', '', 'g') AS placa_norm,
        COALESCE(o.dataentradaose, o.dataemissaoose)::date AS data_manutencao,
        o.kilometragematualveiculoose AS km_manutencao,
        'OS Externa'::text AS tipo_documento,
        o.codigoose::text AS numero_documento,
        COALESCE(NULLIF(prod.nomepro, ''), 'Produto ' || i.produtooep::text) AS descricao,
        COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Nao informado') AS fornecedor,
        COALESCE(NULLIF(prod.nomepro, ''), 'Produto ' || i.produtooep::text) AS componente,
        'frotas.ordensservicosexternaprodutos'::text AS origem
      FROM frotas.ordensservicosexternaprodutos i
      JOIN frotas.ordensservicosexterna o
        ON o.empresaose = i.empresaoep
       AND o.serieose = i.serieoep
       AND o.codigoose = i.codigooep
       AND o.fornecedorose = i.fornecedoroep
      LEFT JOIN produtos_uniq prod ON prod.codigopro = i.produtooep
      LEFT JOIN fornecedores_uniq forn ON forn.codigofor = o.fornecedorose
      WHERE NULLIF(TRIM(COALESCE(NULLIF(i.veiculooep, ''), o.veiculoose)::text), '') IS NOT NULL

      UNION ALL

      SELECT
        regexp_replace(upper(COALESCE(NULLIF(i.veiculooes, ''), o.veiculoose)::text), '[^A-Z0-9]', '', 'g') AS placa_norm,
        COALESCE(o.dataentradaose, o.dataemissaoose)::date AS data_manutencao,
        o.kilometragematualveiculoose AS km_manutencao,
        'OS Externa'::text AS tipo_documento,
        o.codigoose::text AS numero_documento,
        'Servico ' || i.servicooes::text AS descricao,
        COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Nao informado') AS fornecedor,
        'Servico ' || i.servicooes::text AS componente,
        'frotas.ordensservicosexternaservicos'::text AS origem
      FROM frotas.ordensservicosexternaservicos i
      JOIN frotas.ordensservicosexterna o
        ON o.empresaose = i.empresaoes
       AND o.serieose = i.serieoes
       AND o.codigoose = i.codigooes
       AND o.fornecedorose = i.fornecedoroes
      LEFT JOIN fornecedores_uniq forn ON forn.codigofor = o.fornecedorose
      WHERE NULLIF(TRIM(COALESCE(NULLIF(i.veiculooes, ''), o.veiculoose)::text), '') IS NOT NULL

      UNION ALL

      SELECT
        regexp_replace(upper(veiculovum::text), '[^A-Z0-9]', '', 'g') AS placa_norm,
        datavum::date AS data_manutencao,
        kmtrocavum AS km_manutencao,
        'Controle manutencao'::text AS tipo_documento,
        componentevum::text AS numero_documento,
        componentevum::text AS descricao,
        'Historico do veiculo'::text AS fornecedor,
        componentevum::text AS componente,
        'frotas.veiculosultimasmanutencoes'::text AS origem
      FROM frotas.veiculosultimasmanutencoes
      WHERE NULLIF(TRIM(veiculovum::text), '') IS NOT NULL

      UNION ALL

      SELECT
        nf.placa_norm,
        nf.data_manutencao,
        NULLIF(regexp_replace(COALESCE(nf.km_texto, ''), '[^0-9]', '', 'g'), '')::integer AS km_manutencao,
        'Nota Fiscal'::text AS tipo_documento,
        nf.numero_documento,
        nf.descricao,
        nf.fornecedor,
        nf.descricao AS componente,
        'compras.notasfiscaisentradaprodutos'::text AS origem
      FROM (
        SELECT
          regexp_replace(upper(COALESCE(NULLIF(i.veiculonep, ''), n.veiculonfe)::text), '[^A-Z0-9]', '', 'g') AS placa_norm,
          COALESCE(n.dataentradanfe, n.dataemissaonfe)::date AS data_manutencao,
          n.codigonfe::text AS numero_documento,
          COALESCE(NULLIF(prod.nomepro, ''), 'Produto ' || i.produtonep::text) AS descricao,
          COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Nao informado') AS fornecedor,
          substring(upper(COALESCE(n.observacaonfe, '')) from 'KM[: ]+([0-9][0-9\\.]{1,10})') AS km_texto
        FROM compras.notasfiscaisentradaprodutos i
        JOIN compras.notasfiscaisentrada n
          ON n.empresanfe = i.empresanep
         AND n.serienfe = i.serienep
         AND n.codigonfe = i.codigonep
         AND n.fornecedornfe = i.fornecedornep
        LEFT JOIN produtos_uniq prod ON prod.codigopro = i.produtonep
        LEFT JOIN fornecedores_uniq forn ON forn.codigofor = n.fornecedornfe
        WHERE NULLIF(TRIM(COALESCE(NULLIF(i.veiculonep, ''), n.veiculonfe)::text), '') IS NOT NULL
          AND (
            COALESCE(prod.nomepro, '') ILIKE ANY(ARRAY['%OLEO%','%ÓLEO%','%FILTRO%','%LUBRIF%','%CAMBIO%','%CÂMBIO%','%DIFERENCIAL%','%RETARDER%','%RACOR%','%SECADOR%'])
            OR COALESCE(n.observacaonfe, '') ILIKE ANY(ARRAY['%OLEO DO MOTOR%','%ÓLEO DO MOTOR%','%FILTRO OLEO%','%FILTRO ÓLEO%','%OLEO CAMBIO%','%ÓLEO CÂMBIO%','%DIFERENCIAL%','%LUBRIFICA%','%TROCA DE OLEO%','%TROCA DE ÓLEO%'])
          )
          AND COALESCE(prod.nomepro, '') NOT ILIKE ALL(ARRAY['%DIESEL%','%ARLA%','%COMBUSTIVEL%','%COMBUSTÍVEL%'])
      ) nf
      WHERE NULLIF(regexp_replace(COALESCE(nf.km_texto, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
    )
    SELECT
      placa_norm,
      data_manutencao,
      km_manutencao,
      tipo_documento,
      numero_documento,
      descricao,
      fornecedor,
      componente,
      origem
    FROM eventos
    WHERE placa_norm = ANY($1::text[])
      AND km_manutencao IS NOT NULL
    ORDER BY placa_norm, data_manutencao DESC NULLS LAST, km_manutencao DESC NULLS LAST
  `, [normalized]);

  const byPlate = new Map();
  for (const row of rows) {
    const item = eventToMaintenance(row);
    if (!item.tags.length) continue;
    if (!byPlate.has(row.placa_norm)) byPlate.set(row.placa_norm, []);
    byPlate.get(row.placa_norm).push(item);
  }
  return byPlate;
}

async function loadOdometrosErp(placas = []) {
  const normalized = [...new Set(placas.map(normalizePlate).filter(Boolean))];
  if (!normalized.length) return new Map();
  const { rows } = await clientPool.query(`
    WITH eventos AS (
      SELECT regexp_replace(upper(veiculocvg::text), '[^A-Z0-9]', '', 'g') AS placa,
             COALESCE(datachegadacvg, datasaidacvg)::date AS data_ref,
             GREATEST(COALESCE(kmchegadacvg, 0), COALESCE(kmsaidacvg, 0))::numeric AS km,
             'viagem'::text AS origem
      FROM logistica.controleviagens
      UNION ALL
      SELECT regexp_replace(upper(veiculoaba::text), '[^A-Z0-9]', '', 'g'),
             dataaba::date, kilometragematualaba::numeric, 'abastecimento'::text
      FROM frotas.abastecimentos
      UNION ALL
      SELECT regexp_replace(upper(veiculoose::text), '[^A-Z0-9]', '', 'g'),
             COALESCE(dataentradaose, dataemissaoose)::date,
             kilometragematualveiculoose::numeric, 'ordem_servico'::text
      FROM frotas.ordensservicosexterna
    ), validos AS (
      SELECT * FROM eventos
      WHERE placa = ANY($1::text[])
        AND km BETWEEN 10000 AND 2000000
        AND data_ref IS NOT NULL
    )
    SELECT DISTINCT ON (placa) placa, data_ref, km, origem
    FROM validos
    ORDER BY placa, data_ref DESC, km DESC
  `, [normalized]);
  return new Map(rows.map(row => [row.placa, {
    odometro: Number(row.km),
    data: row.data_ref,
    origem: row.origem,
  }]));
}

async function loadUltimasAfericoesTacografo(placas = []) {
  const normalized = [...new Set(placas.map(normalizePlate).filter(Boolean))];
  if (!normalized.length) return new Map();
  const { rows } = await clientPool.query(`
    WITH afericoes AS (
      SELECT
        regexp_replace(upper(COALESCE(NULLIF(i.veiculooep, ''), o.veiculoose)::text), '[^A-Z0-9]', '', 'g') AS placa,
        COALESCE(o.dataentradaose, o.dataemissaoose)::date AS data,
        'OS Externa'::text AS origem,
        o.codigoose::text AS documento
      FROM frotas.ordensservicosexternaprodutos i
      JOIN frotas.ordensservicosexterna o
        ON o.empresaose=i.empresaoep AND o.serieose=i.serieoep
       AND o.codigoose=i.codigooep AND o.fornecedorose=i.fornecedoroep
      WHERE i.produtooep = 1046
      UNION ALL
      SELECT
        regexp_replace(upper(COALESCE(NULLIF(i.veiculonep, ''), n.veiculonfe)::text), '[^A-Z0-9]', '', 'g'),
        COALESCE(n.dataentradanfe, n.dataemissaonfe)::date,
        'Nota Fiscal'::text,
        n.codigonfe::text
      FROM compras.notasfiscaisentradaprodutos i
      JOIN compras.notasfiscaisentrada n
        ON n.empresanfe=i.empresanep AND n.serienfe=i.serienep
       AND n.codigonfe=i.codigonep AND n.fornecedornfe=i.fornecedornep
      WHERE i.produtonep = 1046
    )
    SELECT DISTINCT ON (placa) placa, data, origem, documento
    FROM afericoes
    WHERE placa = ANY($1::text[]) AND data IS NOT NULL
    ORDER BY placa, data DESC
  `, [normalized]);
  return new Map(rows.map((row) => [row.placa, {
    data: row.data, origem: row.origem, documento: row.documento, produtoCodigo: 1046,
  }]));
}

async function loadPlanosAutorizados(placas = []) {
  const normalized = [...new Set(placas.map(normalizePlate).filter(Boolean))];
  if (!normalized.length) return new Map();

  const { rows } = await clientPool.query(`
    WITH produtos_uniq AS (
      SELECT DISTINCT ON (codigopro) codigopro, nomepro
      FROM estoque.produtos
      ORDER BY codigopro, empresapro
    ),
    fornecedores_uniq AS (
      SELECT DISTINCT ON (codigofor) codigofor, nomefor, fantasiafor
      FROM gerais.fornecedores
      ORDER BY codigofor, empresafor
    )
    SELECT DISTINCT ON (placa_norm)
      placa_norm,
      data_doc,
      documento,
      fornecedor,
      item,
      valor
    FROM (
      SELECT
        regexp_replace(upper(COALESCE(NULLIF(i.veiculonep, ''), n.veiculonfe)::text), '[^A-Z0-9]', '', 'g') AS placa_norm,
        COALESCE(n.dataentradanfe, n.dataemissaonfe)::date AS data_doc,
        n.codigonfe::text AS documento,
        n.fornecedornfe AS fornecedor_codigo,
        COALESCE(NULLIF(forn.fantasiafor, ''), NULLIF(forn.nomefor, ''), 'Nao informado') AS fornecedor,
        COALESCE(NULLIF(prod.nomepro, ''), 'Produto ' || i.produtonep::text) AS item,
        COALESCE(i.totalitemestoquenep, i.totalitemnep, 0) AS valor
      FROM compras.notasfiscaisentradaprodutos i
      JOIN compras.notasfiscaisentrada n
        ON n.empresanfe = i.empresanep
       AND n.serienfe = i.serienep
       AND n.codigonfe = i.codigonep
       AND n.fornecedornfe = i.fornecedornep
      LEFT JOIN produtos_uniq prod ON prod.codigopro = i.produtonep
      LEFT JOIN fornecedores_uniq forn ON forn.codigofor = n.fornecedornfe
      WHERE NULLIF(TRIM(COALESCE(NULLIF(i.veiculonep, ''), n.veiculonfe)::text), '') IS NOT NULL
    ) nf
    WHERE placa_norm = ANY($1::text[])
      AND (
        fornecedor_codigo IN (644, 469, 649, 984, 846, 1390, 2115, 2764)
        OR fornecedor ILIKE ANY(ARRAY['%VOLVO%','%SCANIA%','%DICAVE%','%BRAVO%','%RF - SUL%','%RF SUL%','%SUL COMERCIO DE CAMINHOES%'])
      )
      AND item ILIKE ANY(ARRAY['%PLANO DE MANUT%','%PLANO MANUT%','%REVIS%','%MANUTEN%'])
    ORDER BY placa_norm, data_doc DESC NULLS LAST, documento DESC
  `, [normalized]);

  return new Map(rows.map((row) => [row.placa_norm, {
    data: row.data_doc,
    documento: row.documento,
    fornecedor: row.fornecedor,
    item: row.item,
    valor: row.valor,
  }]));
}

function mapDetalheVeiculo(row, detalhe, historico, planoAutorizado, telemetria, odometroErp) {
  const ultima = pickUltimaManutencao(row, historico || []);
  const modelo = detalhe?.nomevei
    || detalhe?.modelovei
    || detalhe?.marcamodelorenavamvei
    || telemetria?.vehicle_model
    || telemetria?.identificacao_equipamento
    || null;
  const selectedOdometer = selectCurrentOdometer({
    telemetryKm: telemetria?.odometro,
    telemetryDate: telemetria?.odometro_data,
    erpKm: odometroErp?.odometro,
    erpDate: odometroErp?.data,
  });
  const usaTelemetria = selectedOdometer.source === "telemetria";
  return {
    ...row,
    km_atual: selectedOdometer.km,
    km_fonte: usaTelemetria ? "telemetria" : (odometroErp?.origem || "indisponivel"),
    km_data: usaTelemetria ? (telemetria?.odometro_data || null) : (odometroErp?.data || null),
    telemetria_descartada: selectedOdometer.telemetryRejected,
    telemetria_km: selectedOdometer.telemetryRejected ? selectedOdometer.telemetryKm : null,
    telemetria_motivo: selectedOdometer.rejectionReason || null,
    km_proximo_envio: ultima?.km != null
      ? Number(ultima.km) + Number(row.intervalo_km || 0)
      : proximoKmProgramado(row.km_atual, row.intervalo_km),
    modelo,
    marca: detalhe?.marca_nome || detalhe?.marcavei || null,
    anoModelo: detalhe?.anomodelovei || null,
    tipoPropriedade: detalhe?.tipopropriedadevei || null,
    eixos: detalhe?.numeroeixosvei || null,
    chassi: detalhe?.chassivei || telemetria?.chassi || null,
    ultimaManutencao: ultima,
    planoAutorizado: planoAutorizado || null,
  };
}

const QUERY_VEICULOS = `
  SELECT DISTINCT ON (v.placa)
    v.placa, telemetria.odometro, telemetria.data_hora AS odometro_data,
    v.vehicle_model, v.identificacao_equipamento, v.chassi
  FROM rodobach.veiculos v
  LEFT JOIN LATERAL (
    SELECT mcb.odometro, mcb.data_hora
    FROM rodobach.mensagens_cb mcb
    WHERE mcb.veiculo_id = v.veiculo_id
    ORDER BY mcb.data_hora DESC
    LIMIT 1
  ) telemetria ON TRUE
  WHERE v.placa IS NOT NULL
  ORDER BY v.placa
`;

// GET /api/manutencao/veiculos — lista placas + odômetro do banco externo
manutencaoRouter.get("/manutencao/veiculos", async (_req, res, next) => {
  try {
    const vPool = getVeiculosPool();
    const { rows } = await vPool.query(QUERY_VEICULOS);
    const placas = rows.map((row) => row.placa);
    const [detalhes, historicosSistema, historicosManuais, planosAutorizados, afericoesTacografo, odometrosErp, engates] = await Promise.all([
      loadDetalhesVeiculos(placas),
      loadHistoricoManutencoes(placas),
      loadHistoricoManual(placas),
      loadPlanosAutorizados(placas),
      loadUltimasAfericoesTacografo(placas),
      loadOdometrosErp(placas),
      loadEngates(placas),
    ]);
    const historicos = mergeHistoricos(historicosSistema, historicosManuais);
    const telemetria = new Map(rows.map((row) => [normalizePlate(row.placa), row]));

    res.json({
      veiculos: rows.map((row) => {
        const placaNorm = normalizePlate(row.placa);
        return {
          ...mapDetalheVeiculo(row, detalhes.get(placaNorm), historicos.get(placaNorm), planosAutorizados.get(placaNorm), telemetria.get(placaNorm), odometrosErp.get(placaNorm)),
          ultimaAfericaoTacografo: afericoesTacografo.get(placaNorm) || null,
          implementos: engates.get(placaNorm) || [],
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});

manutencaoRouter.get("/manutencao/contatos", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nome, numero, ativo, criado_em, atualizado_em
       FROM ${CONTACT_TABLE()}
       WHERE ativo = TRUE
       ORDER BY lower(nome), numero`
    );
    res.json({ contatos: rows });
  } catch (error) {
    next(error);
  }
});

manutencaoRouter.get("/manutencao/componentes-posicao", async (req, res, next) => {
  try {
    const placa = normalizePlate(req.query.placa);
    if (!placa) return res.status(400).json({ error: "Placa obrigatória." });
    const { rows } = await pool.query(`
      SELECT * FROM ${COMPONENT_TABLE()}
      WHERE regexp_replace(upper(placa), '[^A-Z0-9]', '', 'g') = $1
         OR regexp_replace(upper(COALESCE(conjunto_placa, '')), '[^A-Z0-9]', '', 'g') = $1
      ORDER BY data_servico DESC, id DESC
    `, [placa]);
    res.json({ registros: rows });
  } catch (error) { next(error); }
});

manutencaoRouter.get("/manutencao/componentes-posicao/opcoes", async (_req, res, next) => {
  try {
    const patterns = ["%LONA DE FREIO%", "%GRAXA%", "%TAMBOR%", "%ROLAMENTO%", "%CUBO%", "%AMORTECEDOR%", "%MOLA%", "%SUSPENS%"];
    const [brandsResult, suppliersResult] = await Promise.all([
      clientPool.query(`SELECT DISTINCT trim(m.nomempr) AS nome FROM estoque.produtos p JOIN estoque.marcasprodutos m ON m.codigompr=p.marcapro WHERE p.nomepro ILIKE ANY($1::text[]) AND NULLIF(trim(m.nomempr),'') IS NOT NULL ORDER BY nome`, [patterns]),
      clientPool.query(`WITH produtos_uniq AS (SELECT DISTINCT ON(codigopro) codigopro,nomepro FROM estoque.produtos ORDER BY codigopro,empresapro), fornecedores_uniq AS (SELECT DISTINCT ON(codigofor) codigofor,COALESCE(NULLIF(fantasiafor,''),nomefor) nome FROM gerais.fornecedores ORDER BY codigofor,empresafor) SELECT f.nome,count(*)::int usos FROM frotas.ordensservicosexternaprodutos i JOIN produtos_uniq p ON p.codigopro=i.produtooep JOIN fornecedores_uniq f ON f.codigofor=i.fornecedoroep WHERE p.nomepro ILIKE ANY($1::text[]) AND NULLIF(trim(f.nome),'') IS NOT NULL AND upper(trim(f.nome)) <> 'NULO' GROUP BY f.nome ORDER BY usos DESC,f.nome LIMIT 100`, [patterns]),
    ]);
    res.json({ marcas: brandsResult.rows.map(row => row.nome), fornecedores: suppliersResult.rows.map(row => row.nome), intervalos: Object.entries(COMPONENT_INTERVALS).map(([componente, km]) => ({ componente, km, origem: "planejado" })) });
  } catch (error) { next(error); }
});

manutencaoRouter.post("/manutencao/componentes-posicao", async (req, res, next) => {
  try {
    const placa = normalizePlate(req.body.placa);
    const eixo = String(req.body.eixo_codigo || "").trim().toUpperCase();
    const lado = String(req.body.lado || "GERAL").trim().toUpperCase();
    const componente = String(req.body.componente || "").trim();
    const tipoServico = String(req.body.tipo_servico || "").trim();
    const dataServico = String(req.body.data_servico || "").slice(0, 10);
    if (!placa || !eixo || !componente || !tipoServico || !/^\d{4}-\d{2}-\d{2}$/.test(dataServico)) {
      return res.status(400).json({ error: "Informe veículo, posição, componente, serviço e data." });
    }
    if (!["E", "D", "CENTRO", "GERAL"].includes(lado)) return res.status(400).json({ error: "Lado inválido." });
    const numberOrNull = (value) => value === "" || value == null ? null : Number(value);
    const values = [
      placa, normalizePlate(req.body.conjunto_placa) || null, String(req.body.layout_tipo || "TRUCK").toUpperCase(),
      eixo, lado, componente, tipoServico, dataServico, numberOrNull(req.body.km_servico),
      numberOrNull(req.body.proximo_km), req.body.proxima_data || null, req.body.marca || null,
      req.body.fornecedor || null, numberOrNull(req.body.valor), req.body.observacao || null, req.user?.id || null,
    ];
    if ([values[8], values[9], values[13]].some((value) => value != null && (!Number.isFinite(value) || value < 0))) {
      return res.status(400).json({ error: "KM e valor devem ser números positivos." });
    }
    const { rows } = await pool.query(`
      INSERT INTO ${COMPONENT_TABLE()} (
        placa, conjunto_placa, layout_tipo, eixo_codigo, lado, componente, tipo_servico,
        data_servico, km_servico, proximo_km, proxima_data, marca, fornecedor, valor, observacao, criado_por
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *
    `, values);
    res.status(201).json({ registro: rows[0] });
  } catch (error) { next(error); }
});

manutencaoRouter.post("/manutencao/componentes-posicao/lote", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const items = Array.isArray(req.body.itens) ? req.body.itens : [];
    if (!items.length || items.length > 100) return res.status(400).json({ error: "Informe entre 1 e 100 serviços." });
    const grupoId = String(req.body.grupo_id || `MAN-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`).slice(0, 80);
    const inserted = [];
    await client.query("BEGIN");
    for (const item of items) {
      const placa = normalizePlate(item.placa);
      const eixo = String(item.eixo_codigo || "").trim().toUpperCase();
      const lado = String(item.lado || "GERAL").trim().toUpperCase();
      const componente = String(item.componente || "").trim();
      const tipoServico = String(item.tipo_servico || "").trim();
      const dataServico = String(item.data_servico || "").slice(0, 10);
      const condicao = item.condicao ? String(item.condicao).trim().toUpperCase() : null;
      if (!placa || !eixo || !componente || !tipoServico || !/^\d{4}-\d{2}-\d{2}$/.test(dataServico)) throw Object.assign(new Error("Informe veículo, posição, componente, serviço e data."), { status: 400 });
      if (!["E", "D", "CENTRO", "GERAL"].includes(lado)) throw Object.assign(new Error("Lado inválido."), { status: 400 });
      if (condicao && !["BOM", "ATENCAO", "CRITICO"].includes(condicao)) throw Object.assign(new Error("Condição de inspeção inválida."), { status: 400 });
      const numberOrNull = value => value === "" || value == null ? null : Number(value);
      const values = [placa, normalizePlate(item.conjunto_placa) || null, String(item.layout_tipo || "TRUCK").toUpperCase(), eixo, lado, componente, tipoServico, dataServico, numberOrNull(item.km_servico), numberOrNull(item.proximo_km), item.proxima_data || null, item.marca || null, item.fornecedor || null, numberOrNull(item.valor), item.observacao || null, req.user?.id || null, grupoId, condicao, item.motivo || null];
      if ([values[8], values[9], values[13]].some(value => value != null && (!Number.isFinite(value) || value < 0))) throw Object.assign(new Error("KM e valor devem ser números positivos."), { status: 400 });
      const { rows } = await client.query(`
        INSERT INTO ${COMPONENT_TABLE()} (
          placa, conjunto_placa, layout_tipo, eixo_codigo, lado, componente, tipo_servico,
          data_servico, km_servico, proximo_km, proxima_data, marca, fornecedor, valor,
          observacao, criado_por, grupo_id, condicao, motivo
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        RETURNING *
      `, values);
      inserted.push(rows[0]);
    }
    await client.query("COMMIT");
    res.status(201).json({ grupo_id: grupoId, registros: inserted });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.status === 400) return res.status(400).json({ error: error.message });
    next(error);
  } finally { client.release(); }
});

manutencaoRouter.get("/manutencao/registros", async (req, res, next) => {
  try {
    const placa = normalizePlate(req.query.placa);
    const params = [];
    const where = placa ? `WHERE regexp_replace(upper(placa), '[^A-Z0-9]', '', 'g') = $1` : "";
    if (placa) params.push(placa);
    const { rows } = await pool.query(`
      SELECT * FROM ${HISTORY_TABLE()}
      ${where}
      ORDER BY data_servico DESC, km_servico DESC, id DESC
      LIMIT 500
    `, params);
    res.json({ registros: rows });
  } catch (error) {
    next(error);
  }
});

manutencaoRouter.post("/manutencao/registros", async (req, res, next) => {
  try {
    const placa = normalizePlate(req.body.placa);
    const tipo = String(req.body.tipo_movimento || "").trim();
    const descricao = String(req.body.descricao || "").trim();
    const dataServico = String(req.body.data_servico || "").slice(0, 10);
    const kmServico = Number(req.body.km_servico);
    const automacaoId = req.body.automacao_id ? Number(req.body.automacao_id) : null;
    if (!placa || !HISTORY_TYPES.has(tipo) || !descricao || !dataServico || !Number.isInteger(kmServico) || kmServico < 0) {
      return res.status(400).json({ error: "Placa, tipo, descricao, data e KM validos sao obrigatorios." });
    }
    const { rows } = await pool.query(`
      INSERT INTO ${HISTORY_TABLE()} (
        automacao_id, placa, tipo_movimento, descricao, data_servico, km_servico,
        fornecedor, documento, observacao, criado_por
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `, [
      automacaoId, placa, tipo, descricao, dataServico, kmServico,
      String(req.body.fornecedor || "").trim() || null,
      String(req.body.documento || "").trim() || null,
      String(req.body.observacao || "").trim() || null,
      req.user?.id || null,
    ]);
    if (automacaoId) {
      await pool.query(`
        UPDATE ${TABLE()}
        SET km_proximo_envio = CASE WHEN tipo_controle = 'km' THEN $1 + intervalo_km ELSE km_proximo_envio END,
            data_ultimo_servico = CASE WHEN tipo_controle = 'data' THEN $2::date ELSE data_ultimo_servico END,
            data_proximo_envio = CASE WHEN tipo_controle = 'data' THEN $2::date + intervalo_dias ELSE data_proximo_envio END,
            atualizado_em = NOW()
        WHERE id = $3 AND regexp_replace(upper(placa), '[^A-Z0-9]', '', 'g') = $4
      `, [kmServico, dataServico, automacaoId, placa]);
    }
    res.status(201).json({ registro: rows[0] });
  } catch (error) {
    next(error);
  }
});

manutencaoRouter.post("/manutencao/contatos", async (req, res, next) => {
  try {
    const nome = String(req.body.nome || "").trim();
    const numero = normalizePhone(req.body.numero);
    if (!nome || !numero) {
      return res.status(400).json({ error: "Nome e numero sao obrigatorios." });
    }

    const { rows } = await pool.query(
      `INSERT INTO ${CONTACT_TABLE()} (nome, numero)
       VALUES ($1, $2)
       ON CONFLICT (numero) DO UPDATE
         SET nome = EXCLUDED.nome,
             ativo = TRUE,
             atualizado_em = NOW()
       RETURNING *`,
      [nome, numero]
    );
    res.status(201).json({ contato: rows[0] });
  } catch (error) {
    next(error);
  }
});

// GET /api/manutencao
manutencaoRouter.get("/manutencao", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM ${TABLE()} ORDER BY criado_em DESC`
    );
    const placas = rows.map((row) => row.placa);
    const [detalhes, historicosSistema, historicosManuais, planosAutorizados, telemetria, odometrosErp] = await Promise.all([
      loadDetalhesVeiculos(placas),
      loadHistoricoManutencoes(placas),
      loadHistoricoManual(placas),
      loadPlanosAutorizados(placas),
      loadDetalhesTelemetria(placas),
      loadOdometrosErp(placas),
    ]);
    const historicos = mergeHistoricos(historicosSistema, historicosManuais);
    res.json({
      automacoes: rows.map((row) => {
        const placaNorm = normalizePlate(row.placa);
        return mapDetalheVeiculo(row, detalhes.get(placaNorm), historicos.get(placaNorm), planosAutorizados.get(placaNorm), telemetria.get(placaNorm), odometrosErp.get(placaNorm));
      }),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/manutencao — cria um registro por placa selecionada
manutencaoRouter.post("/manutencao", async (req, res, next) => {
  try {
    const { placas, titulo, mensagem, intervalo_km, intervalo_dias, data_ultimo_servico } = req.body;
    const tipoControle = req.body.tipo_controle === "data" ? "data" : "km";
    const contato = await resolveContato(req.body);

    if (!Array.isArray(placas) || placas.length === 0) {
      return res.status(400).json({ error: "Selecione ao menos uma placa." });
    }
    if (!titulo || !mensagem || (tipoControle === "km" ? Number(intervalo_km) <= 0 : Number(intervalo_dias) <= 0)) {
      return res.status(400).json({ error: "Titulo, mensagem e intervalo do plano sao obrigatorios." });
    }

    if (!contato.numeros) {
      return res.status(400).json({ error: "Selecione ou cadastre um contato para envio." });
    }

    // placas vem como [{ placa, km_atual }]
    const entradas = placas.map(p => ({
      placa: String(p.placa).toUpperCase().trim(),
      km_atual: Number(p.km_atual || 0),
      km_ultimo_servico: p.km_ultimo_servico == null || p.km_ultimo_servico === "" ? null : Number(p.km_ultimo_servico),
      data_ultimo_servico_km: p.data_ultimo_servico_km ? String(p.data_ultimo_servico_km).slice(0, 10) : null,
      data_ultimo_servico: p.data_ultimo_servico || data_ultimo_servico || null,
    }));

    if (tipoControle === "data") {
      const semData = entradas.filter(item => !item.data_ultimo_servico).map(item => item.placa);
      if (semData.length > 0) {
        return res.status(400).json({ error: `Informe a última aferição das placas: ${semData.join(", ")}.` });
      }
    }

    const criados = [];
    for (const { placa, km_atual, km_ultimo_servico: kmUltimoServico, data_ultimo_servico_km: dataUltimoServicoKm, data_ultimo_servico: dataUltimoServico } of entradas) {
      const km = Number(km_atual || 0);
      const intervalo = tipoControle === "km" ? Number(intervalo_km) : null;
      const intervaloDias = tipoControle === "data" ? Number(intervalo_dias) : null;
      const { rows } = await pool.query(
        `INSERT INTO ${TABLE()} (
           placa, titulo, mensagem, intervalo_km, km_atual, km_proximo_envio,
           numeros, contato_id, contato_nome, contato_numero,
           tipo_controle, intervalo_dias, data_ultimo_servico, data_proximo_envio
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [
          placa,
          titulo,
          mensagem,
          intervalo,
          km,
          tipoControle === "km" && kmUltimoServico != null ? kmUltimoServico + intervalo : (tipoControle === "km" ? proximoKmProgramado(km, intervalo) : 0),
          contato.numeros,
          contato.contato_id,
          contato.contato_nome,
          contato.contato_numero,
          tipoControle,
          intervaloDias,
          tipoControle === "data" ? dataUltimoServico : null,
          tipoControle === "data" ? addDays(dataUltimoServico, intervaloDias) : null,
        ]
      );
      criados.push(rows[0]);
      if (tipoControle === "km" && kmUltimoServico != null && dataUltimoServicoKm) {
        await pool.query(`
          INSERT INTO ${HISTORY_TABLE()} (
            automacao_id, placa, tipo_movimento, descricao, data_servico, km_servico, observacao, criado_por
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `, [
          rows[0].id,
          placa,
          maintenanceMovementType(titulo),
          titulo,
          dataUltimoServicoKm,
          kmUltimoServico,
          "Referência informada na criação do plano",
          req.user?.id || null,
        ]);
      }
    }

    res.status(201).json({ automacoes: criados });
  } catch (error) {
    next(error);
  }
});

// PUT /api/manutencao/:id
manutencaoRouter.put("/manutencao/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      placa,
      titulo,
      mensagem,
      intervalo_km,
      intervalo_dias,
      tipo_controle,
      data_ultimo_servico,
      km_atual,
      ativo,
      numeros,
      contato_id,
      contato_nome,
      contato_numero,
    } = req.body;

    const sets = [];
    const vals = [];
    let i = 1;

    if (placa !== undefined)        { sets.push(`placa = $${i++}`);        vals.push(String(placa).toUpperCase().trim()); }
    if (titulo !== undefined)       { sets.push(`titulo = $${i++}`);       vals.push(titulo); }
    if (mensagem !== undefined)     { sets.push(`mensagem = $${i++}`);     vals.push(mensagem); }
    if (intervalo_km !== undefined) { sets.push(`intervalo_km = $${i++}`); vals.push(Number(intervalo_km)); }
    if (intervalo_dias !== undefined) { sets.push(`intervalo_dias = $${i++}`); vals.push(Number(intervalo_dias)); }
    if (tipo_controle !== undefined) { sets.push(`tipo_controle = $${i++}`); vals.push(tipo_controle === "data" ? "data" : "km"); }
    if (data_ultimo_servico !== undefined) {
      sets.push(`data_ultimo_servico = $${i++}`); vals.push(data_ultimo_servico || null);
      if (intervalo_dias !== undefined) {
        sets.push(`data_proximo_envio = $${i++}`); vals.push(addDays(data_ultimo_servico, intervalo_dias));
      }
    }
    if (km_atual !== undefined)     { sets.push(`km_atual = $${i++}`);     vals.push(Number(km_atual)); }
    if (ativo !== undefined)        { sets.push(`ativo = $${i++}`);        vals.push(Boolean(ativo)); }
    if (
      numeros !== undefined ||
      contato_id !== undefined ||
      contato_nome !== undefined ||
      contato_numero !== undefined
    ) {
      const contato = await resolveContato(req.body);
      if (!contato.numeros) {
        return res.status(400).json({ error: "Selecione ou cadastre um contato para envio." });
      }
      sets.push(`numeros = $${i++}`); vals.push(contato.numeros);
      sets.push(`contato_id = $${i++}`); vals.push(contato.contato_id);
      sets.push(`contato_nome = $${i++}`); vals.push(contato.contato_nome);
      sets.push(`contato_numero = $${i++}`); vals.push(contato.contato_numero);
    }
    // Recalcula km_proximo_envio se km_atual ou intervalo_km mudar
    if (km_atual !== undefined || intervalo_km !== undefined) {
      sets.push(`km_proximo_envio = $${i++}`);
      // Busca os valores atuais do registro para calcular corretamente
      const { rows: atual } = await pool.query(
        `SELECT km_atual, intervalo_km FROM ${TABLE()} WHERE id = $1`, [id]
      );
      if (atual.length > 0) {
        const novoKm = km_atual !== undefined ? Number(km_atual) : atual[0].km_atual;
        const novoIntervalo = intervalo_km !== undefined ? Number(intervalo_km) : atual[0].intervalo_km;
        vals.push(proximoKmProgramado(novoKm, novoIntervalo));
      } else {
        vals.push(0);
      }
    }
    sets.push(`atualizado_em = $${i++}`);
    vals.push(new Date());

    if (sets.length === 1) {
      return res.status(400).json({ error: "Nenhum campo para atualizar." });
    }

    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE ${TABLE()} SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
      vals
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Automação não encontrada." });
    }
    res.json({ automacao: rows[0] });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/manutencao/:id
manutencaoRouter.delete("/manutencao/:id", async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM ${TABLE()} WHERE id = $1`, [req.params.id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: "Automação não encontrada." });
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
