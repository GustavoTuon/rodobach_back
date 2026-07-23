import { getAnaliseClientes } from "./analiseClientesService.js";
import { getCustosVeiculos } from "./custosVeiculosService.js";
import { getLucroViagens } from "./lucroViagensService.js";

const DEFAULT_PHONE = "554899503759";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function r2(value) {
  return Math.round((num(value) + Number.EPSILON) * 100) / 100;
}

function brl(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(num(value));
}

function pct(value) {
  return `${r2(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function dateBR(value) {
  const iso = dateOnly(value);
  if (!iso) return "-";
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function todayIso() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function daysBeforeIso(baseIso, days) {
  const d = new Date(`${dateOnly(baseIso) || todayIso()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function normalizePhone(value) {
  return String(value || "").replace(/[^0-9]/g, "") || DEFAULT_PHONE;
}

function buildMensagemViagem(row, margemMinima) {
  return [
    "🚨 MARGEM BAIXA",
    "",
    `🚛 Viagem: #${row.viagem || row.id}`,
    `🚚 Placa: ${row.placa || "-"}`,
    row.cliente ? `👤 Cliente: ${row.cliente}` : null,
    row.origem || row.destino ? `📍 Rota: ${row.origem || "-"} -> ${row.destino || "-"}` : null,
    "",
    `💰 Receita: ${brl(row.receita)}`,
    `💸 Custo: ${brl(row.custo)}`,
    `📉 Lucro: ${brl(row.lucro)}`,
    `📊 Margem: ${pct(row.margem)}`,
    "",
    `⚠️ Mínimo: ${pct(margemMinima)}`,
    "",
    "👉 Revisar custos e valores antes do fechamento.",
  ].filter(Boolean).join("\n");
}

function buildMensagemCliente(row, minimoFaturamento) {
  return [
    "🚨 CLIENTE SEM FATURAR",
    "",
    `👤 ${row.nome || "-"}`,
    `🆔 ${row.codigo || "-"}`,
    "",
    `📅 Última venda: ${dateBR(row.ultimoFaturamento)}`,
    `⏳ ${num(row.diasSemFaturar)} dias sem faturar`,
    "",
    "💰 Último faturamento:",
    brl(row.totalAnterior || row.totalAnoAnterior || row.totalPeriodo),
    "",
    `⚠️ Mínimo para alerta: ${brl(minimoFaturamento)}`,
    "",
    "👉 Acionar comercial.",
  ].join("\n");
}

function buildMensagemVeiculo(row, diasSemViagem) {
  return [
    "🚨 VEÍCULO PARADO",
    "",
    `🚚 ${row.placa || "-"}`,
    row.veiculoNome ? `🧾 ${row.veiculoNome}` : null,
    "",
    `💸 Custos: ${brl(row.custo)}`,
    `📈 Receita: ${brl(row.receita)}`,
    "📅 Última receita:",
    dateBR(row.ultimaReceita),
    "",
    `⚠️ Sem faturar há mais de ${diasSemViagem} dias.`,
    "",
    "👉 Verificar veículo e lançamentos.",
  ].filter(Boolean).join("\n");
}

function parseBool(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "sim", "yes", "s"].includes(String(value).toLowerCase());
}

export async function getAlertasOperacionaisMensagem(options = {}) {
  const numero = normalizePhone(options.numero || options.phone || DEFAULT_PHONE);
  const endDate = options.endDate || options.dataFim || todayIso();
  const startDate = options.startDate || options.dataInicio || daysAgoIso(Number(options.diasPeriodo) || 29);
  const margemMinima = Number(options.margemMinima ?? options.margem ?? 10);
  const clienteDiasSemFaturar = Number(options.clienteDiasSemFaturar ?? 30);
  const clienteMinimoFaturamento = Number(options.clienteMinimoFaturamento ?? 50000);
  const veiculoDiasSemViagem = Number(options.veiculoDiasSemViagem ?? 7);
  const veiculoMinimoCusto = Number(options.veiculoMinimoCusto ?? 1000);
  const veiculoReceitaCutoff = daysBeforeIso(endDate, veiculoDiasSemViagem);
  const limit = Math.min(Math.max(Number(options.limit) || 5, 1), 20);

  const checks = {
    viagemMargemBaixa: parseBool(options.viagemMargemBaixa, true),
    clienteSemFaturar: parseBool(options.clienteSemFaturar, true),
    veiculoParadoComCusto: parseBool(options.veiculoParadoComCusto, true),
  };

  const alertas = [];

  if (checks.viagemMargemBaixa) {
    const viagens = await getLucroViagens({ startDate, endDate });
    const rows = (viagens.viagens || [])
      .filter((row) => num(row.receita) > 0 && num(row.margem) < margemMinima)
      .sort((a, b) => num(a.margem) - num(b.margem) || num(b.receita) - num(a.receita))
      .slice(0, limit);

    for (const row of rows) {
      alertas.push({
        tipo: "viagem_margem_baixa",
        destino: numero,
        severidade: num(row.lucro) < 0 ? "critico" : "atencao",
        chave: `viagem:${row.id}`,
        data: row.dataFaturamento || row.data,
        titulo: `Viagem com margem ${pct(row.margem)}`,
        mensagem: buildMensagemViagem(row, margemMinima),
        dados: row,
      });
    }
  }

  if (checks.clienteSemFaturar) {
    const clientes = await getAnaliseClientes({
      period: "12m",
      status: "sem-faturamento",
      inativoMin: clienteDiasSemFaturar,
    });
    const rows = (clientes.clients || [])
      .filter((row) => num(row.diasSemFaturar) >= clienteDiasSemFaturar)
      .filter((row) => Math.max(num(row.totalAnterior), num(row.totalAnoAnterior), num(row.totalPeriodo)) >= clienteMinimoFaturamento)
      .sort((a, b) => Math.max(num(b.totalAnterior), num(b.totalAnoAnterior)) - Math.max(num(a.totalAnterior), num(a.totalAnoAnterior)))
      .slice(0, limit);

    for (const row of rows) {
      alertas.push({
        tipo: "cliente_importante_sem_faturar",
        destino: numero,
        severidade: num(row.diasSemFaturar) >= 60 ? "critico" : "atencao",
        chave: `cliente:${row.codigo}`,
        data: row.ultimoFaturamento,
        titulo: `${row.nome} sem faturar ha ${num(row.diasSemFaturar)} dias`,
        mensagem: buildMensagemCliente(row, clienteMinimoFaturamento),
        dados: row,
      });
    }
  }

  if (checks.veiculoParadoComCusto) {
    const custos = await getCustosVeiculos({
      startDate,
      endDate,
      proprietario: "frota",
      limit: 800,
    });
    const rows = (custos.profit?.vehicles || [])
      .filter((row) => row.placa && row.placa !== "Nao identificado")
      .filter((row) => num(row.custo) >= veiculoMinimoCusto)
      .filter((row) => num(row.receita) <= 0 || !row.ultimaReceita || dateOnly(row.ultimaReceita) < veiculoReceitaCutoff)
      .sort((a, b) => num(b.custo) - num(a.custo))
      .slice(0, limit);

    for (const row of rows) {
      alertas.push({
        tipo: "veiculo_parado_com_custo",
        destino: numero,
        severidade: num(row.receita) <= 0 ? "critico" : "atencao",
        chave: `veiculo:${row.placa}`,
        data: row.ultimaReceita,
        titulo: `${row.placa} com ${brl(row.custo)} de custo e pouca/nenhuma receita`,
        mensagem: buildMensagemVeiculo(row, veiculoDiasSemViagem),
        dados: row,
      });
    }
  }

  return {
    numero,
    periodo: { startDate, endDate },
    parametros: {
      margemMinima,
      clienteDiasSemFaturar,
      clienteMinimoFaturamento,
      veiculoDiasSemViagem,
      veiculoMinimoCusto,
      limit,
      checks,
    },
    resumo: {
      total: alertas.length,
      viagemMargemBaixa: alertas.filter((a) => a.tipo === "viagem_margem_baixa").length,
      clienteSemFaturar: alertas.filter((a) => a.tipo === "cliente_importante_sem_faturar").length,
      veiculoParadoComCusto: alertas.filter((a) => a.tipo === "veiculo_parado_com_custo").length,
    },
    alertas,
  };
}
