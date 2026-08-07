import { pool } from "../db/pool.js";
import { clientPool } from "../db/clientPool.js";
import { getVeiculosPool } from "../db/pool-veiculos.js";
import { tableName } from "../config.js";

const MOV_TABLE = tableName("movimentacoes_pneus");
const TIPOS_VALIDOS = new Set([
  "MONTAGEM",
  "DESMONTAGEM",
  "TROCA_POSICAO",
  "ESTOQUE",
  "CONSERTO",
  "BAIXA",
  "DESCARTE",
]);

function logPneus(message, details = {}) {
  if (process.env.DEBUG_SQL !== "1") return;
  console.log("[pneus]", message, details);
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeTipo(value) {
  return normalizeText(value).toUpperCase();
}

function apiTipo(value) {
  return normalizeText(value).toLowerCase();
}

const HEAVY_VEHICLE_SQL = `
  AND (
    COALESCE(veiculos.numeroeixosvei, 0) >= 3
    OR CONCAT_WS(' ', veiculos.nomevei, veiculos.modelovei, veiculos.marcamodelorenavamvei) ~* '(CAMINH|CARRETA|CAVALO|TRUCK|BITRUCK|REBOQUE|SEM[I ]?REBOQUE|SR/|SCANIA|VOLVO|IVECO|ACTROS|AXOR|CONSTELLATION|ATEGO|RANDON|LIBRELATO|[468]X[24]|[0-9]E)'
  )
  AND CONCAT_WS(' ', veiculos.nomevei, veiculos.modelovei, veiculos.marcamodelorenavamvei) !~* '(PARATI|SAVEIRO|GOLF|UNO|PALIO|STRADA|FIORINO|MONTANA|S10|HILUX|COROLLA|CIVIC|ONIX|PRISMA|CELTA|GOL\\b)'
`;

function isTireActive(raw) {
  const v = normalizeText(raw).toLowerCase();
  if (!v) return true;
  return !["n", "0", "false", "nao", "inativo", "i"].includes(v);
}

function deriveLocalFromClientRow(row) {
  const local = normalizeText(row.localpne).toLowerCase();
  const veiculo = normalizeText(row.veiculopne);
  const posicao = normalizeText(row.posicaopne);

  if (veiculo && posicao) return "veiculo";
  if (local.includes("conserto") || local.includes("borracharia") || local.includes("recape")) return "conserto";
  if (local.includes("baixa") || local.includes("sucata")) return "baixa";
  if (local.includes("descarte")) return "descarte";
  return "estoque";
}

function applyMovimento(state, mov) {
  const tipo = normalizeTipo(mov.tipo_movimento);

  if (tipo === "MONTAGEM" || tipo === "TROCA_POSICAO") {
    state.local = "veiculo";
    state.veiculo = mov.veiculo_destino ?? state.veiculo;
    state.posicao = mov.posicao_destino ?? null;
  } else if (tipo === "DESMONTAGEM" || tipo === "ESTOQUE") {
    state.local = "estoque";
    state.veiculo = null;
    state.posicao = null;
  } else if (tipo === "CONSERTO") {
    state.local = "conserto";
    state.veiculo = null;
    state.posicao = null;
  } else if (tipo === "BAIXA") {
    state.local = "baixa";
    state.veiculo = null;
    state.posicao = null;
  } else if (tipo === "DESCARTE") {
    state.local = "descarte";
    state.veiculo = null;
    state.posicao = null;
  }

  state.ultimaMovimentacaoRodobach = mov.data_movimento;
}

function mapClientTireRow(row) {
  return {
    codigopne: normalizeText(row.codigopne),
    nomepne: normalizeText(row.nomepne),
    marcapne: normalizeText(row.marcapne),
    modelopne: normalizeText(row.modelopne),
    tamanhopne: normalizeText(row.tamanhopne),
    tipopne: normalizeText(row.tipopne),
    empresapne: normalizeText(row.empresapne),
    kmacumuladopne: Number(row.kmacumuladopne ?? 0),
    kmatualpne: Number(row.kmatualpne ?? 0),
    kmmaximapne: Number(row.kmmaximapne ?? 0),
    quantidaderecapagenspne: Number(row.quantidaderecapagenspne ?? 0),
    datacadastropne: row.datacadastropne ?? null,
    datacomprapne: row.datacomprapne ?? null,
    valorcomprapne: row.valorcomprapne ? Number(row.valorcomprapne) : null,
    notafiscalpne: normalizeText(row.notafiscalpne) || null,
    fornecedorpne: normalizeText(row.fornecedorpne) || null,
    observacaopne: normalizeText(row.observacaopne) || null,
    dataultimamovimentacaopne: row.dataultimamovimentacaopne ?? null,
    local: deriveLocalFromClientRow(row),
    veiculo: normalizeText(row.veiculopne) || null,
    posicao: normalizeText(row.posicaopne) || null,
    ultimaMovimentacaoRodobach: null,
  };
}

function mapMovementRow(row) {
  return {
    ...row,
    tipo_movimento: apiTipo(row.tipo_movimento),
    veiculo_cliente: row.veiculo_destino ?? row.veiculo_origem ?? null,
    usuario: row.usuario_id ?? null,
    dados_snapshot_json: row.snapshot_pneu_json ?? null,
  };
}

async function queryClient(label, sql, params = []) {
  logPneus(`consultando banco do cliente: ${label}`);
  const result = await clientPool.query(sql, params);
  if (!result.rows.length) logPneus(`cliente sem dados: ${label}`);
  return result;
}

async function queryApp(label, sql, params = []) {
  logPneus(`consultando banco do sistema: ${label}`);
  const result = await pool.query(sql, params);
  if (!result.rows.length) logPneus(`sistema sem dados: ${label}`);
  return result;
}

async function fetchClientTiresForVehicle(veiculo) {
  const { rows } = await queryClient("pneus por veiculo", `
    SELECT empresapne, codigopne, nomepne, tamanhopne, marcapne, tipopne,
           datacadastropne, notafiscalpne, fornecedorpne, datacomprapne,
           valorcomprapne, kmacumuladopne, kmatualpne, kmmaximapne,
           localpne, veiculopne, posicaopne, dataultimamovimentacaopne,
           observacaopne, quantidaderecapagenspne, ativopne, modelopne
    FROM frotas.pneus
    WHERE UPPER(TRIM(veiculopne::text)) = UPPER(TRIM($1))
  `, [veiculo]);

  return rows.filter((row) => isTireActive(row.ativopne)).map(mapClientTireRow);
}

async function fetchClientTiresByCodes(codes) {
  if (!codes.length) return [];
  const { rows } = await queryClient("pneus por codigo", `
    SELECT empresapne, codigopne, nomepne, tamanhopne, marcapne, tipopne,
           datacadastropne, notafiscalpne, fornecedorpne, datacomprapne,
           valorcomprapne, kmacumuladopne, kmatualpne, kmmaximapne,
           localpne, veiculopne, posicaopne, dataultimamovimentacaopne,
           observacaopne, quantidaderecapagenspne, ativopne, modelopne
    FROM frotas.pneus
    WHERE codigopne::text = ANY($1::text[])
  `, [codes]);

  return rows.filter((row) => isTireActive(row.ativopne)).map(mapClientTireRow);
}

async function fetchClientStockTires() {
  const { rows } = await queryClient("pneus em estoque", `
    SELECT empresapne, codigopne, nomepne, tamanhopne, marcapne, tipopne,
           datacadastropne, notafiscalpne, fornecedorpne, datacomprapne,
           valorcomprapne, kmacumuladopne, kmatualpne, kmmaximapne,
           localpne, veiculopne, posicaopne, dataultimamovimentacaopne,
           observacaopne, quantidaderecapagenspne, ativopne, modelopne
    FROM frotas.pneus
    WHERE (
      NULLIF(TRIM(veiculopne::text), '') IS NULL
      OR LOWER(TRIM(localpne::text)) LIKE '%estoque%'
    )
    ORDER BY nomepne
    LIMIT 500
  `);

  return rows.filter((row) => isTireActive(row.ativopne)).map(mapClientTireRow);
}

export async function fetchPositions() {
  const { rows } = await queryClient("posicoes pneus", `
    SELECT codigopop::text AS codigopop, nomepop, abreviacaopop,
           eixoveiculopop::text AS eixoveiculopop, ativopop
    FROM frotas.posicoespneus
    ORDER BY eixoveiculopop, codigopop
  `);

  return rows
    .filter((row) => {
      const v = normalizeText(row.ativopop).toLowerCase();
      return !["n", "0", "false", "nao", "inativo"].includes(v);
    })
    .map((row) => ({
      codigopop: normalizeText(row.codigopop),
      nomepop: normalizeText(row.nomepop),
      abreviacaopop: normalizeText(row.abreviacaopop),
      eixoveiculopop: normalizeText(row.eixoveiculopop),
      ...classifyPosition(row),
    }));
}

export async function fetchVehicles(search = "") {
  const like = `%${normalizeText(search)}%`;

  try {
    const { rows } = await queryClient("veiculos", `
      SELECT veiculos.placavei AS placa,
             veiculos.nomevei AS nome,
             veiculos.empresavei AS empresa
      FROM frotas.veiculos veiculos
      WHERE veiculos.placavei IS NOT NULL
        AND COALESCE(veiculos.situacaovei::text, '') <> 'I'
        AND veiculos.tipopropriedadevei::text = 'P'
        ${HEAVY_VEHICLE_SQL}
        AND ($1::text = '%%' OR CONCAT_WS(' ', veiculos.placavei, veiculos.nomevei) ILIKE $1::text)
      ORDER BY veiculos.placavei
      LIMIT 80
    `, [like]);
    return mapVehicles(rows);
  } catch (error) {
    logPneus("fallback consulta veiculos sem tipopropriedadevei", { error: error.message });
    const { rows } = await queryClient("veiculos fallback", `
      SELECT veiculos.placavei AS placa,
             veiculos.nomevei AS nome,
             veiculos.empresavei AS empresa
      FROM frotas.veiculos veiculos
      WHERE veiculos.placavei IS NOT NULL
        AND COALESCE(veiculos.situacaovei::text, '') <> 'I'
        ${HEAVY_VEHICLE_SQL}
        AND ($1::text = '%%' OR CONCAT_WS(' ', veiculos.placavei, veiculos.nomevei) ILIKE $1::text)
      ORDER BY veiculos.placavei
      LIMIT 80
    `, [like]);
    return mapVehicles(rows);
  }
}

function mapVehicles(rows) {
  return rows.map((row) => ({
    placa: normalizeText(row.placa),
    nome: normalizeText(row.nome),
    empresa: normalizeText(row.empresa),
    label: [row.placa, row.nome].filter(Boolean).join(" - "),
  }));
}

async function fetchLatestTelemetryHodometer(placa) {
  const vPool = getVeiculosPool();
  const { rows } = await vPool.query(`
    SELECT
      v.placa,
      mcb.odometro,
      mcb.data_hora
    FROM rodobach.mensagens_cb mcb
    JOIN rodobach.veiculos v
      ON v.veiculo_id = mcb.veiculo_id
    WHERE UPPER(TRIM(v.placa)) = UPPER(TRIM($1))
      AND mcb.odometro IS NOT NULL
      AND mcb.odometro > 0
      AND mcb.tipo_mensagem = 1
      AND mcb.evento_gerador = 13
    ORDER BY mcb.data_hora DESC
    LIMIT 1
  `, [placa]);

  const row = rows[0];
  if (!row) return null;

  return {
    placa: normalizeText(row.placa),
    odometro: Number(row.odometro),
    dataHora: row.data_hora,
    origem: "hodometro_telemetria",
  };
}

async function fetchLatestTelemetryOdometer(placa) {
  const vPool = getVeiculosPool();
  const { rows } = await vPool.query(`
    SELECT
      v.placa,
      mcb.odometro,
      mcb.data_hora
    FROM rodobach.mensagens_cb mcb
    JOIN rodobach.veiculos v
      ON v.veiculo_id = mcb.veiculo_id
    WHERE UPPER(TRIM(v.placa)) = UPPER(TRIM($1))
    ORDER BY mcb.data_hora DESC
    LIMIT 1
  `, [placa]);

  const row = rows[0];
  if (!row || Number(row.odometro) <= 0) return null;

  return {
    placa: normalizeText(row.placa),
    odometro: Number(row.odometro),
    dataHora: row.data_hora,
    origem: "telemetria",
  };
}

async function fetchClientVehicleKm(placa) {
  const placaNormalizada = normalizeText(placa).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const { rows } = await queryClient("km mais recente do sistema", `
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
    )
    SELECT placa, km, data_ref, origem
    FROM eventos
    WHERE placa = $1
      AND km BETWEEN 10000 AND 2000000
      AND data_ref IS NOT NULL
    ORDER BY data_ref DESC, km DESC
    LIMIT 1
  `, [placaNormalizada]);

  const row = rows[0];
  if (!row || row.km == null) return null;

  return {
    placa: normalizeText(row.placa),
    odometro: Number(row.km),
    dataHora: row.data_ref,
    origem: `sistema_${row.origem}`,
  };
}

async function fetchEngatePorImplemento(placa) {
  const { rows } = await queryClient("engate implemento", `
    SELECT placa_principal, placa_reboque1, placa_reboque2, placa_reboque3
    FROM frotas.veiculosreboquesmotoristas
    WHERE UPPER(TRIM(COALESCE(placa_reboque1, ''))) = UPPER(TRIM($1))
       OR UPPER(TRIM(COALESCE(placa_reboque2, ''))) = UPPER(TRIM($1))
       OR UPPER(TRIM(COALESCE(placa_reboque3, ''))) = UPPER(TRIM($1))
    LIMIT 1
  `, [placa]);

  const row = rows[0];
  if (!row?.placa_principal) return null;

  return {
    placaPrincipal: normalizeText(row.placa_principal),
    reboques: [row.placa_reboque1, row.placa_reboque2, row.placa_reboque3]
      .map(normalizeText)
      .filter(Boolean),
  };
}

export async function getOdometroAtualVeiculo(veiculo) {
  const placa = normalizeText(veiculo).toUpperCase();
  if (!placa) throw new Error("Placa e obrigatoria.");

  const direto = await fetchLatestTelemetryOdometer(placa).catch((error) => {
    logPneus("telemetria indisponivel para placa direta", { placa, error: error.message });
    return null;
  });
  if (direto) {
    return {
      ...direto,
      placaSolicitada: placa,
      placaOdometro: direto.placa,
      engate: null,
    };
  }

  const engate = await fetchEngatePorImplemento(placa).catch((error) => {
    logPneus("engate indisponivel", { placa, error: error.message });
    return null;
  });
  if (engate?.placaPrincipal) {
    const telemetriaPrincipal = await fetchLatestTelemetryOdometer(engate.placaPrincipal).catch((error) => {
      logPneus("telemetria indisponivel para placa principal", { placaPrincipal: engate.placaPrincipal, error: error.message });
      return null;
    });
    if (telemetriaPrincipal) {
      return {
        ...telemetriaPrincipal,
        placaSolicitada: placa,
        placaOdometro: telemetriaPrincipal.placa,
        origem: "telemetria_engate",
        engate,
      };
    }
  }

  const fallbackPlaca = engate?.placaPrincipal || placa;
  const cadastro = await fetchClientVehicleKm(fallbackPlaca);
  if (cadastro) {
    return {
      ...cadastro,
      placaSolicitada: placa,
      placaOdometro: cadastro.placa,
      origem: engate?.placaPrincipal ? `${cadastro.origem}_engate` : cadastro.origem,
      engate,
    };
  }

  return {
    placaSolicitada: placa,
    placaOdometro: fallbackPlaca,
    odometro: null,
    dataHora: null,
    origem: "nao_encontrado",
    engate,
  };
}

async function fetchMovimentosByTireCodes(codes) {
  if (!codes.length) return [];
  const { rows } = await queryApp("movimentacoes por pneu", `
    SELECT id, empresa, codigo_pneu_cliente, nome_pneu,
           veiculo_origem, veiculo_destino,
           posicao_origem, posicao_destino, local_origem, local_destino,
           tipo_movimento, km_veiculo, km_pneu_atual,
           data_movimento, usuario_id, observacao, snapshot_pneu_json,
           criado_em, atualizado_em
    FROM ${MOV_TABLE}
    WHERE codigo_pneu_cliente = ANY($1::text[])
    ORDER BY data_movimento ASC, id ASC
  `, [codes]);

  return rows.map(mapMovementRow);
}

async function fetchMovimentosByVeiculo(veiculo) {
  const { rows } = await queryApp("codigos movimentados por veiculo", `
    SELECT DISTINCT codigo_pneu_cliente
    FROM ${MOV_TABLE}
    WHERE UPPER(TRIM(COALESCE(veiculo_origem, ''))) = UPPER(TRIM($1))
       OR UPPER(TRIM(COALESCE(veiculo_destino, ''))) = UPPER(TRIM($1))
  `, [veiculo]);

  return rows.map((row) => normalizeText(row.codigo_pneu_cliente));
}

async function fetchAllMovedTireCodes() {
  const { rows } = await queryApp("todos codigos movimentados", `
    SELECT DISTINCT codigo_pneu_cliente
    FROM ${MOV_TABLE}
  `);
  return rows.map((row) => normalizeText(row.codigo_pneu_cliente));
}

async function buildStateMap(codes) {
  const uniqueCodes = [...new Set(codes.map(normalizeText).filter(Boolean))];
  if (!uniqueCodes.length) return new Map();

  const [clientTires, movements] = await Promise.all([
    fetchClientTiresByCodes(uniqueCodes),
    fetchMovimentosByTireCodes(uniqueCodes),
  ]);

  const stateMap = new Map();
  for (const tire of clientTires) {
    stateMap.set(tire.codigopne, { ...tire });
  }

  for (const mov of movements) {
    if (!stateMap.has(mov.codigo_pneu_cliente)) {
      stateMap.set(mov.codigo_pneu_cliente, {
        codigopne: mov.codigo_pneu_cliente,
        nomepne: mov.nome_pneu || mov.codigo_pneu_cliente,
        marcapne: "",
        modelopne: "",
        tamanhopne: "",
        tipopne: "",
        empresapne: mov.empresa || "",
        kmacumuladopne: 0,
        kmatualpne: Number(mov.km_pneu_atual ?? 0),
        kmmaximapne: 0,
        quantidaderecapagenspne: 0,
        datacadastropne: null,
        datacomprapne: null,
        valorcomprapne: null,
        notafiscalpne: null,
        fornecedorpne: null,
        observacaopne: null,
        dataultimamovimentacaopne: null,
        local: "estoque",
        veiculo: null,
        posicao: null,
        ultimaMovimentacaoRodobach: null,
        _semDadosCliente: true,
      });
    }
    applyMovimento(stateMap.get(mov.codigo_pneu_cliente), mov);
  }

  return stateMap;
}

function classifyPosition(pos) {
  const nome = normalizeText(pos.nomepop).toLowerCase();
  const abrev = normalizeText(pos.abreviacaopop).toUpperCase();

  if (nome.includes("estepe") || nome.includes("reserva") || abrev === "ESP" || abrev.startsWith("EST")) {
    return { lado: "estepe", tipoLado: null, ordemVisual: 99 };
  }

  const esquerdo = nome.includes("esquerdo");
  const direito = nome.includes("direito");
  const externo = nome.includes("externo");
  const interno = nome.includes("interno");

  if (esquerdo && externo) return { lado: "esquerdo", tipoLado: "externo", ordemVisual: 0 };
  if (esquerdo && interno) return { lado: "esquerdo", tipoLado: "interno", ordemVisual: 1 };
  if (esquerdo) return { lado: "esquerdo", tipoLado: "simples", ordemVisual: 0 };
  if (direito && interno) return { lado: "direito", tipoLado: "interno", ordemVisual: 2 };
  if (direito && externo) return { lado: "direito", tipoLado: "externo", ordemVisual: 3 };
  if (direito) return { lado: "direito", tipoLado: "simples", ordemVisual: 3 };

  return { lado: null, tipoLado: null, ordemVisual: 50 };
}

export async function getEstadoAtualPneusPorVeiculo(veiculo) {
  const placa = normalizeText(veiculo).toUpperCase();
  const clientTiresForVehicle = await fetchClientTiresForVehicle(placa);
  const clientCodes = clientTiresForVehicle.map((tire) => tire.codigopne);
  const movedCodes = await fetchMovimentosByVeiculo(placa);
  const stateMap = await buildStateMap([...clientCodes, ...movedCodes]);

  const pneusNoVeiculo = Array.from(stateMap.values())
    .filter((tire) =>
      tire.local === "veiculo" &&
      tire.veiculo &&
      tire.veiculo.toUpperCase().trim() === placa
    );

  const posicoes = await fetchPositions();
  return { pneusNoVeiculo, posicoes };
}

export async function getPneusEstoque() {
  const [clientStockTires, movedCodes] = await Promise.all([
    fetchClientStockTires(),
    fetchAllMovedTireCodes(),
  ]);
  const stateMap = await buildStateMap([
    ...clientStockTires.map((tire) => tire.codigopne),
    ...movedCodes,
  ]);

  return Array.from(stateMap.values()).filter((tire) => tire.local === "estoque");
}

export async function getHistoricoMovimentacoes({
  veiculo,
  pneu,
  empresa,
  tipo,
  dataInicio,
  dataFim,
  limit = 50,
  offset = 0,
} = {}) {
  const params = [];
  const where = [];

  if (veiculo) {
    params.push(normalizeText(veiculo).toUpperCase());
    where.push(`(
      UPPER(TRIM(COALESCE(veiculo_origem, ''))) = $${params.length}
      OR UPPER(TRIM(COALESCE(veiculo_destino, ''))) = $${params.length}
    )`);
  }
  if (pneu) {
    params.push(normalizeText(pneu));
    where.push(`codigo_pneu_cliente = $${params.length}`);
  }
  if (empresa) {
    params.push(normalizeText(empresa));
    where.push(`empresa = $${params.length}`);
  }
  if (tipo) {
    params.push(normalizeTipo(tipo));
    where.push(`tipo_movimento = $${params.length}`);
  }
  if (dataInicio) {
    params.push(dataInicio);
    where.push(`data_movimento >= $${params.length}::timestamptz`);
  }
  if (dataFim) {
    params.push(dataFim);
    where.push(`data_movimento <= $${params.length}::timestamptz`);
  }

  params.push(Math.min(Number(limit) || 50, 500));
  params.push(Number(offset) || 0);

  const { rows } = await queryApp("historico movimentacoes", `
    SELECT id, empresa, codigo_pneu_cliente, nome_pneu,
           veiculo_origem, veiculo_destino,
           posicao_origem, posicao_destino, local_origem, local_destino,
           tipo_movimento, km_veiculo, km_pneu_atual,
           data_movimento, usuario_id, observacao, snapshot_pneu_json,
           criado_em, atualizado_em
    FROM ${MOV_TABLE}
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY data_movimento DESC, id DESC
    LIMIT $${params.length - 1}
    OFFSET $${params.length}
  `, params);

  return rows.map(mapMovementRow);
}

async function getCurrentTireState(codigoPneuCliente) {
  const stateMap = await buildStateMap([codigoPneuCliente]);
  return stateMap.get(codigoPneuCliente) ?? null;
}

async function validateTargetPosition({ codigoPneuCliente, veiculoDestino, posicaoDestino }) {
  const { pneusNoVeiculo } = await getEstadoAtualPneusPorVeiculo(veiculoDestino);
  const ocupante = pneusNoVeiculo.find((pneu) =>
    normalizeText(pneu.posicao) === normalizeText(posicaoDestino) &&
    normalizeText(pneu.codigopne) !== normalizeText(codigoPneuCliente)
  );

  if (ocupante) {
    throw new Error(`Ja existe um pneu na posicao ${posicaoDestino} neste veiculo.`);
  }
}

export async function registrarMovimentacaoPneu(payload) {
  const codigoPneuCliente = normalizeText(payload.codigoPneuCliente ?? payload.codigo_pneu_cliente);
  const tipoMovimento = normalizeTipo(payload.tipoMovimento ?? payload.tipo_movimento);
  const localDestino = normalizeText(payload.localDestino ?? payload.local_destino).toLowerCase();
  const veiculoDestino = normalizeText(payload.veiculoDestino ?? payload.veiculoCliente ?? payload.veiculo_destino ?? payload.veiculo_cliente) || null;
  const veiculoOrigem = normalizeText(payload.veiculoOrigem ?? payload.veiculo_origem) || null;
  const posicaoDestino = normalizeText(payload.posicaoDestino ?? payload.posicao_destino) || null;
  const posicaoOrigem = normalizeText(payload.posicaoOrigem ?? payload.posicao_origem) || null;
  const localOrigem = normalizeText(payload.localOrigem ?? payload.local_origem).toLowerCase() || null;
  const kmVeiculo = payload.kmVeiculo ?? payload.km_veiculo;
  const kmPneuAtual = payload.kmPneuAtual ?? payload.km_pneu_atual;
  const snapshot = payload.dadosSnapshotJson ?? payload.snapshotPneuJson ?? payload.snapshot_pneu_json ?? null;
  const nomePneu = normalizeText(payload.nomePneu ?? payload.nome_pneu ?? snapshot?.nomepne) || null;

  if (!codigoPneuCliente) throw new Error("Codigo do pneu e obrigatorio.");
  if (!localDestino) throw new Error("Destino e obrigatorio.");
  if (!tipoMovimento) throw new Error("Tipo de movimentacao e obrigatorio.");
  if (!TIPOS_VALIDOS.has(tipoMovimento)) throw new Error(`Tipo de movimentacao invalido: ${tipoMovimento}`);

  if (!kmVeiculo && ["MONTAGEM", "TROCA_POSICAO", "DESMONTAGEM"].includes(tipoMovimento)) {
    throw new Error("KM atual do veiculo e obrigatorio para esta movimentacao.");
  }

  const currentState = await getCurrentTireState(codigoPneuCliente);
  if (["BAIXA", "DESCARTE"].includes(normalizeTipo(currentState?.local))) {
    throw new Error("Pneu baixado ou descartado nao pode ser movimentado sem confirmacao especial.");
  }

  if (["MONTAGEM", "TROCA_POSICAO"].includes(tipoMovimento)) {
    if (!veiculoDestino) throw new Error("Veiculo e obrigatorio para montagem.");
    if (!posicaoDestino) throw new Error("Posicao de destino e obrigatoria para montagem.");
    await validateTargetPosition({ codigoPneuCliente, veiculoDestino, posicaoDestino });

    if (currentState?.local === "veiculo" && currentState.veiculo !== veiculoDestino && tipoMovimento === "MONTAGEM") {
      throw new Error("Este pneu ja esta montado em outro veiculo.");
    }
  }

  logPneus("registrando movimentacao", { codigoPneuCliente, tipoMovimento, veiculoDestino, posicaoDestino });
  const { rows } = await pool.query(`
    INSERT INTO ${MOV_TABLE} (
      empresa, codigo_pneu_cliente, nome_pneu,
      veiculo_origem, veiculo_destino,
      posicao_origem, posicao_destino,
      local_origem, local_destino, tipo_movimento,
      km_veiculo, km_pneu_atual, data_movimento,
      usuario_id, observacao, snapshot_pneu_json
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, COALESCE($13::timestamptz, CURRENT_TIMESTAMP),
      $14, $15, $16
    )
    RETURNING *
  `, [
    payload.empresa ?? currentState?.empresapne ?? null,
    codigoPneuCliente,
    nomePneu ?? currentState?.nomepne ?? null,
    veiculoOrigem ?? currentState?.veiculo ?? veiculoDestino ?? null,
    ["MONTAGEM", "TROCA_POSICAO"].includes(tipoMovimento) ? veiculoDestino : null,
    posicaoOrigem ?? currentState?.posicao ?? null,
    ["MONTAGEM", "TROCA_POSICAO"].includes(tipoMovimento) ? posicaoDestino : null,
    localOrigem ?? currentState?.local ?? "estoque",
    localDestino,
    tipoMovimento,
    kmVeiculo ? Number(kmVeiculo) : null,
    kmPneuAtual ? Number(kmPneuAtual) : currentState?.kmatualpne ?? null,
    payload.dataMovimento ?? payload.data_movimento ?? null,
    payload.usuarioId ?? payload.usuario ?? payload.usuario_id ?? null,
    payload.observacao ?? null,
    snapshot ? JSON.stringify(snapshot) : currentState ? JSON.stringify(currentState) : null,
  ]);

  return mapMovementRow(rows[0]);
}

export { fetchClientTiresByCodes };
