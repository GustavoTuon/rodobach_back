import { Router } from "express";
import { getRentabilidadeClientes } from "../services/rentabilidadeClientesService.js";
import { clientPool } from "../db/clientPool.js";

export const precoCargaErpV2Router = Router();

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((num(value) + Number.EPSILON) * factor) / factor;
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function routePart(value) {
  const normalized = normalize(value);
  const match = normalized.match(/^(.*)\/([A-Z]{2})$/);
  return match ? { cidade: match[1].trim(), uf: match[2] } : { cidade: normalized, uf: "" };
}

function average(rows, selector) {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + num(selector(row)), 0) / rows.length;
}

function quotationPeriod(months) {
  const amount = Math.min(36, Math.max(3, Number.parseInt(months, 10) || 24));
  const endDate = new Date().toISOString().slice(0, 10);
  const start = new Date(`${endDate}T12:00:00`);
  start.setMonth(start.getMonth() - amount);
  return { startDate: start.toISOString().slice(0, 10), endDate, months: amount };
}

async function getQuotationHistory({ startDate, endDate, ufOrigem, ufDestino, municipioOrigem, municipioDestino, placa, material, vendedor }) {
  const { rows } = await clientPool.query(`
    WITH base AS (
      SELECT
        ('cte:' || con.empresacon || ':' || con.seriecon || ':' || con.codigocon) AS id,
        con.dataemissaocon::date AS data,
        COALESCE(con.expedidorcon, con.clientecon) AS cliente_inicial_codigo,
        COALESCE(con.recebedorcon, con.destinatariocon) AS cliente_final_codigo,
        COALESCE(con.viagemcon, con.numeroviagemcon, con.cargacontroleviagemcon) AS viagem,
        COALESCE(NULLIF(TRIM(con.veiculocon::text), ''), '') AS placa,
        CONCAT_WS('/', origem.nomecid, TRIM(origem_uf.abreviaturaest)) AS origem,
        CONCAT_WS('/', destino.nomecid, TRIM(destino_uf.abreviaturaest)) AS destino,
        COALESCE(NULLIF(TRIM(natureza.nomenat), ''), NULLIF(con.tipocargacon::text, ''), 'Nao informado') AS material,
        COALESCE(con.pesocon, 0)::numeric AS peso,
        COALESCE(NULLIF(con.viagemvalorfretemotoristacon, 0), NULLIF(con.viagemvalorfretepesomotoristacon, 0), 0)::numeric AS valor_motorista,
        con.representantecon,
        COALESCE(NULLIF(con.totalcon, 0), NULLIF(con.valorfretecon, 0), 0)::numeric AS valor,
        con.empresacon
      FROM logistica.conhecimentos con
      JOIN localidades.cidades origem ON origem.codigocid=con.cidadecoletacon
      JOIN localidades.estados origem_uf ON origem_uf.codigoest=origem.estadocid
      JOIN localidades.cidades destino ON destino.codigocid=con.cidadeentregacon
      JOIN localidades.estados destino_uf ON destino_uf.codigoest=destino.estadocid
      LEFT JOIN LATERAL (
        SELECT n.nomenat
        FROM logistica.naturezascargas n
        WHERE n.codigonat=con.naturezacargacon
        ORDER BY (n.empresanat=con.empresacon) DESC, (n.empresanat=1) DESC, n.empresanat
        LIMIT 1
      ) natureza ON true
      WHERE con.dataemissaocon::date BETWEEN $1::date AND $2::date
        AND (con.statuscon = 2 OR UPPER(TRIM(con.seriecon)) IN ('O', 'OC') OR NULLIF(TRIM(con.chaveorcamentocon), '') IS NOT NULL)
        AND UPPER(TRIM(origem_uf.abreviaturaest))=$3
        AND UPPER(TRIM(destino_uf.abreviaturaest))=$4
        AND COALESCE(NULLIF(con.totalcon, 0), NULLIF(con.valorfretecon, 0), 0) > 1
        AND ($5::text='' OR REGEXP_REPLACE(UPPER(COALESCE(con.veiculocon::text, '')), '[^A-Z0-9]', '', 'g') ILIKE '%' || $5 || '%')
        AND ($6::text='' OR CONCAT_WS(' ', natureza.nomenat, con.naturezacargacon, con.tipocargacon, con.observacaonfcon) ILIKE '%' || $6 || '%')
        AND ($8::text='' OR TRANSLATE(UPPER(origem.nomecid), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC') ILIKE '%' || $8 || '%')
        AND ($9::text='' OR TRANSLATE(UPPER(destino.nomecid), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC') ILIKE '%' || $9 || '%')
    ), enriched AS (
      SELECT
        b.id, b.data,
        b.placa, b.origem, b.destino, b.material, b.peso, b.valor_motorista,
        COALESCE(NULLIF(cliente_inicial.fantasiacli, ''), NULLIF(cliente_inicial.nomecli, ''), 'Nao informado') AS cliente_inicial,
        COALESCE(NULLIF(cliente_final.fantasiacli, ''), NULLIF(cliente_final.nomecli, ''), 'Nao informado') AS cliente_final,
        COALESCE(NULLIF(TRIM(comercial.nome), ''), NULLIF(TRIM(b.representantecon::text), ''), 'Nao informado') AS vendedor,
        b.valor,
        COALESCE(viagem.km, 0)::numeric AS km,
        COUNT(*) OVER()::int AS quantidade_total,
        AVG(b.valor) OVER()::numeric AS media_total,
        MIN(b.valor) OVER()::numeric AS menor_total,
        MAX(b.valor) OVER()::numeric AS maior_total
      FROM base b
      LEFT JOIN LATERAL (SELECT nomecli, fantasiacli FROM gerais.clientes WHERE codigocli=b.cliente_inicial_codigo ORDER BY (empresacli=b.empresacon) DESC LIMIT 1) cliente_inicial ON true
      LEFT JOIN LATERAL (SELECT nomecli, fantasiacli FROM gerais.clientes WHERE codigocli=b.cliente_final_codigo ORDER BY (empresacli=b.empresacon) DESC LIMIT 1) cliente_final ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(NULLIF(TRIM(p.nomepes), ''), NULLIF(TRIM(p.fantasiapes), ''), r.codigorep::text) AS nome
        FROM logistica.representantes r LEFT JOIN gerais.pessoas p ON p.codigorepresentantepes=r.codigorep
        WHERE r.codigorep=b.representantecon LIMIT 1
      ) comercial ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(NULLIF(cvg.kmdiferencacvg, 0), NULLIF(COALESCE(cvg.kmchegadacvg, 0)-COALESCE(cvg.kmsaidacvg, 0), 0), 0)::numeric AS km
        FROM logistica.controleviagens cvg WHERE cvg.codigocvg=b.viagem LIMIT 1
      ) viagem ON true
      WHERE ($7::text='' OR COALESCE(comercial.nome, '') ILIKE '%' || $7 || '%')
    )
    SELECT * FROM enriched ORDER BY data DESC, id DESC LIMIT 500
  `, [startDate, endDate, ufOrigem, ufDestino, placa, material, vendedor, municipioOrigem, municipioDestino]);
  return rows;
}

async function getErpRouteHistory(input) {
  const origem = normalize(input.origem);
  const destino = normalize(input.destino);
  const ufOrigem = normalize(input.ufOrigem).slice(0, 2);
  const ufDestino = normalize(input.ufDestino).slice(0, 2);
  const key = `${origem}/${ufOrigem}:${destino}/${ufDestino}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.rows;

  const endDate = new Date().toISOString().slice(0, 10);
  const start = new Date(`${endDate}T12:00:00`);
  start.setFullYear(start.getFullYear() - 2);
  const result = await getRentabilidadeClientes({
    startDate: start.toISOString().slice(0, 10),
    endDate,
    origem: input.origem,
    destino: input.destino,
  });
  const rows = result.clientes.flatMap((client) => client.viagens).filter((viagem) => {
    const from = routePart(viagem.origem);
    const to = routePart(viagem.destino);
    return from.cidade === origem && from.uf === ufOrigem && to.cidade === destino && to.uf === ufDestino;
  });
  cache.set(key, { at: Date.now(), rows });
  return rows;
}

// Consulta somente dados fiscais e operacionais do ERP. A carga comercial atual
// serve apenas como entrada da rota e do valor que o usuario deseja comparar.
precoCargaErpV2Router.post("/cargas-viagens-v2/gestao/preco", async (req, res, next) => {
  try {
    const input = req.body || {};
    if (!normalize(input.origem) || !normalize(input.destino) || !normalize(input.ufOrigem) || !normalize(input.ufDestino)) {
      return res.status(400).json({ error: "Informe origem e destino para consultar o ERP." });
    }
    const rows = await getErpRouteHistory(input);
    const withCost = rows.filter((row) => num(row.custo) > 0);
    const receitaMedia = average(rows, (row) => row.receita);
    const custoMedio = average(withCost, (row) => row.custo);
    const margemAlvo = 15;
    const recomendadoPorCusto = custoMedio > 0 ? custoMedio / (1 - margemAlvo / 100) : 0;
    const precoSugerido = Math.max(receitaMedia, recomendadoPorCusto);
    const valorInformado = Math.max(0, num(input.valorCliente));
    const lucroEstimado = valorInformado - custoMedio;
    const margemEstimada = valorInformado > 0 && custoMedio > 0 ? (lucroEstimado / valorInformado) * 100 : 0;
    const samples = rows.length;
    const coverage = samples > 0 ? withCost.length / samples : 0;
    const baseScore = samples >= 8 ? 55 : samples >= 4 ? 42 : samples >= 2 ? 28 : samples ? 14 : 0;
    const confidenceScore = Math.round(Math.min(100, baseScore + coverage * 45));
    const confianca = confidenceScore >= 75 ? "alta" : confidenceScore >= 45 ? "media" : "baixa";
    const values = rows.map((row) => num(row.receita)).filter((value) => value > 0);
    const lastDate = rows.map((row) => row.data).filter(Boolean).sort().at(-1) || null;
    const componentAverage = (key) => average(withCost, (row) => row.custos?.[key]);

    res.json({
      fonte: "ERP: CT-es, viagens, abastecimentos, despesas, pedagios, diarias, motorista e manutencao vinculada.",
      suficienteParaCusto: withCost.length > 0,
      custoEstimado: round(custoMedio),
      precoMinimo: round(custoMedio),
      precoSugerido: round(precoSugerido),
      lucroEstimado: round(lucroEstimado),
      margemEstimada: round(margemEstimada),
      margemAlvo,
      confianca,
      confiancaPontos: confidenceScore,
      historico: {
        quantidade: samples,
        comCusto: withCost.length,
        media: round(receitaMedia),
        menor: round(values.length ? Math.min(...values) : 0),
        maior: round(values.length ? Math.max(...values) : 0),
        ultimaData: lastDate,
        exata: true,
      },
      composicao: {
        motorista: round(componentAverage("motorista")),
        abastecimentos: round(componentAverage("abastecimentos")),
        despesas: round(componentAverage("despesas")),
        pedagio: round(componentAverage("pedagio")),
        diarias: round(componentAverage("diarias")),
        manutencao: round(componentAverage("manutencao")),
        outros: round(componentAverage("outros")),
      },
    });
  } catch (error) { next(error); }
});

// Consulta comercial para referencia de cotacao. Nao expoe custos, margens,
// motoristas ou nomes de outros clientes; retorna apenas o historico de fretes.
precoCargaErpV2Router.post("/cargas-viagens-v2/gestao/cotacao", async (req, res, next) => {
  try {
    const input = req.body || {};
    const ufOrigem = normalize(input.ufOrigem).slice(0, 2);
    const ufDestino = normalize(input.ufDestino).slice(0, 2);
    const placa = normalize(input.placa).replace(/[^A-Z0-9]/g, "");
    const material = normalize(input.material);
    const vendedor = normalize(input.vendedor);
    const municipioOrigem = normalize(input.municipioOrigem);
    const municipioDestino = normalize(input.municipioDestino);
    if (!/^[A-Z]{2}$/.test(ufOrigem) || !/^[A-Z]{2}$/.test(ufDestino)) {
      return res.status(400).json({ error: "Informe as UFs de origem e destino." });
    }
    const period = quotationPeriod(input.meses);
    const key = `cotacao:${ufOrigem}:${municipioOrigem}:${ufDestino}:${municipioDestino}:${placa}:${material}:${vendedor}:${period.months}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) return res.json(cached.data);

    const rows = await getQuotationHistory({
      startDate: period.startDate, endDate: period.endDate,
      ufOrigem, ufDestino, municipioOrigem, municipioDestino, placa, material, vendedor,
    });
    const totals = rows[0] || {};
    const data = {
      filtros: { ufOrigem, ufDestino, municipioOrigem, municipioDestino, placa, material, vendedor, meses: period.months },
      periodo: { inicio: period.startDate, fim: period.endDate },
      resumo: {
        quantidade: Number(totals.quantidade_total || 0),
        media: round(totals.media_total),
        menor: round(totals.menor_total),
        maior: round(totals.maior_total),
        ultimaData: rows[0]?.data || null,
      },
      fretes: rows.map((row) => ({
        id: row.id,
        data: row.data,
        origem: row.origem,
        destino: row.destino,
        placa: row.placa,
        material: row.material,
        vendedor: row.vendedor,
        km: round(row.km),
        clienteInicial: row.cliente_inicial,
        clienteFinal: row.cliente_final,
        peso: round(row.peso),
        valorMotorista: round(row.valor_motorista),
        valor: round(row.valor),
      })),
      aviso: "Valores historicos para referencia comercial. A cotacao final deve considerar peso, material, pedagios e condicoes atuais.",
    };
    cache.set(key, { at: Date.now(), data });
    res.json(data);
  } catch (error) { next(error); }
});
