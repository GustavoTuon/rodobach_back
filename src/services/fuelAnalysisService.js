import { clientPool } from "../db/clientPool.js";
import { compareFuel, previousFuelPeriod } from "./fuelComparison.js";

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const round = (value) => Math.round(value * 100) / 100;
const sum = (rows, key) =>
  rows.reduce((total, row) => total + num(row[key]), 0);
const group = (rows, key) => {
  const result = new Map();
  for (const row of rows) {
    const value = row[key];
    if (!result.has(value)) result.set(value, []);
    result.get(value).push(row);
  }
  return result;
};
const family = (name) =>
  /arla/i.test(name)
    ? "aditivo"
    : /diesel/i.test(name)
      ? "diesel"
      : /gasolina/i.test(name)
        ? "gasolina"
        : /etanol|alcool|álcool/i.test(name)
          ? "etanol"
          : /gnv|gas natural|gás natural/i.test(name)
            ? "gnv"
            : null;

export function validateFuelKm(rows) {
  const previous = new Map();
  const checked = new Map();
  for (const row of [...rows].sort(
    (a, b) => a.data.localeCompare(b.data) || num(a.id) - num(b.id),
  )) {
    const before = previous.get(row.placa);
    let issue =
      row.km > 0 && row.litros > 0
        ? null
        : "KM rodado ou litros não informados.";
    if (row.odometro > 0 && row.km > row.odometro)
      issue = "KM rodado maior que o hodômetro.";
    if (before && family(row.combustivel) !== "aditivo") {
      if (
        before.odometro > 0 &&
        row.odometro > 0 &&
        row.odometro < before.odometro
      )
        issue = "Hodômetro regrediu entre abastecimentos.";
      // Datas do ERP podem não conter horário: inclui um dia de tolerância.
      const days =
        (Date.parse(row.data) - Date.parse(before.data)) / 86400000 + 1;
      if (row.km > days * 24 * 120)
        issue = "KM incompatível com o intervalo entre abastecimentos.";
    }
    if (family(row.combustivel) && family(row.combustivel) !== "aditivo")
      previous.set(row.placa, row);
    checked.set(row, { ...row, kmValido: !issue, kmMotivo: issue });
  }
  return rows.map((row) => checked.get(row));
}

export function aggregateFuel(rows) {
  const litros = sum(rows, "litros"),
    total = sum(rows, "total");
  const price = litros > 0 ? total / litros : 0;
  const ranking = [...group(rows, "placa")]
    .map(([placa, records]) => {
      const valid = records.filter(
        (r) =>
          r.kmValido !== false &&
          r.km > 0 &&
          r.litros > 0 &&
          family(r.combustivel) &&
          family(r.combustivel) !== "aditivo",
      );
      const families = new Set(records.map((r) => family(r.combustivel)));
      const complete = valid.length === records.length && families.size === 1;
      const km = sum(valid, "km"),
        volume = sum(records, "litros"),
        value = sum(records, "total");
      return {
        placa,
        modelo: records[0].modelo,
        total: round(value),
        litros: round(volume),
        km: complete ? round(km) : null,
        media: complete && km > 0 ? km / volume : null,
        reaisKm: complete && km > 0 ? value / km : null,
        origemConsumo: "abastecimento",
        combustivelFamilia: families.size === 1 ? [...families][0] : "mistura",
        cobertura: {
          completo: complete && records.length >= 2,
          registrosValidos: valid.length,
          registrosTotal: records.length,
          kmObservado: round(km),
        },
        motivo: !complete
          ? records.find((r) => r.kmMotivo)?.kmMotivo ||
            "KM/litros ausentes, produto não combustível ou mistura de combustíveis."
          : records.length < 2
            ? "São necessários ao menos 2 abastecimentos em cada período para comparar."
            : null,
      };
    })
    .sort((a, b) => b.total - a.total);
  const validVehicles = ranking.filter((r) => r.km > 0);
  const km = sum(validVehicles, "km"),
    litrosKm = sum(validVehicles, "litros");
  const fornecedores = [...group(rows, "posto")]
    .map(([codigo, records]) => {
      const volume = sum(records, "litros"),
        value = sum(records, "total");
      const mean = volume > 0 ? value / volume : 0;
      const prices = records
        .filter((r) => r.litros > 0)
        .map((r) => r.total / r.litros);
      const first = records[0];
      return {
        codigo,
        fornecedor: first.postoNome,
        cidade: first.postoCidade,
        uf: first.postoUf,
        total: round(value),
        litros: round(volume),
        desconto: round(sum(records, "desconto")),
        abastecimentos: records.length,
        precoMedio: round(mean),
        precoTabelaMedio:
          volume > 0 ? round((value + sum(records, "desconto")) / volume) : 0,
        maiorPreco: prices.length ? round(Math.max(...prices)) : 0,
        menorPreco: prices.length ? round(Math.min(...prices)) : 0,
        participacao: total > 0 ? round((value / total) * 100) : 0,
        diferencaPreco: price > 0 ? round((mean / price - 1) * 100) : 0,
        gastoAcimaMedia: round(Math.max(0, mean - price) * volume),
      };
    })
    .sort((a, b) => b.total - a.total);
  const monthly = [
    ...group(
      rows.map((r) => ({ ...r, mes: r.data.slice(0, 7) })),
      "mes",
    ),
  ]
    .map(([mes, records]) => ({
      mes,
      label: mes.split("-").reverse().join("/"),
      total: round(sum(records, "total")),
      litros: round(sum(records, "litros")),
      precoMedio:
        sum(records, "litros") > 0
          ? round(sum(records, "total") / sum(records, "litros"))
          : 0,
    }))
    .sort((a, b) => a.mes.localeCompare(b.mes));
  return {
    fonteKm: "abastecimento",
    summary: {
      valor: round(total),
      litros: round(litros),
      desconto: round(sum(rows, "desconto")),
      precoMedio: round(price),
      precoMedioPonderado: round(price),
      abastecimentos: rows.length,
      veiculos: ranking.length,
      km: round(km),
      kmObservado: round(
        sum(
          ranking.map((r) => ({ km: r.cobertura.kmObservado })),
          "km",
        ),
      ),
      mediaFrota: litrosKm > 0 ? km / litrosKm : null,
      reaisKm: km > 0 ? sum(validVehicles, "total") / km : null,
      fontesKm: { erp: validVehicles.length, telemetria: 0 },
    },
    ranking,
    fornecedores,
    monthly,
    lancamentos: rows,
    historicoKm: [],
    modelos: [],
    marcas: [],
    postosCaros: [...fornecedores]
      .sort((a, b) => b.precoMedio - a.precoMedio)
      .slice(0, 10),
    postosBaratos: [...fornecedores]
      .sort((a, b) => a.precoMedio - b.precoMedio)
      .slice(0, 10),
    alertas: { veiculosConsumoBaixo: [], postosPrecoAlto: [] },
  };
}

export function buildFuelAnalysis(rows, filters, previousPeriod) {
  const options = {
    placas: [...new Set(rows.map((r) => r.placa))].sort(),
    combustiveis: [
      ...new Map(
        rows.map((r) => [
          r.combustivelCodigo,
          { codigo: r.combustivelCodigo, nome: r.combustivel },
        ]),
      ).values(),
    ].sort((a, b) => a.nome.localeCompare(b.nome)),
  };
  const includes = (value, search) =>
    String(value || "")
      .toLowerCase()
      .includes(String(search).toLowerCase());
  const filtered = rows.filter(
    (r) =>
      (!filters.placa ||
        r.placa.replace(/[^A-Z0-9]/g, "") ===
          String(filters.placa)
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "")) &&
      (!filters.combustivel ||
        filters.combustivel === "todos" ||
        (filters.combustivel === "diesel"
          ? family(r.combustivel) === "diesel"
          : String(r.combustivelCodigo) === String(filters.combustivel))) &&
      (!filters.fornecedor || String(r.posto) === String(filters.fornecedor)) &&
      (!filters.centro ||
        String(r.centro) === String(filters.centro) ||
        includes(r.centroNome, filters.centro)) &&
      (!filters.modelo || includes(r.modelo, filters.modelo)) &&
      (!filters.marca || includes(r.marca, filters.marca)) &&
      (!filters.ano || String(r.ano) === String(filters.ano)),
  );
  const current = aggregateFuel(
    filtered.filter(
      (r) => r.data >= filters.startDate && r.data <= filters.endDate,
    ),
  );
  const previous = aggregateFuel(
    filtered.filter(
      (r) =>
        r.data >= previousPeriod.startDate && r.data <= previousPeriod.endDate,
    ),
  );
  // Um recorte por posto não contém necessariamente todos os abastecimentos da placa.
  if (filters.fornecedor) {
    for (const period of [current, previous])
      for (const row of period.ranking) {
        row.media = null;
        row.reaisKm = null;
        row.cobertura.completo = false;
        row.motivo =
          "Retire o filtro de posto para comparar o consumo completo do veículo.";
      }
    current.summary.filtroPostoAtivo = true;
  }
  current.comparison = compareFuel(current, previous, previousPeriod);
  current.filterOptions = options;
  current.period = { startDate: filters.startDate, endDate: filters.endDate };
  current.combustivelLabel =
    filters.combustivel === "diesel"
      ? "Diesel (todos os tipos)"
      : options.combustiveis.find(
          (r) => String(r.codigo) === String(filters.combustivel),
        )?.nome || "Todos os combustíveis";
  return current;
}

// Uma consulta para os dois períodos; filtros de tela reutilizam a mesma leitura por 30 s.
const cache = new Map();
export async function getFuelAnalysis(filters) {
  const validDate = (value) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  if (
    !validDate(filters.startDate) ||
    !validDate(filters.endDate) ||
    filters.endDate < filters.startDate
  ) {
    const error = new Error("Informe um período válido.");
    error.status = 400;
    throw error;
  }
  const period = previousFuelPeriod(filters);
  const owner = ["todos", "terceiro", "terceiros"].includes(
    filters.proprietario,
  )
    ? filters.proprietario
    : "frota";
  const key = JSON.stringify([
    period.startDate,
    filters.endDate,
    filters.empresa || "",
    owner,
  ]);
  let entry = cache.get(key);
  if (!entry || entry.expires < Date.now()) {
    const params = [period.startDate, filters.endDate];
    const conditions = [];
    if (filters.empresa) {
      params.push(String(filters.empresa));
      conditions.push(`a.empresaaba::text=$${params.length}`);
    }
    if (owner === "frota") conditions.push("v.tipopropriedadevei::text='P'");
    else if (owner !== "todos")
      conditions.push("COALESCE(v.tipopropriedadevei::text,'T')<>'P'");
    const promise = clientPool
      .query(
        `SELECT a.dataaba::date::text AS data, a.codigoaba::text AS id,
      UPPER(TRIM(a.veiculoaba::text)) AS placa,a.litrosaba AS litros,a.totalaba AS total,
      a.diferencakilometragemaba AS km,a.kilometragematualaba AS odometro,a.valorlitroaba AS "valorLitroTabela",
      a.valordescontoaba AS desconto,a.combustivelaba::text AS "combustivelCodigo",COALESCE(produto.nomepro,'Não identificado') AS combustivel,
      a.postocombustivelaba::text AS posto,COALESCE(posto.nome,'Posto '||a.postocombustivelaba::text,'Não informado') AS "postoNome",
      posto.cidade AS "postoCidade",posto.uf AS "postoUf",a.financeiroaba AS financeiro,
      COALESCE(NULLIF(v.modelovei,''),NULLIF(v.marcamodelorenavamvei,''),'Não informado') AS modelo,
      v.centrocustovei::text AS centro,centro.nomeccs AS "centroNome",COALESCE(marca.nomemar,v.marcavei::text) AS marca,v.anomodelovei::text AS ano
      FROM frotas.abastecimentos a
      LEFT JOIN LATERAL (SELECT v.* FROM frotas.veiculos v WHERE UPPER(TRIM(v.placavei::text))=UPPER(TRIM(a.veiculoaba::text)) AND NULLIF(TRIM(v.placavei::text),'') IS NOT NULL ORDER BY (v.empresavei=a.empresaaba) DESC,v.empresavei LIMIT 1) v ON true
      LEFT JOIN LATERAL (SELECT p.nomepro FROM estoque.produtos p WHERE p.codigopro=a.combustivelaba ORDER BY (p.empresapro=a.empresaaba) DESC,p.empresapro LIMIT 1) produto ON true
      LEFT JOIN LATERAL (SELECT c.nomeccs FROM financeiro.centroscustos c WHERE c.codigoccs=v.centrocustovei AND (c.empresaccs=v.empresavei OR c.empresaccs IS NULL) ORDER BY (c.empresaccs=v.empresavei) DESC NULLS LAST LIMIT 1) centro ON true
      LEFT JOIN LATERAL (SELECT m.nomemar FROM frotas.marcas m WHERE m.codigomar=v.marcavei AND (m.empresamar=v.empresavei OR m.empresamar IS NULL) ORDER BY (m.empresamar=v.empresavei) DESC NULLS LAST LIMIT 1) marca ON true
      LEFT JOIN LATERAL (SELECT COALESCE(NULLIF(f.fantasiafor,''),NULLIF(f.nomefor,'')) AS nome,c.nomecid AS cidade,e.abreviaturaest AS uf
        FROM gerais.fornecedores f LEFT JOIN localidades.cep z ON z.codigocep::text=regexp_replace(COALESCE(f.cepfor::text,''),'\\D','','g')
        LEFT JOIN localidades.cidades c ON c.codigocid=z.cidadecep LEFT JOIN localidades.estados e ON e.codigoest=c.estadocid
        WHERE f.codigofor=a.postocombustivelaba ORDER BY (f.empresafor=a.empresaaba) DESC,f.empresafor LIMIT 1) posto ON true
      WHERE a.dataaba >= $1::date AND a.dataaba < ($2::date+1) ${conditions.length ? "AND " + conditions.join(" AND ") : ""}
      ORDER BY a.dataaba DESC,a.codigoaba DESC`,
        params,
      )
      .then(({ rows }) =>
        rows.map((row) => {
          const r = { ...row };
          for (const field of [
            "litros",
            "total",
            "km",
            "odometro",
            "valorLitroTabela",
            "desconto",
          ])
            r[field] = num(row[field]);
          r.valorLitro = r.litros > 0 ? r.total / r.litros : 0;
          r.media = r.litros > 0 && r.km > 0 ? r.km / r.litros : 0;
          return r;
        }),
      );
    entry = { promise, expires: Date.now() + 30000 };
    cache.set(key, entry);
    if (cache.size > 20) cache.delete(cache.keys().next().value);
    promise.catch(() => {
      if (cache.get(key) === entry) cache.delete(key);
    });
  }
  return buildFuelAnalysis(
    validateFuelKm(await entry.promise),
    { ...filters, combustivel: filters.combustivel || "diesel" },
    period,
  );
}
