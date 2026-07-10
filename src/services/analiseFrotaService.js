import { clientPool } from "../db/clientPool.js";
import { getCustosVeiculos } from "./custosVeiculosService.js";
import { getDreEmpresarial } from "./dreEmpresarialService.js";
import { getManutencoesVeiculos } from "./manutencoesVeiculosService.js";
import { getTelemetriaResumoPorPlaca } from "./telemetriaResumoService.js";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return Math.round(num(value) * 100) / 100;
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function monthLabel(value) {
  if (!value) return "-";
  const [year, month] = String(value).split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  if (Number.isNaN(date.getTime())) return value;
  const label = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(date).replace(".", "");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}/${String(year).slice(2)}`;
}

function todayISO() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}

function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}

function resolvePeriod(filters = {}) {
  return {
    startDate: dateOnly(filters.startDate || filters.dataInicio) || daysAgoISO(29),
    endDate: dateOnly(filters.endDate || filters.dataFim) || todayISO(),
  };
}

function normalizeOwner(value) {
  const raw = String(value || "frota").toLowerCase();
  if (["todos", "terceiro", "terceiros"].includes(raw)) return raw === "terceiros" ? "terceiro" : raw;
  return "frota";
}

function filterClause(filters, params) {
  const where = ["a.dataaba::date BETWEEN $1::date AND $2::date"];

  if (filters.placa) {
    params.push(String(filters.placa).trim().toUpperCase());
    where.push(`UPPER(TRIM(a.veiculoaba::text)) = $${params.length}`);
  }
  if (filters.centro) {
    params.push(String(filters.centro).trim());
    where.push(`(v.centrocustovei::text = $${params.length} OR c.nomeccs ILIKE '%' || $${params.length} || '%')`);
  }
  if (filters.empresa) {
    params.push(String(filters.empresa).trim());
    where.push(`a.empresaaba::text = $${params.length}`);
  }
  if (filters.fornecedor) {
    params.push(String(filters.fornecedor).trim());
    where.push(`a.postocombustivelaba::text = $${params.length}`);
  }
  if (filters.modelo) {
    params.push(`%${String(filters.modelo).trim()}%`);
    where.push(`COALESCE(v.modelovei::text, v.marcamodelorenavamvei::text, '') ILIKE $${params.length}`);
  }
  if (filters.marca) {
    params.push(`%${String(filters.marca).trim()}%`);
    where.push(`COALESCE(m.nomemar::text, v.marcavei::text, '') ILIKE $${params.length}`);
  }
  if (filters.ano) {
    params.push(String(filters.ano).trim());
    where.push(`v.anomodelovei::text = $${params.length}`);
  }

  const owner = normalizeOwner(filters.proprietario);
  if (owner === "frota") where.push(`v.tipopropriedadevei::text = 'P'`);
  if (owner === "terceiro") where.push(`COALESCE(v.tipopropriedadevei::text, 'T') <> 'P'`);

  return where.join(" AND ");
}

export async function getAbastecimento(filters = {}) {
  const period = resolvePeriod(filters);
  const params = [period.startDate, period.endDate];
  const where = filterClause(filters, params);
  const telemetria = getTelemetriaResumoPorPlaca(filters);
  const telemetriaPorPlaca = new Map(telemetria.byPlate.map((row) => [row.placa, row]));

  const baseJoin = `
    FROM frotas.abastecimentos a
    LEFT JOIN LATERAL (
      SELECT v.*
      FROM frotas.veiculos v
      WHERE UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(a.veiculoaba::text))
        AND NULLIF(TRIM(v.placavei::text), '') IS NOT NULL
      ORDER BY (v.empresavei = a.empresaaba) DESC, v.empresavei
      LIMIT 1
    ) v ON true
    LEFT JOIN financeiro.centroscustos c
      ON c.codigoccs = v.centrocustovei
     AND (c.empresaccs = v.empresavei OR c.empresaccs IS NULL)
    LEFT JOIN frotas.marcas m
      ON m.codigomar = v.marcavei
     AND (m.empresamar = v.empresavei OR m.empresamar IS NULL)
    LEFT JOIN LATERAL (
      SELECT
        f.codigofor,
        COALESCE(NULLIF(f.fantasiafor, ''), NULLIF(f.nomefor, ''), 'Posto ' || f.codigofor::text) AS nome_posto,
        f.enderecofor,
        f.bairrofor,
        f.cepfor,
        cid.nomecid AS cidade,
        est.abreviaturaest AS uf
      FROM gerais.fornecedores f
      LEFT JOIN localidades.cep z ON z.codigocep::text = regexp_replace(COALESCE(f.cepfor::text, ''), '\\D', '', 'g')
      LEFT JOIN localidades.cidades cid ON cid.codigocid = z.cidadecep
      LEFT JOIN localidades.estados est ON est.codigoest = cid.estadocid
      WHERE f.codigofor = a.postocombustivelaba
      ORDER BY (f.empresafor = a.empresaaba) DESC, f.empresafor
      LIMIT 1
    ) posto ON true
    LEFT JOIN LATERAL (
      SELECT p.nomepro AS nome_combustivel
      FROM estoque.produtos p
      WHERE p.codigopro = a.combustivelaba
      ORDER BY (p.empresapro = a.empresaaba) DESC, p.empresapro
      LIMIT 1
    ) produto ON true
    WHERE ${where}
      AND COALESCE(produto.nome_combustivel, '') ILIKE '%DIESEL%'
  `;

  const [summary, byVehicle, byModel, byBrand, bySupplier, rows, previous, monthly] = await Promise.all([
    clientPool.query(`
      SELECT
        COALESCE(SUM(a.litrosaba), 0) AS litros,
        COALESCE(SUM(a.totalaba), 0) AS total,
        COALESCE(SUM(a.diferencakilometragemaba), 0) AS km,
        COUNT(*)::int AS abastecimentos,
        COUNT(DISTINCT UPPER(TRIM(a.veiculoaba::text)))::int AS veiculos,
        AVG(NULLIF(a.valorlitroaba, 0)) AS preco_medio
      ${baseJoin}
    `, params),
    clientPool.query(`
      SELECT
        UPPER(TRIM(a.veiculoaba::text)) AS placa,
        COALESCE(NULLIF(v.modelovei, ''), NULLIF(v.marcamodelorenavamvei, ''), 'Nao informado') AS modelo,
        COALESCE(SUM(a.litrosaba), 0) AS litros,
        COALESCE(SUM(a.totalaba), 0) AS total,
        COALESCE(SUM(a.diferencakilometragemaba), 0) AS km,
        AVG(NULLIF(a.mediaaba, 0)) AS media,
        AVG(NULLIF(a.valorkilometragemaba, 0)) AS reais_km
      ${baseJoin}
      GROUP BY UPPER(TRIM(a.veiculoaba::text)), COALESCE(NULLIF(v.modelovei, ''), NULLIF(v.marcamodelorenavamvei, ''), 'Nao informado')
      ORDER BY total DESC
      LIMIT 15
    `, params),
    clientPool.query(`
      SELECT COALESCE(NULLIF(v.modelovei, ''), NULLIF(v.marcamodelorenavamvei, ''), 'Nao informado') AS modelo, AVG(NULLIF(a.mediaaba, 0)) AS media, COALESCE(SUM(a.totalaba), 0) AS total, COUNT(DISTINCT UPPER(TRIM(a.veiculoaba::text)))::int AS veiculos
      ${baseJoin}
      GROUP BY COALESCE(NULLIF(v.modelovei, ''), NULLIF(v.marcamodelorenavamvei, ''), 'Nao informado')
      ORDER BY total DESC
      LIMIT 10
    `, params),
    clientPool.query(`
      SELECT COALESCE(NULLIF(m.nomemar, ''), 'Marca ' || COALESCE(v.marcavei::text, '-')) AS marca, AVG(NULLIF(a.mediaaba, 0)) AS media, COALESCE(SUM(a.totalaba), 0) AS total, COUNT(DISTINCT UPPER(TRIM(a.veiculoaba::text)))::int AS veiculos
      ${baseJoin}
      GROUP BY COALESCE(NULLIF(m.nomemar, ''), 'Marca ' || COALESCE(v.marcavei::text, '-'))
      ORDER BY total DESC
      LIMIT 10
    `, params),
    clientPool.query(`
      SELECT
        COALESCE(a.postocombustivelaba::text, 'Nao informado') AS fornecedor_codigo,
        COALESCE(posto.nome_posto, 'Posto ' || a.postocombustivelaba::text, 'Nao informado') AS fornecedor,
        posto.cidade,
        posto.uf,
        posto.enderecofor AS endereco,
        posto.bairrofor AS bairro,
        COALESCE(SUM(a.totalaba), 0) AS total,
        COALESCE(SUM(a.litrosaba), 0) AS litros,
        AVG(NULLIF(a.valorlitroaba, 0)) AS preco_medio,
        MAX(NULLIF(a.valorlitroaba, 0)) AS maior_preco,
        MIN(NULLIF(a.valorlitroaba, 0)) AS menor_preco,
        COUNT(*)::int AS abastecimentos
      ${baseJoin}
      GROUP BY a.postocombustivelaba, posto.nome_posto, posto.cidade, posto.uf, posto.enderecofor, posto.bairrofor
      ORDER BY total DESC
    `, params),
    clientPool.query(`
      SELECT
        a.dataaba::date AS data,
        UPPER(TRIM(a.veiculoaba::text)) AS placa,
        a.litrosaba AS litros,
        a.valorlitroaba AS valor_litro,
        a.totalaba AS total,
        a.diferencakilometragemaba AS km,
        a.mediaaba AS media,
        a.postocombustivelaba AS posto,
        COALESCE(posto.nome_posto, 'Posto ' || a.postocombustivelaba::text) AS posto_nome,
        posto.cidade AS posto_cidade,
        posto.uf AS posto_uf,
        produto.nome_combustivel AS combustivel,
        a.financeiroaba AS financeiro
      ${baseJoin}
      ORDER BY a.dataaba DESC, a.codigoaba DESC
    `, params),
    clientPool.query(`
      SELECT AVG(NULLIF(a.valorlitroaba, 0)) AS preco_medio
      FROM frotas.abastecimentos a
      WHERE a.dataaba::date BETWEEN ($1::date - (($2::date - $1::date) + 1)) AND ($1::date - 1)
    `, [period.startDate, period.endDate]).catch(() => ({ rows: [] })),
    clientPool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', a.dataaba), 'YYYY-MM') AS mes,
        AVG(NULLIF(a.valorlitroaba, 0)) AS preco_medio,
        COALESCE(SUM(a.litrosaba), 0) AS litros,
        COALESCE(SUM(a.totalaba), 0) AS total
      ${baseJoin}
      GROUP BY DATE_TRUNC('month', a.dataaba), TO_CHAR(DATE_TRUNC('month', a.dataaba), 'YYYY-MM')
      ORDER BY DATE_TRUNC('month', a.dataaba)
    `, params),
  ]);

  const s = summary.rows[0] || {};
  const total = money(s.total);
  const litros = money(s.litros);
  const km = money(s.km);
  const precoMedio = money(s.preco_medio);
  const precoAnterior = money(previous.rows[0]?.preco_medio);
  const mediaFrota = telemetria.summary.mediaConsumoKmL || (litros > 0 ? money(km / litros) : 0);

  const rankingRows = byVehicle.rows.map((row) => {
    const placa = row.placa || "Sem placa";
    const telemetriaPlaca = telemetriaPorPlaca.get(placa);
    return {
      placa,
      modelo: telemetriaPlaca?.modelo || row.modelo || "Nao informado",
      litros: telemetriaPlaca?.consumoTotalLitros || money(row.litros),
      total: money(row.total),
      km: telemetriaPlaca?.distanciaKm || money(row.km),
      media: telemetriaPlaca?.mediaConsumoKmL || money(row.media),
      mediaAbastecimento: money(row.media),
      mediaTelemetria: telemetriaPlaca?.mediaConsumoKmL || 0,
      consumoTotalTelemetria: telemetriaPlaca?.consumoTotalLitros || 0,
      kmTelemetria: telemetriaPlaca?.distanciaKm || 0,
      origemConsumo: telemetriaPlaca ? "telemetria" : "abastecimento",
      reaisKm: num(row.km) > 0 ? money(row.total / row.km) : money(row.reais_km),
    };
  });

  for (const telemetriaPlaca of telemetria.byPlate) {
    if (rankingRows.some((row) => row.placa === telemetriaPlaca.placa)) continue;
    rankingRows.push({
      placa: telemetriaPlaca.placa,
      modelo: telemetriaPlaca.modelo || "Telemetria",
      marca: telemetriaPlaca.marca || "",
      litros: telemetriaPlaca.consumoTotalLitros,
      total: 0,
      km: telemetriaPlaca.distanciaKm,
      media: telemetriaPlaca.mediaConsumoKmL,
      mediaAbastecimento: 0,
      mediaTelemetria: telemetriaPlaca.mediaConsumoKmL,
      consumoTotalTelemetria: telemetriaPlaca.consumoTotalLitros,
      kmTelemetria: telemetriaPlaca.distanciaKm,
      origemConsumo: "telemetria",
      reaisKm: 0,
    });
  }
  const postoRows = bySupplier.rows.map((row) => ({
    codigo: row.fornecedor_codigo,
    fornecedor: row.fornecedor,
    cidade: row.cidade || "",
    uf: row.uf || "",
    endereco: row.endereco || "",
    bairro: row.bairro || "",
    total: money(row.total),
    litros: money(row.litros),
    precoMedio: money(row.preco_medio),
    maiorPreco: money(row.maior_preco),
    menorPreco: money(row.menor_preco),
    abastecimentos: num(row.abastecimentos),
  }));
  const precoMedioPostos = litros > 0 ? total / litros : 0;
  const postosComAmostra = postoRows.filter((row) => row.precoMedio > 0 && row.litros > 0 && row.abastecimentos >= 3);
  const postosComPreco = postoRows.filter((row) => row.precoMedio > 0 && row.litros > 0);
  const baseReferencia = postosComAmostra.length ? postosComAmostra : postosComPreco;
  const precoReferencia = baseReferencia.length
    ? Math.min(...baseReferencia.map((row) => row.precoMedio))
    : 0;
  const fornecedores = postoRows.map((row) => ({
    ...row,
    participacao: total > 0 ? money((row.total / total) * 100) : 0,
    diferencaPreco: precoMedioPostos > 0 ? money(((row.precoMedio / precoMedioPostos) - 1) * 100) : 0,
    gastoAcimaMedia: precoMedioPostos > 0 ? money(Math.max(0, row.precoMedio - precoMedioPostos) * row.litros) : 0,
    economiaPotencial: precoReferencia > 0 ? money(Math.max(0, row.precoMedio - precoReferencia) * row.litros) : 0,
  }));
  const economiaPotencial = money(fornecedores.reduce((sum, row) => sum + row.economiaPotencial, 0));

  // Alertas calculados no backend: consumo baixo (< 85% da media da frota),
  // Posto caro considera preco por litro, ponderado pelos litros da frota.
  const alertas = {
    veiculosConsumoBaixo: rankingRows
      .filter((row) => row.media > 0 && mediaFrota > 0 && row.media < mediaFrota * 0.85)
      .sort((a, b) => a.media - b.media)
      .slice(0, 8)
      .map((row) => ({ placa: row.placa, media: row.media, mediaFrota, percentual: money((row.media / mediaFrota) * 100) })),
    postosPrecoAlto: fornecedores
      .filter((row) => row.abastecimentos >= 3 && row.precoMedio > precoMedioPostos * 1.05)
      .sort((a, b) => b.gastoAcimaMedia - a.gastoAcimaMedia)
      .slice(0, 8)
      .map((row) => ({
        fornecedor: row.fornecedor,
        valorMedio: row.precoMedio,
        mediaGeral: money(precoMedioPostos),
        diferencaPreco: row.diferencaPreco,
        gastoAcimaMedia: row.gastoAcimaMedia,
      })),
  };

  return {
    summary: {
      litros,
      valor: total,
      precoMedio,
      precoMedioPonderado: money(precoMedioPostos),
      km,
      reaisKm: km > 0 ? money(total / km) : 0,
      mediaFrota,
      mediaTelemetria: telemetria.summary.mediaConsumoKmL,
      kmTelemetria: telemetria.summary.distanciaKm,
      consumoTotalTelemetria: telemetria.summary.consumoTotalLitros,
      mediaVeiculo: byVehicle.rows.length ? money(litros / byVehicle.rows.length) : 0,
      veiculos: num(s.veiculos),
      abastecimentos: num(s.abastecimentos),
      variacaoPreco: precoAnterior > 0 ? money(((precoMedio - precoAnterior) / precoAnterior) * 100) : null,
      economiaPotencial,
      precoReferencia: money(precoReferencia),
    },
    telemetria,
    ranking: rankingRows,
    modelos: byModel.rows.map((row) => ({ modelo: row.modelo, media: money(row.media), total: money(row.total), veiculos: num(row.veiculos) })),
    marcas: byBrand.rows.map((row) => ({ marca: row.marca, media: money(row.media), total: money(row.total), veiculos: num(row.veiculos) })),
    fornecedores,
    postosCaros: [...fornecedores].filter((row) => row.precoMedio > 0).sort((a, b) => b.precoMedio - a.precoMedio).slice(0, 10),
    postosBaratos: [...fornecedores].filter((row) => row.precoMedio > 0).sort((a, b) => a.precoMedio - b.precoMedio).slice(0, 10),
    monthly: monthly.rows.map((row) => ({
      mes: row.mes,
      label: monthLabel(row.mes),
      precoMedio: money(row.preco_medio),
      litros: money(row.litros),
      total: money(row.total),
    })),
    alertas,
    lancamentos: rows.rows.map((row) => ({
      data: dateOnly(row.data),
      placa: row.placa,
      litros: money(row.litros),
      valorLitro: money(row.valor_litro),
      total: money(row.total),
      km: money(row.km),
      media: money(row.media),
      posto: row.posto,
      postoNome: row.posto_nome,
      postoCidade: row.posto_cidade,
      postoUf: row.posto_uf,
      combustivel: row.combustivel,
      financeiro: Boolean(row.financeiro),
    })),
  };
}

async function getFleetInventory(filters = {}) {
  const owner = normalizeOwner(filters.proprietario);
  const where = ["COALESCE(v.situacaovei::text, '') <> 'I'"];
  const params = [];
  if (owner === "frota") where.push("v.tipopropriedadevei::text = 'P'");
  if (owner === "terceiro") where.push("COALESCE(v.tipopropriedadevei::text, 'T') <> 'P'");
  if (filters.placa) {
    params.push(String(filters.placa).trim().toUpperCase());
    where.push(`UPPER(TRIM(v.placavei::text)) = $${params.length}`);
  }
  if (filters.modelo) {
    params.push(`%${String(filters.modelo).trim()}%`);
    where.push(`COALESCE(v.modelovei::text, v.marcamodelorenavamvei::text, '') ILIKE $${params.length}`);
  }
  if (filters.marca) {
    params.push(`%${String(filters.marca).trim()}%`);
    where.push(`COALESCE(m.nomemar::text, v.marcavei::text, '') ILIKE $${params.length}`);
  }
  if (filters.ano) {
    params.push(String(filters.ano).trim());
    where.push(`v.anomodelovei::text = $${params.length}`);
  }

  const result = await clientPool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE COALESCE(v.tipopropriedadevei::text, 'T') <> 'P')::int AS terceiros,
      COUNT(*) FILTER (WHERE v.tipopropriedadevei::text = 'P')::int AS frota
    FROM frotas.veiculos v
    LEFT JOIN frotas.marcas m
      ON m.codigomar = v.marcavei
     AND (m.empresamar = v.empresavei OR m.empresamar IS NULL)
    WHERE ${where.join(" AND ")}
  `, params);
  return {
    total: num(result.rows[0]?.total),
    frota: num(result.rows[0]?.frota),
    terceiros: num(result.rows[0]?.terceiros),
  };
}

async function getVehicleMetaMap(plates = []) {
  const list = [...new Set(plates.map((plate) => String(plate || "").trim().toUpperCase()).filter(Boolean))];
  if (!list.length) return new Map();
  const { rows } = await clientPool.query(
    `
      SELECT DISTINCT ON (UPPER(TRIM(v.placavei::text)))
        UPPER(TRIM(v.placavei::text)) AS placa,
        COALESCE(NULLIF(m.nomemar, ''), 'Marca ' || COALESCE(v.marcavei::text, '-')) AS marca,
        COALESCE(NULLIF(v.modelovei, ''), NULLIF(v.marcamodelorenavamvei, ''), 'Nao informado') AS modelo,
        v.anomodelovei AS ano_modelo,
        v.tipopropriedadevei AS tipo_propriedade
      FROM frotas.veiculos v
      LEFT JOIN frotas.marcas m
        ON m.codigomar = v.marcavei
       AND (m.empresamar = v.empresavei OR m.empresamar IS NULL)
      WHERE UPPER(TRIM(v.placavei::text)) = ANY($1::text[])
      ORDER BY UPPER(TRIM(v.placavei::text)), v.empresavei
    `,
    [list],
  );
  return new Map(rows.map((row) => [row.placa, row]));
}

function buildDreFleetAggregates(rows = [], filters = {}, vehicleMap = new Map()) {
  const owner = normalizeOwner(filters.proprietario);
  const filtered = rows.filter((row) => {
    const placa = String(row.placa || "").trim().toUpperCase();
    if (!placa) return false;
    const meta = vehicleMap.get(placa) || {};
    if (owner === "frota" && String(meta.tipo_propriedade || "") !== "P") return false;
    if (owner === "terceiro" && String(meta.tipo_propriedade || "T") === "P") return false;
    if (filters.modelo && !String(meta.modelo || row.veiculoNome || "").toLowerCase().includes(String(filters.modelo).toLowerCase())) return false;
    if (filters.marca && !String(meta.marca || "").toLowerCase().includes(String(filters.marca).toLowerCase())) return false;
    if (filters.ano && String(meta.ano_modelo || "") !== String(filters.ano)) return false;
    if (filters.centro && Number.isNaN(Number(filters.centro))) {
      const text = String(filters.centro).toLowerCase();
      if (!String(row.centroCusto || "").toLowerCase().includes(text)) return false;
    }
    return true;
  });

  const byPlate = new Map();
  const byMonth = new Map();
  for (const row of filtered) {
    const placa = String(row.placa || "").trim().toUpperCase();
    const valor = num(row.valor);
    const receita = valor > 0 ? valor : 0;
    const custo = valor < 0 ? Math.abs(valor) : 0;
    const plate = byPlate.get(placa) || { placa, receita: 0, custo: 0, lancamentos: 0 };
    plate.receita += receita;
    plate.custo += custo;
    plate.lancamentos += num(row.lancamentos) || 1;
    byPlate.set(placa, plate);

    const mes = dateOnly(row.mes || row.data)?.slice(0, 7);
    if (mes) {
      const monthly = byMonth.get(mes) || { mes, label: monthLabel(mes), receita: 0, custo: 0, lancamentos: 0 };
      monthly.receita += receita;
      monthly.custo += custo;
      monthly.lancamentos += num(row.lancamentos) || 1;
      byMonth.set(mes, monthly);
    }
  }

  const vehicles = [...byPlate.values()].map((row) => {
    const lucro = money(row.receita - row.custo);
    return {
      ...row,
      receita: money(row.receita),
      custo: money(row.custo),
      lucro,
      margem: row.receita > 0 ? money((lucro / row.receita) * 100) : (lucro < 0 ? -100 : 0),
      statusResultado: lucro >= 0 ? "lucro" : "prejuizo",
    };
  }).sort((a, b) => b.receita - a.receita || b.custo - a.custo);

  const receitaTotal = money(vehicles.reduce((sum, row) => sum + row.receita, 0));
  const custoTotal = money(vehicles.reduce((sum, row) => sum + row.custo, 0));
  const lucroTotal = money(receitaTotal - custoTotal);
  const monthly = [...byMonth.values()].sort((a, b) => String(a.mes).localeCompare(String(b.mes))).map((row) => ({
    ...row,
    receita: money(row.receita),
    custo: money(row.custo),
    lucro: money(row.receita - row.custo),
  }));

  return {
    summary: {
      receitaTotal,
      custoTotal,
      lucroTotal,
      margem: receitaTotal > 0 ? money((lucroTotal / receitaTotal) * 100) : (lucroTotal < 0 ? -100 : 0),
      veiculos: vehicles.length,
      veiculosLucro: vehicles.filter((row) => row.lucro >= 0).length,
      veiculosPrejuizo: vehicles.filter((row) => row.lucro < 0).length,
      veiculosCustoSemReceita: vehicles.filter((row) => row.custo > 0 && row.receita === 0).length,
      lancamentos: filtered.reduce((sum, row) => sum + (num(row.lancamentos) || 1), 0),
    },
    vehicles,
    monthly,
    rankings: {
      lucro: [...vehicles].sort((a, b) => b.lucro - a.lucro).slice(0, 15),
      prejuizo: vehicles.filter((row) => row.lucro < 0).sort((a, b) => a.lucro - b.lucro).slice(0, 15),
      custo: [...vehicles].sort((a, b) => b.custo - a.custo).slice(0, 15),
    },
  };
}

async function getDreFleetView(filters = {}) {
  const dreFilters = {
    startDate: filters.startDate,
    endDate: filters.endDate,
    tipo: filters.placa ? "todos" : "frota",
    placa: filters.placa,
    centro: filters.centro && !Number.isNaN(Number(filters.centro)) ? Number(filters.centro) : undefined,
    status: ["pago", "aberto", "vencido", "pendente"].includes(String(filters.situacao || "").toLowerCase())
      ? String(filters.situacao).toLowerCase()
      : "todos",
  };
  const dre = await getDreEmpresarial(dreFilters);
  const plates = dre.rows.map((row) => row.placa).filter(Boolean);
  const vehicleMap = await getVehicleMetaMap(plates);
  const aggregates = buildDreFleetAggregates(dre.rows, filters, vehicleMap);
  return {
    period: dre.period,
    filters: dreFilters,
    sources: dre.sources,
    ...aggregates,
  };
}

async function buildManutencaoBi(manutencao = {}, filters = {}) {
  const ignoredCategories = new Set(["abastecimento", "multas", "despesas_viagem"]);
  const rows = Array.isArray(manutencao.lancamentos) ? manutencao.lancamentos : [];
  const maintenanceRows = rows.filter((row) => !ignoredCategories.has(row.categoria));
  const plates = [...new Set(maintenanceRows.map((row) => String(row.placa || "").trim().toUpperCase()).filter(Boolean))];
  const vehicleMap = new Map();

  if (plates.length) {
    const { rows: vehicles } = await clientPool.query(
      `
        SELECT DISTINCT ON (UPPER(TRIM(v.placavei::text)))
          UPPER(TRIM(v.placavei::text)) AS placa,
          COALESCE(NULLIF(m.nomemar, ''), 'Marca ' || COALESCE(v.marcavei::text, '-')) AS marca,
          COALESCE(NULLIF(v.modelovei, ''), NULLIF(v.marcamodelorenavamvei, ''), 'Nao informado') AS modelo,
          v.anomodelovei AS ano_modelo,
          v.centrocustovei AS centro_codigo,
          c.nomeccs AS centro_custo,
          v.tipopropriedadevei AS tipo_propriedade
        FROM frotas.veiculos v
        LEFT JOIN frotas.marcas m
          ON m.codigomar = v.marcavei
         AND (m.empresamar = v.empresavei OR m.empresamar IS NULL)
        LEFT JOIN financeiro.centroscustos c
          ON c.codigoccs = v.centrocustovei
         AND (c.empresaccs = v.empresavei OR c.empresaccs IS NULL)
        WHERE UPPER(TRIM(v.placavei::text)) = ANY($1::text[])
        ORDER BY UPPER(TRIM(v.placavei::text)), v.empresavei
      `,
      [plates],
    );
    for (const vehicle of vehicles) {
      vehicleMap.set(vehicle.placa, vehicle);
    }
  }

  function meta(row) {
    return vehicleMap.get(String(row.placa || "").trim().toUpperCase()) || {};
  }

  const filteredRows = maintenanceRows.filter((row) => {
    const vehicle = meta(row);
    if (normalizeOwner(filters.proprietario) === "frota" && String(vehicle.tipo_propriedade || "") !== "P") return false;
    if (normalizeOwner(filters.proprietario) === "terceiro" && String(vehicle.tipo_propriedade || "T") === "P") return false;
    if (filters.modelo && !String(vehicle.modelo || row.veiculoNome || "").toLowerCase().includes(String(filters.modelo).toLowerCase())) return false;
    if (filters.marca && !String(vehicle.marca || "").toLowerCase().includes(String(filters.marca).toLowerCase())) return false;
    if (filters.ano && String(vehicle.ano_modelo || "") !== String(filters.ano)) return false;
    return true;
  });

  function groupBy(keyFn) {
    const map = new Map();
    for (const row of filteredRows) {
      const key = keyFn(row) || "Nao informado";
      const current = map.get(key) || { nome: key, valor: 0, quantidade: 0 };
      current.valor += num(row.valorTotal);
      current.quantidade += 1;
      map.set(key, current);
    }
    return [...map.values()]
      .map((item) => ({ ...item, valor: money(item.valor) }))
      .sort((a, b) => b.valor - a.valor);
  }

  // OS externa: frotas.ordensservicosexterna(produtos/servicos) - pecas e mao de obra de terceiros.
  // OS interna: demais origens de manutencao.lancamentos (compras.notasfiscaisentrada, frotas.movimentacaomanutencoes) - pecas/NF compradas para manutencao feita na propria frota.
  const osExternaRows = filteredRows.filter((row) => String(row.origem || "").includes("ordensservicosexterna"));
  const osInternaRows = filteredRows.filter((row) => !String(row.origem || "").includes("ordensservicosexterna"));
  const total = filteredRows.reduce((sum, row) => sum + num(row.valorTotal), 0);
  const byPlaca = groupBy((row) => row.placa || "Sem placa").map((item) => {
    const vehicle = vehicleMap.get(item.nome) || {};
    return {
      placa: item.nome,
      valor: item.valor,
      quantidade: item.quantidade,
      modelo: vehicle.modelo || "",
      marca: vehicle.marca || "",
      anoModelo: vehicle.ano_modelo || null,
    };
  });
  const byModelo = groupBy((row) => meta(row).modelo || row.veiculoNome || "Nao informado");
  const byMarca = groupBy((row) => meta(row).marca || "Nao informado");
  const byAno = groupBy((row) => {
    const ano = meta(row).ano_modelo;
    return ano ? String(ano) : "Nao informado";
  });
  const fornecedores = groupBy((row) => row.fornecedor || "Nao informado");
  const categorias = groupBy((row) => row.categoriaLabel || row.categoria || "Outros");

  return {
    resumo: {
      custoTotal: money(total),
      quantidadeTotal: filteredRows.length,
      custoOsInterna: money(osInternaRows.reduce((sum, row) => sum + num(row.valorTotal), 0)),
      quantidadeOsInterna: osInternaRows.length,
      custoOsExterna: money(osExternaRows.reduce((sum, row) => sum + num(row.valorTotal), 0)),
      quantidadeOsExterna: osExternaRows.length,
      custoMedioVeiculo: byPlaca.length ? money(total / byPlaca.length) : 0,
      veiculos: byPlaca.length,
    },
    rankingPlacas: byPlaca.slice(0, 12),
    modelos: byModelo.slice(0, 10),
    marcas: byMarca.slice(0, 8),
    anosModelo: byAno.slice(0, 10),
    fornecedores: fornecedores.slice(0, 8),
    categorias: categorias.slice(0, 8),
    detalhe: filteredRows.slice(0, 160),
    validacao: {
      origemOsExterna: "frotas.ordensservicosexternaprodutos + frotas.ordensservicosexternaservicos",
      origemOsInterna: "Demais origens operacionais de manutencao sem abastecimento, multas e despesas de viagem; precisa validacao se o cliente exigir OS interna formal.",
      veiculo: "frotas.veiculos: placavei, marcavei, modelovei, anomodelovei, centrocustovei, tipopropriedadevei",
      regraFrota: "Filtro proprietario=frota considera somente tipopropriedadevei = 'P'; NULL e demais valores entram como terceiro.",
    },
  };
}

async function getSchemaMap() {
  const tables = [
    ["frotas", "veiculos"],
    ["financeiro", "pagar"],
    ["financeiro", "pagarrateios"],
    ["financeiro", "pagarpagamentos"],
    ["financeiro", "centroscustos"],
    ["financeiro", "contasfinanceiras"],
    ["logistica", "conhecimentos"],
    ["frotas", "abastecimentos"],
    ["frotas", "movimentacaomanutencoes"],
    ["frotas", "ordensservicosexterna"],
    ["frotas", "ordensservicosexternaprodutos"],
    ["frotas", "ordensservicosexternaservicos"],
  ];

  const found = await clientPool.query(
    `SELECT table_schema, table_name
     FROM information_schema.tables
     WHERE (table_schema, table_name) IN (SELECT * FROM unnest($1::text[], $2::text[]))
     ORDER BY table_schema, table_name`,
    [tables.map((item) => item[0]), tables.map((item) => item[1])],
  );

  return {
    usadas: found.rows.map((row) => `${row.table_schema}.${row.table_name}`),
    origemIndicadores: [
      { indicador: "Veiculos da frota, modelo, marca, ano, proprietario e centro de custo", origem: "frotas.veiculos + financeiro.centroscustos", confianca: "alta" },
      { indicador: "Custos pagos, em aberto e vencidos", origem: "financeiro.pagar + financeiro.pagarrateios + financeiro.pagarpagamentos", confianca: "alta" },
      { indicador: "Abastecimentos operacionais", origem: "frotas.abastecimentos", confianca: "media; registros com financeiroaba=true podem existir tambem no financeiro e sao destacados" },
      { indicador: "Manutencoes internas/externas e OS", origem: "frotas.movimentacaomanutencoes, frotas.ordensservicosexterna* e fontes ja mapeadas em manutencoesVeiculosService", confianca: "media/alta" },
      { indicador: "Receita e lucro por placa", origem: "logistica.conhecimentos para receita; custos financeiros/operacionais para despesas", confianca: "alta para receita CT-e, media para rateios de custos sem placa direta" },
      { indicador: "Auditoria de divergencias", origem: "custos resolvidos por placa/centro no servico de custos; checagens complementares da tela", confianca: "indicativo" },
    ],
    joins: [
      "Placa: UPPER(TRIM(frotas.veiculos.placavei)) = UPPER(TRIM(origem.veiculo/placa))",
      "Centro de custo: frotas.veiculos.centrocustovei = financeiro.centroscustos.codigoccs",
      "Rateio financeiro: financeiro.pagarrateios -> financeiro.pagar por empresa/serie/duplicata/parcela/fornecedor",
      "Receita: logistica.conhecimentos agrupado por veiculocon/placa e dataemissaocon",
    ],
    pendencias: [
      "Confirmar com o cliente quais centros de custo administrativos devem ser sempre excluidos da frota.",
      "Validar se todos os postos/fornecedores de abastecimento possuem cadastro nominal acessivel ao usuario atual.",
      "Confirmar regra final para registros operacionais ja transformados em financeiro, especialmente abastecimento e OS.",
    ],
  };
}

export async function getAnaliseFrota(filters = {}) {
  const period = resolvePeriod(filters);
  const normalized = {
    startDate: period.startDate,
    endDate: period.endDate,
    placa: filters.placa,
    centro: filters.centro,
    fornecedor: filters.fornecedor,
    empresa: filters.empresa,
    proprietario: normalizeOwner(filters.proprietario),
    tipoCusto: filters.tipoCusto,
    situacao: filters.situacao,
    modelo: filters.modelo,
    marca: filters.marca,
    ano: filters.ano,
    limit: filters.limit || 220,
  };

  const [custos, manutencao, abastecimento, inventario, mapa, dreFrota] = await Promise.all([
    getCustosVeiculos(normalized),
    getManutencoesVeiculos(normalized),
    getAbastecimento(normalized),
    getFleetInventory(normalized),
    getSchemaMap(),
    getDreFleetView(normalized),
  ]);
  const manutencaoBi = await buildManutencaoBi(manutencao, normalized);
  const dreSummary = dreFrota.summary || {};
  const lucroDre = {
    ...(custos.profit || {}),
    summary: dreSummary,
    vehicles: dreFrota.vehicles || [],
    rankings: dreFrota.rankings || {},
    monthly: dreFrota.monthly || [],
    fontes: {
      receita: "DRE Empresarial: financeiro.receber + valorliquidorateiosreceber, filtrado por placa.",
      custo: "DRE Empresarial: financeiro.pagar + valorliquidorateiospagar + movimentacao financeira, filtrado por placa.",
    },
  };

  return {
    period,
    filters: normalized,
    inventario,
    visaoGeral: {
      veiculosOperacao: inventario.total,
      custoTotal: dreSummary.custoTotal ?? custos.summary?.custoTotal ?? 0,
      custoPago: custos.summary?.custoPago || 0,
      custoAberto: custos.summary?.custoAberto || 0,
      custoVencido: custos.summary?.custoVencido || 0,
      receitaTotal: dreSummary.receitaTotal ?? custos.profit?.summary?.receitaTotal ?? 0,
      lucroTotal: dreSummary.lucroTotal ?? custos.profit?.summary?.lucroTotal ?? 0,
      margem: dreSummary.margem ?? custos.profit?.summary?.margem ?? 0,
      kmRodado: abastecimento.summary?.kmTelemetria || abastecimento.summary?.km || 0,
      litrosAbastecidos: abastecimento.summary?.consumoTotalTelemetria || abastecimento.summary?.litros || 0,
      custoPorKm: abastecimento.summary?.reaisKm || 0,
      mediaKmLitro: abastecimento.summary?.mediaFrota || 0,
    },
    custos,
    manutencao,
    manutencaoBi,
    abastecimento,
    lucro: lucroDre,
    dreFrota,
    auditoria: {
      ...(custos.audit || {}),
      lancamentosSemVeiculo: manutencao.semVeiculo || { total: 0 },
      avisos: [
        ...(custos.audit?.observacoes || []),
        "Abastecimentos com financeiro=true devem ser analisados para evitar duplicidade com contas a pagar.",
        "Receita, custo e lucro executivos da Frota BI usam a mesma base da DRE Empresarial para facilitar conciliacao.",
        "Mapa ou cidade/estado de abastecimento nao foi exibido porque frotas.abastecimentos nao possui cidade/UF direta no mapeamento usado.",
        "Classificacao preventiva x corretiva nao esta disponivel nas origens de manutencao mapeadas (OS externa, NF e movimentacao); nao foi estimada para evitar dado incorreto.",
      ],
    },
    relatorio: mapa,
  };
}
