import { tableName } from "../config.js";
import { pool } from "../db/pool.js";
import { clientPool } from "../db/clientPool.js";
import { getVeiculosPool } from "../db/pool-veiculos.js";

const JORNADAS = () => tableName("jornada_motorista");
const MOVIMENTOS = () => tableName("movimento_folga_motorista");
const DIAS_POR_FOLGA = 6;
const DATA_CORTE_RETROATIVO = "2026-01-01";
const PLACAS_FROTA = [
  "RAA8G18", "RAA8G58", "RXO6C18", "RXW7J14", "RYI6H21",
  "RYP7D29", "RYU2G97", "SXR8D09", "SXY5D26",
];

async function carregarRetroativo() {
  const { rows } = await clientPool.query(`
    WITH viagens AS (
      SELECT DISTINCT ON (cv.empresacvg, cv.codigocvg)
        cv.empresacvg AS empresa,
        cv.motoristacvg AS motorista,
        cv.codigocvg AS viagem,
        regexp_replace(upper(con.veiculocon::text), '[^A-Z0-9]', '', 'g') AS placa,
        cv.datasaidacvg + COALESCE(cv.horasaidacvg, TIME '00:00') AS saida,
        cv.datachegadacvg + COALESCE(cv.horachegadacvg, TIME '00:00') AS chegada
      FROM logistica.conhecimentos con
      JOIN LATERAL (
        SELECT x.*
        FROM logistica.controleviagens x
        WHERE x.codigocvg IN (con.viagemcon, con.cargacontroleviagemcon, con.numeroviagemcon)
          AND (x.empresacvg = con.empresaviagemcon OR x.empresacvg = con.empresacon OR con.empresaviagemcon IS NULL)
        ORDER BY (x.codigocvg = con.viagemcon) DESC, x.codigocvg DESC
        LIMIT 1
      ) cv ON TRUE
      WHERE con.dataemissaocon >= $1::date
        AND regexp_replace(upper(con.veiculocon::text), '[^A-Z0-9]', '', 'g') = ANY($2::text[])
        AND cv.motoristacvg IS NOT NULL
      ORDER BY cv.empresacvg, cv.codigocvg, con.dataemissaocon
    ),
    totais AS (
      SELECT empresa, motorista,
        COUNT(*) FILTER (WHERE saida IS NOT NULL AND chegada IS NOT NULL)::int AS viagens_completas,
        COUNT(*) FILTER (WHERE saida IS NULL OR chegada IS NULL)::int AS viagens_pendentes,
        COALESCE(SUM(
          GREATEST(0, EXTRACT(EPOCH FROM (chegada - GREATEST(saida, $1::date::timestamp))) / 86400)
        ) FILTER (WHERE saida IS NOT NULL AND chegada IS NOT NULL AND chegada >= $1::date), 0) AS dias_exatos
      FROM viagens
      GROUP BY empresa, motorista
    )
    SELECT empresa, motorista, viagens_completas, viagens_pendentes,
      FLOOR(dias_exatos)::int AS dias_fora,
      FLOOR(FLOOR(dias_exatos) / $3::numeric)::int AS dias_folga,
      MOD(FLOOR(dias_exatos)::int, $3::int)::int AS saldo_dias
    FROM totais
  `, [DATA_CORTE_RETROATIVO, PLACAS_FROTA, DIAS_POR_FOLGA]);

  return new Map(rows.map((row) => [
    `${row.empresa}:${row.motorista}`,
    {
      dataCorte: DATA_CORTE_RETROATIVO,
      viagensCompletas: Number(row.viagens_completas || 0),
      viagensPendentes: Number(row.viagens_pendentes || 0),
      diasFora: Number(row.dias_fora || 0),
      diasFolga: Number(row.dias_folga || 0),
      saldoDias: Number(row.saldo_dias || 0),
    },
  ]));
}

async function carregarValidacaoTelemetria() {
  const inicioTelemetria = "2026-05-25";
  const { rows: viagens } = await clientPool.query(`
    SELECT DISTINCT ON (cv.empresacvg, cv.codigocvg)
      cv.empresacvg AS empresa, cv.motoristacvg AS motorista, cv.codigocvg AS viagem,
      regexp_replace(upper(con.veiculocon::text), '[^A-Z0-9]', '', 'g') AS placa,
      cv.datasaidacvg + COALESCE(cv.horasaidacvg, TIME '00:00') AS saida,
      cv.datachegadacvg + COALESCE(cv.horachegadacvg, TIME '00:00') AS chegada
    FROM logistica.conhecimentos con
    JOIN LATERAL (
      SELECT x.* FROM logistica.controleviagens x
      WHERE x.codigocvg IN (con.viagemcon, con.cargacontroleviagemcon, con.numeroviagemcon)
        AND (x.empresacvg = con.empresaviagemcon OR x.empresacvg = con.empresacon OR con.empresaviagemcon IS NULL)
      ORDER BY (x.codigocvg = con.viagemcon) DESC, x.codigocvg DESC LIMIT 1
    ) cv ON TRUE
    WHERE con.dataemissaocon >= $1::date
      AND regexp_replace(upper(con.veiculocon::text), '[^A-Z0-9]', '', 'g') = ANY($2::text[])
      AND cv.motoristacvg IS NOT NULL AND cv.datasaidacvg IS NOT NULL AND cv.datachegadacvg IS NOT NULL
    ORDER BY cv.empresacvg, cv.codigocvg, con.dataemissaocon
  `, [inicioTelemetria, PLACAS_FROTA]);

  let transitions = [];
  try {
    const schema = process.env.VEICULOS_DB_SCHEMA || "rodobach";
    const { rows } = await getVeiculosPool().query(`
      WITH posicoes AS (
        SELECT UPPER(TRIM(v.placa)) AS placa, m.data_hora,
          (UPPER(COALESCE(m.municipio, '')) LIKE 'MORRO DA FUM%') AS na_base,
          LAG(UPPER(COALESCE(m.municipio, '')) LIKE 'MORRO DA FUM%')
            OVER (PARTITION BY v.veiculo_id ORDER BY m.data_hora) AS anterior
        FROM "${schema}".mensagens_cb m
        JOIN "${schema}".veiculos v ON v.veiculo_id = m.veiculo_id
        WHERE regexp_replace(UPPER(v.placa), '[^A-Z0-9]', '', 'g') = ANY($1::text[])
      )
      SELECT placa, data_hora, CASE WHEN na_base THEN 'entrada' ELSE 'saida' END AS tipo
      FROM posicoes WHERE anterior IS DISTINCT FROM na_base
      ORDER BY placa, data_hora
    `, [PLACAS_FROTA]);
    transitions = rows;
  } catch {
    return new Map();
  }

  const byPlate = new Map();
  transitions.forEach((row) => {
    const list = byPlate.get(row.placa) || [];
    list.push(row);
    byPlate.set(row.placa, list);
  });
  const result = new Map();
  for (const viagem of viagens) {
    const key = `${viagem.empresa}:${viagem.motorista}`;
    const summary = result.get(key) || { total: 0, confirmadas: 0, parciais: 0, divergentes: 0, coberturaDesde: inicioTelemetria };
    const events = byPlate.get(viagem.placa) || [];
    const nearest = (tipo, target) => events
      .filter((event) => event.tipo === tipo)
      .reduce((best, event) => {
        const diff = Math.abs(new Date(event.data_hora) - new Date(target)) / 3600000;
        return !best || diff < best.diff ? { diff, event } : best;
      }, null);
    const departure = nearest("saida", viagem.saida);
    const arrival = nearest("entrada", viagem.chegada);
    const departureOk = departure && departure.diff <= 24;
    const arrivalOk = arrival && arrival.diff <= 24;
    summary.total += 1;
    if (departureOk && arrivalOk) summary.confirmadas += 1;
    else if (departureOk || arrivalOk) summary.parciais += 1;
    else summary.divergentes += 1;
    result.set(key, summary);
  }
  for (const summary of result.values()) {
    summary.nivel = summary.divergentes > 0 ? "revisar"
      : summary.parciais > 0 ? "provavel"
      : summary.confirmadas > 0 ? "confirmado" : "sem_dados";
  }
  return result;
}

async function carregarMovimentos(keys) {
  if (!keys.length) return new Map();
  const { rows } = await pool.query(`
    SELECT empresa_motorista, codigo_motorista,
      COALESCE(SUM(quantidade) FILTER (WHERE tipo = 'uso'), 0) AS utilizadas,
      COALESCE(SUM(quantidade) FILTER (WHERE tipo = 'ajuste'), 0) AS ajustes
    FROM ${MOVIMENTOS()}
    WHERE (empresa_motorista::text || ':' || codigo_motorista::text) = ANY($1::text[])
    GROUP BY empresa_motorista, codigo_motorista
  `, [keys]);
  return new Map(rows.map((row) => [`${row.empresa_motorista}:${row.codigo_motorista}`, {
    utilizadas: Number(row.utilizadas || 0), ajustes: Number(row.ajustes || 0),
  }]));
}

function mapJornada(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    saidaEm: row.saida_em,
    retornoPrevistoEm: row.retorno_previsto_em,
    retornoEm: row.retorno_em,
    origemSaida: row.origem_saida,
    origemRetorno: row.origem_retorno,
    observacoes: row.observacoes || "",
  };
}

function calcular(jornada) {
  if (!jornada) return { status: "disponivel", diasFora: 0, diasFolga: 0, saldoDias: 0, voltaAoTrabalho: null };
  const inicio = new Date(jornada.saidaEm);
  const fim = jornada.retornoEm ? new Date(jornada.retornoEm) : new Date();
  const diasFora = Math.max(0, Math.floor((fim - inicio) / 86400000));
  const diasFolga = Math.floor(diasFora / DIAS_POR_FOLGA);
  const saldoDias = diasFora % DIAS_POR_FOLGA;
  let voltaAoTrabalho = null;
  if (jornada.retornoEm) {
    const volta = new Date(jornada.retornoEm);
    volta.setDate(volta.getDate() + diasFolga);
    voltaAoTrabalho = volta.toISOString();
  }
  return {
    status: jornada.retornoEm ? (diasFolga ? "em_folga" : "disponivel") : "fora",
    diasFora,
    diasFolga,
    saldoDias,
    voltaAoTrabalho,
  };
}

export async function listarMotoristasFolgas({ busca = "", status = "", pagina = 1, limite = 50 } = {}) {
  const termo = String(busca || "").trim();
  const { rows: motoristas } = await clientPool.query(`
    SELECT
      m.empresamot AS empresa, m.codigomot AS codigo, m.nomemot AS nome,
      m.apelidomot AS apelido,
      CONCAT_WS('', NULLIF(m.dddcelularmot::text, ''), NULLIF(m.celularmot::text, '')) AS telefone,
      v.placavei AS placa
    FROM frotas.motoristas m
    JOIN frotas.veiculos v
      ON v.empresavei = m.empresamot
     AND v.motoristavei = m.codigomot
     AND v.tipopropriedadevei = 'P'
     AND v.situacaovei = 1
     AND v.tipovei = 1
     AND regexp_replace(upper(v.placavei::text), '[^A-Z0-9]', '', 'g') = ANY($2::text[])
    WHERE m.ativomot = 'S'
      AND COALESCE(m.situacaomot, 1) = 1
      AND m.datademissaomot IS NULL
      AND ($1 = '' OR m.nomemot ILIKE '%' || $1 || '%' OR COALESCE(m.apelidomot, '') ILIKE '%' || $1 || '%'
        OR COALESCE(v.placavei, '') ILIKE '%' || $1 || '%')
    ORDER BY m.nomemot
  `, [termo, PLACAS_FROTA]);

  const keys = motoristas.map((m) => `${m.empresa}:${m.codigo}`);
  const [retroativos, validacoes, movimentos] = await Promise.all([
    carregarRetroativo(), carregarValidacaoTelemetria(), carregarMovimentos(keys),
  ]);
  const jornadasPorMotorista = new Map();
  if (keys.length) {
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (empresa_motorista, codigo_motorista) *
      FROM ${JORNADAS()}
      WHERE (empresa_motorista::text || ':' || codigo_motorista::text) = ANY($1::text[])
      ORDER BY empresa_motorista, codigo_motorista, saida_em DESC
    `, [keys]);
    rows.forEach((row) => jornadasPorMotorista.set(`${row.empresa_motorista}:${row.codigo_motorista}`, mapJornada(row)));
  }

  const agora = new Date();
  let itens = motoristas.map((motorista) => {
    const jornada = jornadasPorMotorista.get(`${motorista.empresa}:${motorista.codigo}`) || null;
    const calculo = calcular(jornada);
    if (calculo.status === "em_folga" && calculo.voltaAoTrabalho && new Date(calculo.voltaAoTrabalho) <= agora) {
      calculo.status = "disponivel";
    }
    const retroativo = retroativos.get(`${motorista.empresa}:${motorista.codigo}`) || {
      dataCorte: DATA_CORTE_RETROATIVO, viagensCompletas: 0, viagensPendentes: 0,
      diasFora: 0, diasFolga: 0, saldoDias: 0,
    };
    const movimento = movimentos.get(`${motorista.empresa}:${motorista.codigo}`) || { utilizadas: 0, ajustes: 0 };
    const folgasDisponiveis = Math.max(0, retroativo.diasFolga - movimento.utilizadas + movimento.ajustes);
    return {
      empresa: Number(motorista.empresa),
      codigo: Number(motorista.codigo),
      nome: motorista.nome || motorista.apelido || "Motorista",
      apelido: motorista.apelido || "",
      telefone: motorista.telefone || "",
      placa: motorista.placa || "",
      jornada,
      retroativo: { ...retroativo, folgasUtilizadas: movimento.utilizadas, ajustes: movimento.ajustes, folgasDisponiveis },
      validacao: validacoes.get(`${motorista.empresa}:${motorista.codigo}`) || {
        nivel: "sem_dados", total: 0, confirmadas: 0, parciais: 0, divergentes: 0, coberturaDesde: "2026-05-25",
      },
      ...calculo,
    };
  });
  if (status) itens = itens.filter((item) => item.status === status);

  const total = itens.length;
  const resumo = {
    total,
    fora: itens.filter((item) => item.status === "fora").length,
    emFolga: itens.filter((item) => item.status === "em_folga").length,
    disponiveis: itens.filter((item) => item.status === "disponivel").length,
  };
  const page = Math.max(1, Number(pagina) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(limite) || 50));
  itens = itens.slice((page - 1) * pageSize, page * pageSize);

  return {
    regra: { diasPorFolga: DIAS_POR_FOLGA },
    resumo,
    pagina: page,
    limite: pageSize,
    total,
    itens,
  };
}

export async function registrarMovimentoFolga(payload, usuario) {
  const { empresa, codigo, tipo, quantidade, dataMovimento, observacoes } = payload || {};
  const amount = Number(quantidade);
  if (!empresa || !codigo || !["uso", "ajuste"].includes(tipo) || !Number.isFinite(amount) || (tipo === "uso" && amount <= 0)) {
    throw new Error("Dados do movimento de folga invalidos.");
  }
  const { rows } = await pool.query(`
    INSERT INTO ${MOVIMENTOS()}
      (empresa_motorista, codigo_motorista, tipo, quantidade, data_movimento, observacoes, criado_por)
    VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6, $7)
    RETURNING *
  `, [empresa, codigo, tipo, amount, dataMovimento || null, observacoes || null, usuario || null]);
  return rows[0];
}

export async function registrarSaida(payload, usuario) {
  const { empresa, codigo, saidaEm, retornoPrevistoEm, observacoes } = payload || {};
  if (!empresa || !codigo || !saidaEm) throw new Error("Motorista e data de saida sao obrigatorios.");
  const { rows } = await pool.query(`
    INSERT INTO ${JORNADAS()}
      (empresa_motorista, codigo_motorista, saida_em, retorno_previsto_em, observacoes, criado_por, atualizado_por)
    VALUES ($1, $2, $3, $4, $5, $6, $6)
    RETURNING *
  `, [empresa, codigo, saidaEm, retornoPrevistoEm || null, observacoes || null, usuario || null]);
  return mapJornada(rows[0]);
}

export async function registrarRetorno(id, payload, usuario) {
  const { retornoEm, observacoes } = payload || {};
  if (!retornoEm) throw new Error("Data de retorno e obrigatoria.");
  const { rows } = await pool.query(`
    UPDATE ${JORNADAS()}
    SET retorno_em = $2, origem_retorno = 'manual',
        observacoes = COALESCE($3, observacoes), atualizado_por = $4, atualizado_em = NOW()
    WHERE id = $1 AND retorno_em IS NULL
    RETURNING *
  `, [id, retornoEm, observacoes || null, usuario || null]);
  if (!rows[0]) throw new Error("Jornada aberta nao encontrada.");
  const jornada = mapJornada(rows[0]);
  return { ...jornada, ...calcular(jornada) };
}
