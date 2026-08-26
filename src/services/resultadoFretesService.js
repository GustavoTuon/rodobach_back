import { getRentabilidadeClientes } from "./rentabilidadeClientesService.js";
import { getDreEmpresarial } from "./dreEmpresarialService.js";

const COMERCIAIS_MAICON = new Set([145, 1085]);
const COMERCIAIS_MAURICIO = new Set([170]);
const COMERCIAIS_RETORNO = new Set([...COMERCIAIS_MAICON, ...COMERCIAIS_MAURICIO]);

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function r2(value) {
  return Math.round((num(value) + Number.EPSILON) * 100) / 100;
}

export function routeUf(value) {
  const match = String(value || "").toUpperCase().match(/(?:\/|\s-\s|,)\s*([A-Z]{2})(?:\s|,|$)/);
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

function clientIdentity(row) {
  const digits = String(row.documento || "").replace(/\D/g, "");
  if (digits.length === 14) return `cnpj:${digits.slice(0, 8)}`;
  if (digits.length === 11) return `cpf:${digits}`;
  return `cliente:${row.clienteCodigo || row.cliente}`;
}

function compareClientsByOperation(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = clientIdentity(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map((items) => {
    const frota = summarize(items.filter(row => row.tipoOperacao === "frota"));
    const terceiro = summarize(items.filter(row => row.tipoOperacao === "terceiro"));
    const diferencaLucro = r2(frota.lucro - terceiro.lucro);
    return {
      cliente: items[0]?.cliente || "Sem identificacao",
      documento: items[0]?.documento || "",
      frota,
      terceiro,
      operacaoMaisLucrativa: frota.documentos && terceiro.documentos
        ? (diferencaLucro >= 0 ? "frota" : "terceiro")
        : (frota.documentos ? "frota" : "terceiro"),
      diferencaLucro: Math.abs(diferencaLucro),
      usaAmbos: frota.documentos > 0 && terceiro.documentos > 0,
    };
  }).sort((a, b) => (Number(b.usaAmbos) - Number(a.usaAmbos)) || (b.diferencaLucro - a.diferencaLucro));
}

function movementFor(originUf, destinationUf, baseUfs, baseLabel) {
  if (!originUf || !destinationUf) {
    return { id: "indefinido", label: "UF pendente" };
  }
  const originInBase = baseUfs.has(originUf);
  const destinationInBase = baseUfs.has(destinationUf);
  if (originInBase && destinationInBase) {
    return { id: "interno", label: `Dentro da ${baseLabel}` };
  }
  if (originInBase) {
    return { id: "saida", label: "Saída da base" };
  }
  if (destinationInBase) {
    return { id: "chegada", label: "Chegada à base" };
  }
  return { id: "fora", label: "Trecho fora da base" };
}

function isReturnCommercial(row, baseUfs) {
  return COMERCIAIS_RETORNO.has(Number(row.comercialCodigo))
    && Boolean(row.origemUf)
    && !baseUfs.has(row.origemUf);
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

export function applyFinancialRevenue(logisticsRows, dreRows, { taxTotal = 0 } = {}) {
  const byCte = new Map();
  for (const row of logisticsRows) {
    const number = String(row.numero || row.codigo || "").trim();
    const exactKey = `${row.empresa}:${String(row.serie || "").trim()}/${number}`;
    const numberKey = `${row.empresa}:${number}`;
    for (const key of [exactKey, numberKey]) {
      if (!byCte.has(key)) byCte.set(key, []);
      byCte.get(key).push(row);
    }
  }

  const allocated = new Map();
  let linkedFinancialValue = 0;
  let unclassifiedFinancialValue = 0;
  let linkedEntries = 0;
  let unclassifiedEntries = 0;

  for (const financial of dreRows.filter(row => row.categoriaDre === "RECEITA BRUTA")) {
    const ctes = String(financial.ctes || "").split(",").map(value => value.trim()).filter(Boolean);
    const company = financial.detailKey?.empresa;
    const matches = [...new Map(ctes.flatMap(cte => byCte.get(`${company}:${cte}`) || []).map(row => [row.id, row])).values()];
    const value = num(financial.valor);
    if (!matches.length) {
      unclassifiedFinancialValue += value;
      unclassifiedEntries += 1;
      continue;
    }

    const totalWeight = matches.reduce((sum, row) => sum + Math.max(num(row.receita), 0), 0);
    matches.forEach((row) => {
      const weight = totalWeight > 0 ? Math.max(num(row.receita), 0) / totalWeight : 1 / matches.length;
      allocated.set(row.id, num(allocated.get(row.id)) + value * weight);
    });
    linkedFinancialValue += value;
    linkedEntries += 1;
  }

  const officialFinancialValue = linkedFinancialValue + unclassifiedFinancialValue;
  const documents = logisticsRows.filter(row => allocated.has(row.id)).map(row => {
    const receita = r2(allocated.get(row.id));
    const custoOperacional = r2(row.custo);
    const imposto = r2(officialFinancialValue > 0 ? num(taxTotal) * receita / officialFinancialValue : 0);
    const custo = r2(custoOperacional + imposto);
    const lucro = r2(receita - custo);
    return {
      ...row,
      receitaLogistica: r2(row.receita),
      receita,
      custoOperacional,
      imposto,
      custo,
      lucro,
      margem: r2(receita > 0 ? (lucro / receita) * 100 : 0),
      receitaFonte: "financeiro",
    };
  });
  const expectedClassifiedTax = r2(officialFinancialValue > 0 ? num(taxTotal) * linkedFinancialValue / officialFinancialValue : 0);
  const allocatedTax = r2(documents.reduce((sum, row) => sum + num(row.imposto), 0));
  const taxRoundingDifference = r2(expectedClassifiedTax - allocatedTax);
  if (documents.length && taxRoundingDifference) {
    const target = documents.reduce((largest, row) => num(row.receita) > num(largest.receita) ? row : largest, documents[0]);
    target.imposto = r2(target.imposto + taxRoundingDifference);
    target.custo = r2(target.custoOperacional + target.imposto);
    target.lucro = r2(target.receita - target.custo);
    target.margem = r2(target.receita > 0 ? (target.lucro / target.receita) * 100 : 0);
  }

  return {
    documents,
    summary: {
      linkedEntries,
      unclassifiedEntries,
      linkedFinancialValue: r2(linkedFinancialValue),
      unclassifiedFinancialValue: r2(unclassifiedFinancialValue),
      officialFinancialValue: r2(officialFinancialValue),
      impostoTotal: r2(taxTotal),
      impostoClassificado: r2(documents.reduce((sum, row) => sum + num(row.imposto), 0)),
      linkedDocuments: documents.length,
      logisticsDocumentsExcluded: logisticsRows.length - documents.length,
    },
  };
}

export async function getResultadoFretes(filters = {}) {
  const baseLabel = "Região Sul";
  const baseUfs = new Set(["PR", "SC", "RS"]);
  const limiteInformado = Number(filters.valorMaximoPequeno);
  const valorMaximoPequeno = Number.isFinite(limiteInformado) ? Math.max(limiteInformado, 0) : 1500;
  const [base, dre] = await Promise.all([
    getRentabilidadeClientes({
      startDate: filters.startDate,
      endDate: filters.endDate,
      cliente: filters.cliente,
      placa: filters.placa,
      origem: filters.origem,
      destino: filters.destino,
      material: filters.material,
    }),
    getDreEmpresarial({
      startDate: filters.startDate,
      endDate: filters.endDate,
      tipo: "todos",
      status: "todos",
    }),
  ]);

  const documentosLogisticos = (base.clientes || [])
    .flatMap((cliente) => cliente.viagens || [])
    .map((row) => {
      const origemUf = routeUf(row.origem);
      const destinoUf = routeUf(row.destino);
      const movement = movementFor(origemUf, destinoUf, baseUfs, baseLabel);
      const custos = row.custos || {};
      return {
        ...row,
        tipoOperacao: String(row.tipoVeiculo || "").toLowerCase() === "frota" ? "frota" : "terceiro",
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
    .map((row) => ({ ...row, retornoComercial: isReturnCommercial(row, baseUfs) }));
  const financialRevenue = applyFinancialRevenue(documentosLogisticos, dre.rows || [], { taxTotal: dre.summary?.impostos });
  const todosDocumentos = financialRevenue.documents;

  const tipoOperacao = ["frota", "terceiro"].includes(String(filters.tipoOperacao || "").toLowerCase())
    ? String(filters.tipoOperacao).toLowerCase()
    : "todos";
  const documentos = tipoOperacao === "todos"
    ? todosDocumentos
    : todosDocumentos.filter(row => row.tipoOperacao === tipoOperacao);
  const receitaFinanceiraEscopo = tipoOperacao === "todos"
    ? { ...financialRevenue.summary, escopo: "Frota e terceiros" }
    : {
        ...financialRevenue.summary,
        linkedEntries: documentos.length,
        unclassifiedEntries: 0,
        linkedFinancialValue: r2(documentos.reduce((sum, row) => sum + num(row.receita), 0)),
        unclassifiedFinancialValue: 0,
        officialFinancialValue: r2(documentos.reduce((sum, row) => sum + num(row.receita), 0)),
        linkedDocuments: documentos.length,
        logisticsDocumentsExcluded: 0,
        impostoTotal: r2(documentos.reduce((sum, row) => sum + num(row.imposto), 0)),
        impostoClassificado: r2(documentos.reduce((sum, row) => sum + num(row.imposto), 0)),
        escopo: tipoOperacao === "frota" ? "Somente frota própria" : "Somente terceiros",
      };

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
  const operacionalCompleto = summarize(todosDocumentos);
  const receitaDre = num(dre.summary?.receitaBruta);
  const resultadoDre = num(dre.summary?.resultadoFinal);
  // totalCustos do DRE nao inclui impostos/deducoes; para a ponte completa,
  // o custo total precisa ser exatamente receita bruta menos resultado final.
  const custoDre = r2(receitaDre - resultadoDre);
  const receitaSemCte = (dre.rows || []).filter(row => row.categoriaDre === "RECEITA BRUTA" && !row.ctes);
  const somaReceitaSemCte = r2(receitaSemCte.reduce((sum, row) => sum + num(row.valor), 0));
  const custosNaoAtribuidos = r2(custoDre - operacionalCompleto.custo);
  const diferencaReceita = r2(receitaDre - operacionalCompleto.receita);

  return {
    periodo: base.periodo,
    baseLabel,
    ufsBase: [...baseUfs],
    resumo: resumoFiltrado,
    receitaFinanceira: receitaFinanceiraEscopo,
    movimentos,
    comparativo: {
      ida: summarize(documentos.filter((row) => row.direcao === "ida")),
      retorno: summarize(documentos.filter((row) => row.direcao === "retorno")),
    },
    comparativoOperacao: {
      frota: summarize(filtrados.filter(row => row.tipoOperacao === "frota")),
      terceiro: summarize(filtrados.filter(row => row.tipoOperacao === "terceiro")),
    },
    conciliacaoDre: {
      operacional: operacionalCompleto,
      dre: {
        receita: r2(receitaDre),
        custos: r2(custoDre),
        resultado: r2(resultadoDre),
        margem: r2(dre.summary?.margemLucro),
      },
      ponte: {
        resultadoOperacional: operacionalCompleto.lucro,
        diferencaReceita,
        custosNaoAtribuidos,
        resultadoDre: r2(operacionalCompleto.lucro + diferencaReceita - custosNaoAtribuidos),
      },
      composicaoDre: {
        impostos: r2(dre.summary?.impostos),
        custosTransporte: r2(dre.summary?.custosTransporte),
        custosFrota: r2(dre.summary?.custosFrota),
        despesasPessoal: r2(dre.summary?.despesasPessoal),
        despesasAdministrativas: r2(dre.summary?.despesasAdministrativas),
        despesasFinanceiras: r2(dre.summary?.despesasFinanceiras),
        despesasOperacionais: r2(dre.summary?.despesasOperacionais),
      },
      auditoria: {
        receitasSemCte: {
          quantidade: receitaSemCte.length,
          valor: somaReceitaSemCte,
          documentos: receitaSemCte.sort((a, b) => num(b.valor) - num(a.valor)).slice(0, 100).map(row => ({
            data: row.data,
            documento: row.documento,
            cliente: row.pessoaNome,
            placa: row.placa,
            conta: row.contaFinanceira,
            valor: r2(row.valor),
          })),
        },
        ctesSemTitulo: {
          quantidade: num(dre.cteAudit?.count),
          valor: r2(dre.cteAudit?.value),
          documentos: (dre.cteAudit?.rows || []).slice(0, 100).map(row => ({
            data: row.data,
            cte: row.ctes,
            cliente: row.pessoaNome,
            placa: row.placa,
            valor: r2(row.valor),
          })),
        },
      },
      escopo: "A conciliação usa o período completo e todas as operações, independentemente dos filtros de direção e frota/terceiro.",
    },
    clientesPorOperacao: compareClientsByOperation(filtrados),
    comerciaisPorMovimento: ["saida", "chegada", "fora", "interno"].flatMap(movimento =>
      groupBy(filtrados.filter(row => row.movimento === movimento), "comercial")
        .map(row => ({ ...row, movimento }))
    ),
    documentos: filtrados.sort((a, b) => String(b.data || "").localeCompare(String(a.data || ""))),
    rankings: {
      clientes: groupBy(filtrados, "cliente").slice(0, 20),
      placas: groupBy(filtrados, "placa").slice(0, 20),
      motoristas: groupBy(filtrados, "motorista").slice(0, 20),
      comerciais: groupBy(filtrados, "comercial").slice(0, 20),
    },
    veiculos: groupVehicles(filtrados),
    filtros: { ...base.filtros, tipoOperacao },
    pendencias: filtrados.filter((row) => row.pendenciaCusto).length,
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
      criterio: "A classificação usa PR, SC e RS como Região Sul: Sul para fora é subida, fora para Sul é volta, e trajetos entre estados do Sul são internos.",
      ressalva: "Custos de viagem são rateados entre CT-es pela participação na receita. Manutenção é rateada por placa/mês; portanto o custo por documento é gerencial, não um custo direto auditado por trecho.",
    },
    indicadoresOperacionais: {
      saidaBase: fase("saida"),
      giroForaBase: fase("fora"),
      retornoBase: fase("chegada"),
      retornoComercial: summarize(documentos.filter((row) => row.retornoComercial)),
      retornoComercialMaicon: summarize(documentos.filter((row) => row.retornoComercial && COMERCIAIS_MAICON.has(Number(row.comercialCodigo)))),
      retornoComercialMauricio: summarize(documentos.filter((row) => row.retornoComercial && COMERCIAIS_MAURICIO.has(Number(row.comercialCodigo)))),
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
    fonte: "Receita oficial de financeiro.receber e valorliquidorateiosreceber; CT-es e viagens apenas classificam rota, operação e custos. CT-e sem financeiro não compõe a receita.",
  };
}
