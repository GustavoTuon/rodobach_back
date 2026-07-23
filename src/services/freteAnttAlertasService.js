import { tableName } from "../config.js";
import { clientPool } from "../db/clientPool.js";
import { pool } from "../db/pool.js";

const MAX_KM_VALIDO = 10000;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function r2(value) {
  return Math.round((num(value) + Number.EPSILON) * 100) / 100;
}

function brl(value) {
  return num(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");
}

function clean(value) {
  return String(value || "").trim();
}

function todayIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDaysIso(base, days) {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function normalizeDate(value) {
  const raw = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function dateBR(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : "-";
}

function isoDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function routeText(row) {
  const origem = clean(row.origens) || clean(row.origem_pef) || "-";
  const destino = clean(row.destinos) || clean(row.destino_pef) || "-";
  return `${origem} -> ${destino}`;
}

function contratanteText(row) {
  const nome = clean(row.contratante) || clean(row.motorista) || "-";
  return nome;
}

function buildMensagem(alerta, { teste = false } = {}) {
  const lines = [
    "🚛 FRETE EMPRESA < TABELA ANTT",
    "",
    `📄 CONTRATO: ${alerta.contrato}`,
    `🏢 CLIENTE: ${alerta.cliente}`,
    `🚚 ROTA: ${alerta.rota}`,
    `📏 KM ROTA: ${num(alerta.kmRota).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`,
    `🚛 PLACA: ${alerta.placa}`,
    `⚙️ EIXOS: ${alerta.eixos}`,
    `🤝 CONTRATANTE: ${alerta.contratante}`,
    "",
    `💰 FRETE EMPRESA: ${brl(alerta.freteEmpresa)}`,
    `💸 FRETE TERCEIRO: ${brl(alerta.freteTerceiro)}`,
    `📊 ICMS ST: ${brl(alerta.icmsSt)}`,
    "",
    `📉 FRETE MÍNIMO (ANTT): ${brl(alerta.freteMinimoAntt)}`,
  ];

  if (teste) {
    lines.push("", alerta.divergente
      ? "TESTE: envio direcionado para Gustavo."
      : "TESTE: registro real de terceiro, sem divergencia ANTT. Envio direcionado para Gustavo.");
  }

  return lines.join("\n");
}

async function loadPefFretes({ startDate, endDate, testId, limit }) {
  const params = [];
  const where = [
    "COALESCE(vei.tipopropriedadevei::text, 'T') <> 'P'",
    "COALESCE(vei.numeroeixosvei, 0) > 0",
  ];

  if (testId) {
    params.push(Number(testId));
    where.push(`p.codigopfr = $${params.length}`);
  } else {
    params.push(startDate, endDate);
    where.push(`COALESCE(p.datahoraemissaopfr::date, p.datainiciopfr) BETWEEN $1::date AND $2::date`);
    where.push("p.statuspfr IN (1,3,4,7)");
    where.push("p.datacancelamentoefretepfr IS NULL");
  }

  params.push(Math.min(Math.max(Number(limit || 100), 1), 500));

  const { rows } = await clientPool.query(`
    SELECT
      p.empresapfr,
      p.seriepfr,
      p.codigopfr,
      p.datahoraemissaopfr,
      p.datainiciopfr,
      p.statuspfr,
      p.valorfretepfr,
      p.valorestimadopfr,
      p.valorirrfpfr,
      p.valorinsspfr,
      p.valorsestsenatpfr,
      p.valortotalimpostospfr,
      p.origempedagiopfr AS origem_pef,
      p.destinopedagiopfr AS destino_pef,
      p.codigocartafretepfr,
      p.seriecartafretepfr,
      pfv.veiculopfv,
      vei.placavei,
      vei.numeroeixosvei,
      vei.tipopropriedadevei,
      mot.nomemot AS motorista,
      cfr.valorfreteempresacfr,
      cfr.valorfretecfr,
      cfr.valorliquidocfr,
      cfr.valortotalimpostospefcfr,
      cfr.representantecfr,
      NULL::text AS contratante,
      COALESCE(NULLIF(p.distanciapfr, 0), NULLIF(pnr.totalkmpnr, 0)) AS km_rota,
      COALESCE(NULLIF(SUM(con.valorfretecon), 0), NULLIF(cfr.valorfreteempresacfr, 0), NULLIF(p.valorestimadopfr, 0), 0) AS frete_empresa,
      COALESCE(NULLIF(SUM(con.valoricmscon), 0), NULLIF(cfr.valortotalimpostospefcfr, 0), NULLIF(p.valortotalimpostospfr, 0), 0) AS icms_st,
      string_agg(DISTINCT CONCAT_WS('/', NULLIF(TRIM(origem.nomecid), ''), NULLIF(TRIM(origem_uf.abreviaturaest), '')), ', ') AS origens,
      string_agg(DISTINCT CONCAT_WS('/', NULLIF(TRIM(destino.nomecid), ''), NULLIF(TRIM(destino_uf.abreviaturaest), '')), ', ') AS destinos,
      string_agg(DISTINCT NULLIF(TRIM(cli.nomecli), ''), ', ') AS clientes
    FROM logistica.peffrete p
    JOIN logistica.peffreteveiculos pfv
      ON pfv.empresapfv = p.empresapfr
     AND pfv.codigopfv = p.codigopfr
     AND (pfv.seriepfv = p.seriepfr OR p.seriepfr IS NULL OR pfv.seriepfv IS NULL)
    JOIN LATERAL (
      SELECT placavei, tipopropriedadevei, numeroeixosvei
      FROM frotas.veiculos v
      WHERE regexp_replace(upper(v.placavei::text), '[^A-Z0-9]', '', 'g')
          = regexp_replace(upper(pfv.veiculopfv::text), '[^A-Z0-9]', '', 'g')
        AND NULLIF(TRIM(v.placavei::text), '') IS NOT NULL
      ORDER BY v.empresavei
      LIMIT 1
    ) vei ON true
    LEFT JOIN logistica.cartasfretes cfr
      ON cfr.empresacfr = p.empresapfr
     AND cfr.codigocfr = p.codigocartafretepfr
     AND (cfr.seriecfr = p.seriecartafretepfr OR p.seriecartafretepfr IS NULL OR cfr.seriecfr IS NULL)
    LEFT JOIN logistica.pefnddrota pnr
      ON pnr.empresapnr = p.empresapfr
     AND pnr.codigopnr = p.nddrotapfr
    LEFT JOIN logistica.cartasfretesconhecimentos cfc
      ON cfc.empresacfc = cfr.empresacfr
     AND cfc.seriecfc = cfr.seriecfr
     AND cfc.codigocfc = cfr.codigocfr
    LEFT JOIN logistica.conhecimentos con
      ON con.empresacon = cfc.empresaconhecimentocfc
     AND con.seriecon = cfc.serieconhecimentocfc
     AND con.codigocon = cfc.conhecimentocfc
    LEFT JOIN localidades.cidades origem ON origem.codigocid = con.cidadecoletacon
    LEFT JOIN localidades.estados origem_uf ON origem_uf.codigoest = origem.estadocid
    LEFT JOIN localidades.cidades destino ON destino.codigocid = con.cidadeentregacon
    LEFT JOIN localidades.estados destino_uf ON destino_uf.codigoest = destino.estadocid
    LEFT JOIN gerais.clientes cli ON cli.codigocli = con.clientecon
    LEFT JOIN frotas.motoristas mot ON mot.codigomot = cfr.motoristacfr
    WHERE ${where.join(" AND ")}
    GROUP BY
      p.empresapfr, p.seriepfr, p.codigopfr, p.datahoraemissaopfr, p.datainiciopfr, p.statuspfr,
      p.valorfretepfr, p.valorestimadopfr, p.valorirrfpfr, p.valorinsspfr, p.valorsestsenatpfr,
      p.valortotalimpostospfr, p.origempedagiopfr, p.destinopedagiopfr, p.codigocartafretepfr,
      p.seriecartafretepfr, pfv.veiculopfv, vei.placavei, vei.numeroeixosvei, vei.tipopropriedadevei,
      mot.nomemot, cfr.valorfreteempresacfr, cfr.valorfretecfr, cfr.valorliquidocfr,
      cfr.valortotalimpostospefcfr, cfr.representantecfr, p.distanciapfr, pnr.totalkmpnr
    ORDER BY COALESCE(p.datahoraemissaopfr, p.datainiciopfr::timestamp) DESC, p.codigopfr DESC
    LIMIT $${params.length}
  `, params);

  return rows;
}

async function loadTarifas(tipoCarga) {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (eixos, tipo_carga)
      eixos, tipo_carga, km_valor, carga_descarga
    FROM ${tableName("antt_tabela")}
    WHERE ativo = true AND tipo_carga = $1
    ORDER BY eixos, tipo_carga, data_vigencia DESC, atualizado_em DESC, id DESC
  `, [tipoCarga]);

  return new Map(rows.map((row) => [Number(row.eixos), row]));
}

function buildAlerta(row, tarifa, { teste = false } = {}) {
  const km = num(row.km_rota);
  const freteEmpresa = r2(row.frete_empresa);
  const freteTerceiro = r2(row.valorfretepfr || row.valorfretecfr || row.valorliquidocfr);
  const freteMinimoAntt = r2(km * num(tarifa.km_valor) + num(tarifa.carga_descarga));
  const excedente = r2(freteMinimoAntt - freteEmpresa);

  const alerta = {
    id: row.codigopfr,
    contrato: ["PEF", row.seriepfr, row.codigopfr].filter(Boolean).join("-"),
    data: isoDate(row.datahoraemissaopfr) || isoDate(row.datainiciopfr),
    cliente: clean(row.clientes) || "-",
    rota: routeText(row),
    kmRota: km,
    placa: clean(row.veiculopfv || row.placavei) || "-",
    eixos: Number(row.numeroeixosvei),
    contratante: contratanteText(row),
    freteEmpresa,
    freteTerceiro,
    icmsSt: r2(row.icms_st),
    freteMinimoAntt,
    excedente,
    tipoPropriedade: row.tipopropriedadevei || null,
    divergente: freteEmpresa < freteMinimoAntt,
  };

  return {
    ...alerta,
    mensagem: buildMensagem(alerta, { teste }),
  };
}

export async function getFreteAnttTerceirosAlertas(filters = {}) {
  const today = todayIso();
  const startDate = normalizeDate(filters.startDate || filters.data || filters.date) || addDaysIso(today, -1);
  const endDate = normalizeDate(filters.endDate || filters.data || filters.date) || startDate;
  const tipoCarga = clean(filters.tipoCarga) || "normal";
  const testId = filters.testId || filters.id || null;
  const teste = String(filters.teste || filters.test || "").toLowerCase() === "true" || Boolean(testId);

  const [fretes, tarifas] = await Promise.all([
    loadPefFretes({ startDate, endDate, testId, limit: filters.limit }),
    loadTarifas(tipoCarga),
  ]);

  const alertas = [];
  const pendencias = [];

  for (const row of fretes) {
    const eixos = Number(row.numeroeixosvei);
    const km = num(row.km_rota);
    const freteEmpresa = num(row.frete_empresa);
    const tarifa = tarifas.get(eixos);

    if (!Number.isFinite(km) || km <= 0) {
      pendencias.push({ id: row.codigopfr, placa: row.veiculopfv, motivo: "PEF sem KM de rota." });
      continue;
    }
    if (km > MAX_KM_VALIDO) {
      pendencias.push({ id: row.codigopfr, placa: row.veiculopfv, km, motivo: "KM de rota acima do limite de validacao." });
      continue;
    }
    if (!Number.isFinite(eixos) || eixos <= 0) {
      pendencias.push({ id: row.codigopfr, placa: row.veiculopfv, motivo: "Veiculo sem numero de eixos." });
      continue;
    }
    if (!tarifa) {
      pendencias.push({ id: row.codigopfr, placa: row.veiculopfv, eixos, motivo: "Tabela ANTT nao encontrada para os eixos/tipo de carga." });
      continue;
    }
    if (freteEmpresa <= 0) {
      pendencias.push({ id: row.codigopfr, placa: row.veiculopfv, motivo: "PEF sem frete empresa/CT-e vinculado." });
      continue;
    }

    const alerta = buildAlerta(row, tarifa, { teste });
    if (teste || alerta.divergente) alertas.push(alerta);
  }

  return {
    periodo: { startDate, endDate },
    tipoCarga,
    teste,
    fonte: "pef_efrete",
    totalFretes: fretes.length,
    totalAlertas: alertas.length,
    totalPendencias: pendencias.length,
    alertas,
    pendencias,
    mensagem: alertas[0]?.mensagem || null,
    audit: {
      fonte: "logistica.peffrete + cartasfretes + conhecimentos + frotas.veiculos + antt_tabela",
      regra: "Somente terceiros: frotas.veiculos.tipopropriedadevei diferente de P.",
      comparacao: "Dispara quando o frete empresa do CT-e/carta for menor que o minimo ANTT calculado por KM, eixos e tipo de carga.",
      km: "Usa peffrete.distanciapfr; se vazio/zero, tenta pefnddrota.totalkmpnr. KM acima de 10.000 entra como pendencia.",
      icmsSt: "Usa ICMS dos CT-es vinculados; se vazio, tenta impostos do PEF/carta.",
      dataReferencia: teste ? `PEF ${testId}` : `${dateBR(startDate)} ate ${dateBR(endDate)}`,
    },
  };
}
