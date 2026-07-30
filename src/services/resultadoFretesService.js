import { getRentabilidadeClientes } from "./rentabilidadeClientesService.js";

const COMERCIAIS_RETORNO = new Set([145, 170, 1085]);

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

function movementFor(originUf, destinationUf, baseUf) {
  if (!originUf || !destinationUf) {
    return { id: "indefinido", label: "UF pendente" };
  }
  if (originUf === baseUf && destinationUf === baseUf) {
    return { id: "interno", label: `Dentro de ${baseUf}` };
  }
  if (originUf === baseUf) {
    return { id: "saida", label: "Saída da base" };
  }
  if (destinationUf === baseUf) {
    return { id: "chegada", label: "Chegada à base" };
  }
  return { id: "fora", label: "Trecho fora da base" };
}

function isReturnCommercial(row, baseUf) {
  return COMERCIAIS_RETORNO.has(Number(row.comercialCodigo))
    && Boolean(row.origemUf)
    && row.origemUf !== baseUf;
}

function groupVehicles(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.placa || "Placa não informada";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  return Array.from(groups, ([placa, items]) => {
    const documentos = [...items].sort((a, b) =>
      String(a.data || "").localeCompare(String(b.data || ""))
      || num(a.codigo) - num(b.codigo)
    );
    let ultimaUf = "";
    let quebrasSequencia = 0;
    for (const row of documentos) {
      if (ultimaUf && row.origemUf && ultimaUf !== row.origemUf) quebrasSequencia += 1;
      if (row.destinoUf) ultimaUf = row.destinoUf;
    }
    const movimentos = documentos.reduce((acc, row) => {
      acc[row.movimento] = (acc[row.movimento] || 0) + 1;
      return acc;
    }, {});
    return {
      placa,
      motorista: documentos.at(-1)?.motorista || "",
      ...summarize(documentos),
      movimentos,
      quebrasSequencia,
      origemInicial: documentos[0]?.origem || "",
      destinoFinal: documentos.at(-1)?.destino || "",
      documentos: documentos.reverse(),
    };
  }).sort((a, b) => b.receita - a.receita);
}

export async function getResultadoFretes(filters = {}) {
  const ufBase = String(filters.ufBase || "SC").trim().toUpperCase().slice(0, 2);
  const valorMaximoPequeno = Math.max(num(filters.valorMaximoPequeno) || 1500, 0);
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
      const movement = movementFor(origemUf, destinoUf, ufBase);
      const custos = row.custos || {};
      return {
        ...row,
        movimento: movement.id,
        movimentoLabel: movement.label,
        // Campos legados mantidos para não quebrar consumidores antigos.
        direcao: movement.id === "saida" || movement.id === "interno" ? "ida" : "retorno",
        direcaoLabel: movement.label,
        origemUf,
        destinoUf,
        retornoComercial: false,
        custoVeiculo: r2(num(custos.abastecimentos) + num(custos.manutencao)),
        custoMotorista: r2(num(custos.motorista) + num(custos.diarias)),
        custoCarga: r2(num(custos.pedagio) + num(custos.despesas) + num(custos.outros)),
        pendenciaCusto: !row.viagem || num(row.custo) === 0,
      };
    })
    .map((row) => ({ ...row, retornoComercial: isReturnCommercial(row, ufBase) }));

  const direcaoFiltro = String(filters.direcao || "todos").toLowerCase();
  const filtrados = direcaoFiltro === "todos"
    ? documentos
    : documentos.filter((row) => {
      if (direcaoFiltro === "pequenos_fora") {
        return row.movimento === "fora" && num(row.receita) > 0 && num(row.receita) <= valorMaximoPequeno;
      }
      if (direcaoFiltro === "retorno_comercial") return row.retornoComercial;
      if (["ida", "retorno"].includes(direcaoFiltro)) return row.direcao === direcaoFiltro;
      return row.movimento === direcaoFiltro;
    });
  const resumoFiltrado = summarize(filtrados);
  const movimentos = Object.fromEntries(
    ["saida", "chegada", "fora", "interno", "indefinido"].map((id) => [
      id,
      summarize(documentos.filter((row) => row.movimento === id)),
    ])
  );
  const receitaRecalculada = r2(filtrados.reduce((sum, row) => sum + num(row.receita), 0));
  const custoRecalculado = r2(filtrados.reduce((sum, row) => sum + num(row.custo), 0));
  const fretesPequenos = documentos.filter((row) => num(row.receita) > 0 && num(row.receita) <= valorMaximoPequeno);
  const pequenosForaBase = fretesPequenos.filter((row) => row.movimento === "fora");
  const fase = (id) => summarize(documentos.filter((row) => row.movimento === id));

  return {
    periodo: base.periodo,
    ufBase,
    resumo: resumoFiltrado,
    movimentos,
    comparativo: {
      ida: summarize(documentos.filter((row) => row.direcao === "ida")),
      retorno: summarize(documentos.filter((row) => row.direcao === "retorno")),
    },
    documentos: filtrados.sort((a, b) => String(b.data || "").localeCompare(String(a.data || ""))),
    rankings: {
      clientes: groupBy(filtrados, "cliente").slice(0, 20),
      placas: groupBy(filtrados, "placa").slice(0, 20),
      motoristas: groupBy(filtrados, "motorista").slice(0, 20),
      comerciais: groupBy(filtrados, "comercial").slice(0, 20),
    },
    veiculos: groupVehicles(filtrados),
    filtros: base.filtros,
    pendencias: documentos.filter((row) => row.pendenciaCusto).length,
    auditoria: {
      totaisConferem: receitaRecalculada === resumoFiltrado.receita
        && custoRecalculado === resumoFiltrado.custo
        && r2(receitaRecalculada - custoRecalculado) === resumoFiltrado.lucro,
      documentosPrejuizo: filtrados.filter((row) => num(row.lucro) < 0).length,
      documentosSemCusto: filtrados.filter((row) => num(row.custo) === 0).length,
      documentosSemViagem: filtrados.filter((row) => !row.viagem).length,
      documentosSemPlaca: filtrados.filter((row) => !row.placa).length,
      documentosSemMotorista: filtrados.filter((row) => !row.motorista).length,
      documentosUfPendente: filtrados.filter((row) => !row.origemUf || !row.destinoUf).length,
      documentosReceitaAte100: filtrados.filter((row) => num(row.receita) > 0 && num(row.receita) <= 100).length,
      trechosForaBase: filtrados.filter((row) => row.movimento === "fora").length,
      retornosComerciais: filtrados.filter((row) => row.retornoComercial).length,
      criterio: "A classificação descreve o movimento de cada CT-e em relação à UF base; não presume que toda origem fora da base seja retorno.",
      ressalva: "Custos de viagem são rateados entre CT-es pela participação na receita. Manutenção é rateada por placa/mês; portanto o custo por documento é gerencial, não um custo direto auditado por trecho.",
    },
    indicadoresOperacionais: {
      saidaBase: fase("saida"),
      giroForaBase: fase("fora"),
      retornoBase: fase("chegada"),
      retornoComercial: summarize(documentos.filter((row) => row.retornoComercial)),
      retornoComercialMaicon: summarize(documentos.filter((row) => row.retornoComercial && Number(row.comercialCodigo) !== 170)),
      retornoComercialMauricio: summarize(documentos.filter((row) => row.retornoComercial && Number(row.comercialCodigo) === 170)),
      dentroBase: fase("interno"),
      fretesPequenos: {
        limite: valorMaximoPequeno,
        ...summarize(fretesPequenos),
      },
      pequenosForaBase: {
        limite: valorMaximoPequeno,
        ...summarize(pequenosForaBase),
      },
    },
    custosConsiderados: {
      veiculo: "Combustivel e manutencao operacional rateada por placa/mes.",
      motorista: "Frete/comissao do motorista e diarias.",
      carga: "Pedagio, despesas e demais custos operacionais vinculados.",
      excluidos: "Custos prediais, administrativos, financeiros, seguros e demais despesas sem vinculo operacional com placa, motorista ou CT-e.",
    },
    fonte: "CT-es ativos de logistica.conhecimentos; o modulo de viagens e usado somente como vinculo auxiliar para localizar e ratear custos.",
  };
}
