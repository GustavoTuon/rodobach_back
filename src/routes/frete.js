import { Router } from "express";
import { pool } from "../db/pool.js";
import { tableName } from "../config.js";
import { mapAnttRows, mapDiaria } from "../mappers.js";

export const freteRouter = Router();

// ── Constantes de cálculo (espelhadas do backend antigo) ─────────────────────
const DEFAULTS = {
  icmsPercent: 12,
  cargoInsurancePercent: 0.042952,    // % do valor da nota (seguro de carga)
  thirdPartyInsurancePerKm: 0.02748,  // R$/km (seguro RC estimado)
  inssBasePercent: 20,                // base INSS = 20% do valor motorista
  inssPercent: 11,                    // INSS descontado do motorista = 11% da base
  sestPercent: 1.5,                   // SEST = 1,5% da base
  senatPercent: 1,                    // SENAT = 1% da base
  patronalInssPercent: 2.698,         // custo patronal TAC = 2,698% do valor motorista
};

function round(v) {
  return Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
}

function readNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function calcRpaCharges(driverValue) {
  const inssBase    = driverValue * (DEFAULTS.inssBasePercent / 100);
  const inss        = inssBase * (DEFAULTS.inssPercent / 100);
  const sest        = inssBase * (DEFAULTS.sestPercent / 100);
  const senat       = inssBase * (DEFAULTS.senatPercent / 100);
  const totalDesc   = inss + sest + senat;
  const patronal    = driverValue * (DEFAULTS.patronalInssPercent / 100);
  return {
    inssBase:        round(inssBase),
    inss:            round(inss),
    sest:            round(sest),
    senat:           round(senat),
    totalDescontos:  round(totalDesc),
    valorLiquidoMot: round(driverValue - totalDesc),
    patronalInss:    round(patronal),
  };
}

// ── GET /api/frete/antt ───────────────────────────────────────────────────────
freteRouter.get("/frete/antt", async (_req, res, next) => {
  try {
    // Tenta tabela nova (antt_tabela) — pivot por tipo_carga
    const { rows } = await pool.query(`
      SELECT id, tipo_veiculo, eixos, tipo_carga, km_valor, carga_descarga, data_vigencia, versao
      FROM ${tableName("antt_tabela")}
      WHERE ativo = true
      ORDER BY eixos, tipo_carga
    `);

    if (rows.length) {
      return res.json(mapAnttRows(rows));
    }

    // Fallback: tabela antiga (frete_tabela_antt) — colunas flat
    const { rows: old } = await pool.query(`
      SELECT id, tipo_veiculo, eixos,
             normal_custo_deslocamento,  normal_carga_descarga,
             alto_desempenho_custo_deslocamento, alto_desempenho_carga_descarga
      FROM "public"."frete_tabela_antt"
      WHERE ativo = true
      ORDER BY eixos
    `);

    const mapped = old.map(r => ({
      id: r.id,
      tipoVeiculo: r.tipo_veiculo,
      eixos: Number(r.eixos),
      normal: {
        kmValor:       Number(r.normal_custo_deslocamento),
        cargaDescarga: Number(r.normal_carga_descarga),
      },
      altoDesempenho: {
        kmValor:       Number(r.alto_desempenho_custo_deslocamento),
        cargaDescarga: Number(r.alto_desempenho_carga_descarga),
      },
    }));
    res.json(mapped);
  } catch (error) {
    next(error);
  }
});

// ── GET /api/motoristas/diarias ───────────────────────────────────────────────
freteRouter.get("/motoristas/diarias", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, codigo, descricao, horario_referencia, horas_rodadas_referencia, valor, ativo, ordem
      FROM ${tableName("parametro_diaria_motorista")}
      WHERE ativo = true
      ORDER BY ordem, descricao
    `);
    res.json(rows.map(mapDiaria));
  } catch (error) {
    next(error);
  }
});

// ── POST /api/frete/calcular ─────────────────────────────────────────────────
// Cálculo completo: ANTT + seguro carga + seguro RC + RPA/TAC + ICMS + margem
freteRouter.post("/frete/calcular", async (req, res, next) => {
  try {
    const {
      eixos,
      tipoCarga      = "normal",      // "normal" | "alto_desempenho"
      operacao       = "etc",         // "etc" | "tac"
      km             = 0,
      valorNota      = 0,             // valor da NF para seguro de carga
      pedagio        = 0,
      seguroRCManual = "",            // se vazio, estima por km
      margem         = 30,            // % de margem
      icms           = DEFAULTS.icmsPercent,
      valorMotoristaNegociado = "",   // simulação
      valorClienteNegociado   = "",   // simulação
    } = req.body || {};

    // 1. Busca tarifa ANTT
    let tarifaRow;
    try {
      const { rows } = await pool.query(`
        SELECT tipo_veiculo, eixos, tipo_carga, km_valor, carga_descarga
        FROM ${tableName("antt_tabela")}
        WHERE ativo = true AND eixos = $1 AND tipo_carga = $2
        ORDER BY data_vigencia DESC LIMIT 1
      `, [Number(eixos), tipoCarga]);
      tarifaRow = rows[0];
    } catch { /* ignora, tenta tabela antiga */ }

    if (!tarifaRow) {
      const col = tipoCarga === "normal"
        ? "normal_custo_deslocamento, normal_carga_descarga"
        : "alto_desempenho_custo_deslocamento AS km_valor_col, alto_desempenho_carga_descarga AS carga_col";

      const { rows: old } = await pool.query(`
        SELECT tipo_veiculo, eixos,
               normal_custo_deslocamento AS km_valor,
               normal_carga_descarga     AS carga_descarga,
               alto_desempenho_custo_deslocamento,
               alto_desempenho_carga_descarga
        FROM "public"."frete_tabela_antt"
        WHERE ativo = true AND eixos = $1 LIMIT 1
      `, [Number(eixos)]);

      if (!old.length) {
        return res.status(404).json({ error: "Tarifa ANTT não encontrada para o número de eixos informado." });
      }

      const r = old[0];
      tarifaRow = {
        tipo_veiculo:  r.tipo_veiculo,
        eixos:         r.eixos,
        km_valor:      tipoCarga === "normal"
          ? Number(r.normal_custo_deslocamento)
          : Number(r.alto_desempenho_custo_deslocamento),
        carga_descarga: tipoCarga === "normal"
          ? Number(r.normal_carga_descarga)
          : Number(r.alto_desempenho_carga_descarga),
      };
    }

    const kmNum      = readNum(km);
    const pedagioNum = readNum(pedagio);
    const margemNum  = readNum(margem, 30);
    const icmsNum    = readNum(icms,   DEFAULTS.icmsPercent);
    const notaNum    = readNum(valorNota);

    // 2. Valor base motorista (tabela ANTT)
    const deslocamento  = round(kmNum * Number(tarifaRow.km_valor));
    const cargaDescarga = round(Number(tarifaRow.carga_descarga));
    const valorMot      = round(deslocamento + cargaDescarga);

    // 3. Encargos adicionais
    const seguroCarga = round(notaNum * (DEFAULTS.cargoInsurancePercent / 100));
    const seguroRCEst = round(kmNum * DEFAULTS.thirdPartyInsurancePerKm);
    const seguroRC    = String(seguroRCManual).trim() !== ""
      ? readNum(seguroRCManual)
      : seguroRCEst;

    // 4. RPA/TAC
    const rpa = operacao === "tac" ? calcRpaCharges(valorMot) : null;
    const patronalCusto = rpa?.patronalInss ?? 0;

    // 5. Custo operacional (empresa paga)
    const encargosAdicionais = seguroCarga + seguroRC + pedagioNum + patronalCusto;
    const custoOperacional   = round(valorMot + encargosAdicionais);

    // 6. Valor cliente (net_margin: motorista+encargos é (1 - ICMS% - margem%) do cliente)
    const divisor      = 1 - icmsNum / 100 - margemNum / 100;
    const valorCliente = divisor > 0 ? round(custoOperacional / divisor) : 0;
    const icmsValor    = round(valorCliente * icmsNum / 100);
    const lucro        = round(valorCliente * margemNum / 100);
    const margemReal   = valorCliente > 0 ? round((lucro / valorCliente) * 100) : 0;

    // 7. Simulação de negociação
    let simulacao = null;
    const motNeg = String(valorMotoristaNegociado).trim();
    const cliNeg = String(valorClienteNegociado).trim();

    if (motNeg !== "" || cliNeg !== "") {
      const motSimNum = readNum(motNeg, valorMot);
      const rpaSim = operacao === "tac" ? calcRpaCharges(motSimNum) : null;
      const patronalSimCusto = rpaSim?.patronalInss ?? 0;
      const encSimAdic = seguroCarga + seguroRC + pedagioNum + patronalSimCusto;
      const custSimOp  = round(motSimNum + encSimAdic);
      let cliSimNum;

      if (cliNeg !== "") {
        cliSimNum = readNum(cliNeg);
      } else {
        cliSimNum = divisor > 0 ? round(custSimOp / divisor) : 0;
      }

      const icmsSimVal = round(cliSimNum * icmsNum / 100);
      const lucroSim   = round(cliSimNum - motSimNum - encSimAdic - icmsSimVal);
      const margemSim  = cliSimNum > 0 ? round((lucroSim / cliSimNum) * 100) : 0;

      simulacao = {
        valorMotorista:  motSimNum,
        valorCliente:    cliSimNum,
        icmsValor:       icmsSimVal,
        lucro:           lucroSim,
        margemPercent:   margemSim,
        encargosAdicionais: round(encSimAdic),
        custoOperacional:   custSimOp,
        rpa:             rpaSim,
        patronalInss:    patronalSimCusto,
      };
    }

    res.json({
      entrada: {
        tipoVeiculo: tarifaRow.tipo_veiculo,
        eixos: Number(tarifaRow.eixos),
        tipoCarga,
        operacao,
        km: kmNum,
        pedagio: pedagioNum,
        valorNota: notaNum,
        margemPercent: margemNum,
        icmsPercent: icmsNum,
      },
      tabela: {
        kmValor:       Number(tarifaRow.km_valor),
        cargaDescarga,
        deslocamento,
        valorMotoristaTabela: valorMot,
      },
      encargos: {
        seguroCarga,
        seguroRC,
        seguroRCEstimado: seguroRCEst,
        pedagio: pedagioNum,
        rpa,
        patronalInss: patronalCusto,
        encargosAdicionais: round(encargosAdicionais),
        custoOperacional,
      },
      resultado: {
        valorMotorista: valorMot,
        valorCliente,
        icmsValor,
        lucro,
        margemPercent: margemReal,
      },
      simulacao,
    });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/motoristas/diarias/calcular ────────────────────────────────────
// Calcula diárias no servidor, com base nos parâmetros do banco
freteRouter.post("/motoristas/diarias/calcular", async (req, res, next) => {
  try {
    const { motorista = "", startDate, startTime, endDate, endTime } = req.body || {};

    function buildDate(date, time) {
      if (!date || !time) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      if (!/^\d{2}:\d{2}$/.test(time))        return null;
      return new Date(`${date}T${time}:00`);
    }

    const inicio = buildDate(startDate, startTime);
    const fim    = buildDate(endDate,   endTime);

    if (!inicio || !fim || fim <= inicio) {
      return res.status(400).json({ error: "Informe um período válido (data/hora final depois da inicial)." });
    }

    // Busca parâmetros ativos do banco
    const { rows: params } = await pool.query(`
      SELECT codigo, descricao, horario_referencia, horas_rodadas_referencia, valor
      FROM ${tableName("parametro_diaria_motorista")}
      WHERE ativo = true
      ORDER BY ordem, id
    `);

    function setTimeOnDate(baseDate, timeStr) {
      const [h, m] = String(timeStr).split(":").map(Number);
      const d = new Date(baseDate);
      d.setHours(h, m, 0, 0);
      return d;
    }

    function eachDateBetween(start, end) {
      const dates = [];
      const cursor = new Date(start);
      cursor.setHours(0, 0, 0, 0);
      const last = new Date(end);
      last.setHours(0, 0, 0, 0);
      while (cursor <= last) {
        dates.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
      return dates;
    }

    const items = [];
    for (const param of params) {
      const triggerTime  = param.horario_referencia ? String(param.horario_referencia).slice(0, 5) : null;
      const triggerHours = param.horas_rodadas_referencia !== null ? Number(param.horas_rodadas_referencia) : null;
      const valor        = Number(param.valor);

      for (const date of eachDateBetween(inicio, fim)) {
        const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
        const dayEnd   = new Date(date); dayEnd.setHours(23, 59, 59, 999);
        const segStart = inicio > dayStart ? inicio : dayStart;
        const segEnd   = fim    < dayEnd   ? fim    : dayEnd;
        let reason = "";

        if (triggerTime) {
          const scheduled = setTimeOnDate(date, triggerTime);
          if (scheduled >= segStart && scheduled <= segEnd) {
            reason = `${param.descricao} ${triggerTime}`;
          }
        }

        if (!reason && triggerHours) {
          const threshold = new Date(segStart);
          threshold.setTime(threshold.getTime() + triggerHours * 3600_000);
          if (threshold <= segEnd) {
            reason = `${param.descricao} por ${triggerHours}h rodadas`;
          }
        }

        if (reason) {
          items.push({
            data:   date.toISOString().slice(0, 10),
            codigo: param.codigo,
            label:  param.descricao,
            reason,
            valor,
          });
        }
      }
    }

    const total = Math.round(items.reduce((s, i) => s + i.valor, 0) * 100) / 100;

    const fmtDT = (d) => new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short", timeStyle: "short",
    }).format(d);

    const fmtMoney = (v) => new Intl.NumberFormat("pt-BR", {
      style: "currency", currency: "BRL",
    }).format(v);

    const grouped = items.reduce((acc, i) => {
      acc[i.label] = (acc[i.label] ?? 0) + 1;
      return acc;
    }, {});

    const periodText = `de ${fmtDT(inicio)} até ${fmtDT(fim)}`;
    const itemText   = Object.entries(grouped)
      .map(([lbl, cnt]) => `${cnt}x ${lbl}`)
      .join(", ");

    const observacao = [
      motorista ? `Motorista ${motorista.trim()} - ` : "",
      `Diárias ${periodText}: `,
      itemText || "sem diária no período",
      `. Valor total: ${fmtMoney(total)}.`,
    ].join("");

    res.json({ periodo: periodText, total, items, observacao });
  } catch (error) {
    next(error);
  }
});
