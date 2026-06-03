export function mapAnttRows(rows) {
  const byEixos = new Map();

  for (const row of rows) {
    const current = byEixos.get(row.eixos) || {
      id: row.id,
      tipoVeiculo: row.tipo_veiculo,
      eixos: row.eixos,
      normal: null,
      altoDesempenho: null,
      dataVigencia: row.data_vigencia,
      versao: row.versao,
    };

    const tarifa = {
      kmValor: Number(row.km_valor),
      cargaDescarga: Number(row.carga_descarga),
    };

    if (row.tipo_carga === "normal") current.normal = tarifa;
    if (row.tipo_carga === "alto_desempenho") current.altoDesempenho = tarifa;
    byEixos.set(row.eixos, current);
  }

  return [...byEixos.values()].sort((a, b) => a.eixos - b.eixos);
}

export function mapDiaria(row) {
  return {
    id: row.id,
    codigo: row.codigo,
    descricao: row.descricao,
    horario: row.horario_referencia ? String(row.horario_referencia).slice(0, 5) : "",
    horasRodadasReferencia: row.horas_rodadas_referencia === null ? null : Number(row.horas_rodadas_referencia),
    valor: Number(row.valor),
    ativo: row.ativo,
    ordem: row.ordem,
  };
}

export function mapViagem(row, rotas = []) {
  return {
    id: row.id,
    numero: row.numero_viagem || "",
    situacao: row.situacao || "faltando_dados",
    data: row.data ? row.data.toISOString?.().slice(0, 10) || String(row.data).slice(0, 10) : "",
    placa: row.placa_veiculo || "",
    km: row.km_viagem !== null && row.km_viagem !== undefined ? Number(row.km_viagem) : null,
    origem: row.cidade_origem || "",
    ufOrigem: row.uf_origem || "",
    destino: row.cidade_destino || "",
    ufDestino: row.uf_destino || "",
    cliente: row.cliente || "",
    clienteFinal: row.cliente_final || "",
    valorCliente: Number(row.valor_cliente || 0),
    material: row.material || "",
    peso: Number(row.peso_kg || 0),
    motorista: row.motorista || "",
    valorMotorista: Number(row.valor_motorista || 0),
    vendedor: row.vendedor || "",
    tomadorServico: row.tomador_servico || "",
    condicaoPagamento: row.condicao_pagamento || "",
    numeroMotorista: row.numero_motorista || "",
    cnh: row.cnh_motorista || "",
    antt: row.antt_veiculo || "",
    contaDeposito: row.conta_deposito || "",
    chavePix: row.chave_pix || "",
    docs: {
      placas: Boolean(row.doc_placas),
      antt: Boolean(row.doc_antt),
      contaDeposito: Boolean(row.doc_conta_deposito),
      chavePix: Boolean(row.doc_chave_pix),
      cnh: Boolean(row.doc_cnh_motorista),
      comprovanteResidencia: Boolean(row.doc_comprovante_residencia),
      numeroMotorista: Boolean(row.doc_numero_motorista),
    },
    paradas: rotas.map(mapParada),
    observacoes: row.observacoes || "",
    valorKg: Number(row.valor_kg || 0),
    valorTon: Number(row.valor_ton || 0),
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
  };
}

const PROCESS_SITUACOES = new Set(["em_transito", "entregue", "cancelado"]);

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "" && Number(value) !== 0;
}

export function calcularSituacaoViagem(input = {}) {
  if (PROCESS_SITUACOES.has(input.situacao)) return input.situacao;

  const hasCarga = [
    input.cliente,
    input.material,
    input.peso,
    input.valorCliente,
    input.origem,
    input.destino,
  ].some(hasValue);

  if (hasCarga && (!hasValue(input.placa) || !hasValue(input.motorista))) {
    return "aguardando_veiculo";
  }

  const hasDadosOperacionais = [
    input.placa,
    input.motorista,
    input.cliente,
    input.material,
    input.valorCliente,
    input.valorMotorista,
    input.origem,
    input.destino,
  ].every(hasValue);

  return hasDadosOperacionais ? "aguardando_cte" : "faltando_dados";
}

function mapParada(row) {
  return {
    id: row.id,
    ordem: row.ordem,
    tipo: row.tipo_parada || "entrega",
    cidade: row.cidade || "",
    uf: row.uf || "",
    cliente: row.cliente || "",
    endereco: row.endereco || "",
    nf: row.numero_nota_fiscal || "",
    obs: row.observacoes || "",
  };
}

export function viagemParams(input) {
  const docs = input.docs || {};
  const km   = input.km !== null && input.km !== undefined && String(input.km).trim() !== ""
    ? Number(input.km)
    : null;

  return [
    input.numero || null,
    input.placa || null,
    calcularSituacaoViagem(input),
    input.data || new Date().toISOString().slice(0, 10),
    input.origem || "",
    (input.ufOrigem || "").slice(0, 2).toUpperCase(),
    input.destino || "",
    (input.ufDestino || "").slice(0, 2).toUpperCase(),
    input.cliente || "",
    input.clienteFinal || null,
    Number(input.valorCliente || 0),
    km,
    input.material || null,
    Number(input.peso || 0),
    input.motorista || null,
    Number(input.valorMotorista || 0),
    input.vendedor || null,
    input.tomadorServico || null,
    input.condicaoPagamento || null,
    input.numeroMotorista || null,
    input.cnh || null,
    input.antt || null,
    input.contaDeposito || null,
    input.chavePix || null,
    Boolean(docs.placas),
    Boolean(docs.antt),
    Boolean(docs.contaDeposito),
    Boolean(docs.chavePix),
    Boolean(docs.cnh),
    Boolean(docs.comprovanteResidencia),
    Boolean(docs.numeroMotorista),
    input.observacoes || null,
  ];
}
