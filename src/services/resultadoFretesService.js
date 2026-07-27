import { getRentabilidadeClientes } from "./rentabilidadeClientesService.js";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function r2(value) {
  return Math.round((num(value) + Number.EPSILON) * 100) / 100;
}

function routeUf(value) {
  const match = String(value || "").toUpperCase().match(/\/([A-Z]{2})(?:\s|,|$)/);
  return match?.[1] || "";
}

function summarize(rows) {
  const receita = r2(rows.reduce((sum, row) => sum + num(row.receita), 0));
  const custo = r2(rows.reduce((sum, row) => sum + num(row.custo), 0));
  const lucro = r2(receita - custo);
  return {
    documentos: rows.length,
    receita,
    custo,
    lucro,
    margem: r2(receita > 0 ? (lucro / receita) * 100 : 0),
  };
}

function groupBy(rows, field) {
  const groups = new Map();
  for (const row of rows) {
    const key = row[field] || "Nao informado";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Array.from(groups, ([nome, documentos]) => ({ nome, ...summarize(documentos) }))
    .sort((a, b) => b.receita - a.receita);
}

export async function getResultadoFretes(filters = {}) {
  const ufBase = String(filters.ufBase || "SC").trim().toUpperCase().slice(0, 2);
  const base = await getRentabilidadeClientes({
    startDate: filters.startDate,
    endDate: filters.endDate,
    cliente: filters.cliente,
    placa: filters.placa,
    origem: filters.origem,
    destino: filters.destino,
    material: filters.material,
  });

  const documentos = (base.clientes || [])
    .flatMap((cliente) => cliente.viagens || [])
    .filter((row) => String(row.tipoVeiculo || "").toLowerCase() === "frota")
    .map((row) => {
      const origemUf = routeUf(row.origem);
      const destinoUf = routeUf(row.destino);
      const direcao = origemUf === ufBase ? "ida" : "retorno";
      const custos = row.custos || {};
      return {
        ...row,
        direcao,
        direcaoLabel: direcao === "ida" ? "Ida" : "Retorno",
        origemUf,
        destinoUf,
        custoVeiculo: r2(num(custos.abastecimentos) + num(custos.manutencao)),
        custoMotorista: r2(num(custos.motorista) + num(custos.diarias)),
        custoCarga: r2(num(custos.pedagio) + num(custos.despesas) + num(custos.outros)),
        pendenciaCusto: !row.viagem || num(row.custo) === 0,
      };
    });

  const direcaoFiltro = String(filters.direcao || "todos").toLowerCase();
  const filtrados = direcaoFiltro === "todos"
    ? documentos
    : documentos.filter((row) => row.direcao === direcaoFiltro);

  return {
    periodo: base.periodo,
    ufBase,
    resumo: summarize(filtrados),
    comparativo: {
      ida: summarize(documentos.filter((row) => row.direcao === "ida")),
      retorno: summarize(documentos.filter((row) => row.direcao === "retorno")),
    },
    documentos: filtrados.sort((a, b) => String(b.data || "").localeCompare(String(a.data || ""))),
    rankings: {
      clientes: groupBy(filtrados, "cliente").slice(0, 20),
      placas: groupBy(filtrados, "placa").slice(0, 20),
      motoristas: groupBy(filtrados, "motorista").slice(0, 20),
    },
    filtros: base.filtros,
    pendencias: documentos.filter((row) => row.pendenciaCusto).length,
    custosConsiderados: {
      veiculo: "Combustivel e manutencao operacional rateada por placa/mes.",
      motorista: "Frete/comissao do motorista e diarias.",
      carga: "Pedagio, despesas e demais custos operacionais vinculados.",
      excluidos: "Custos prediais, administrativos, financeiros, seguros e demais despesas sem vinculo operacional com placa, motorista ou CT-e.",
    },
    fonte: "CT-es ativos de logistica.conhecimentos; o modulo de viagens e usado somente como vinculo auxiliar para localizar e ratear custos.",
  };
}
