import { z } from "zod";

const text = (max = 160) => z.string().trim().max(max).default("");
const amount = z.number().finite().min(0).max(1e9);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  );
const optionalDate = z.union([date, z.literal("")]).default("");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const optionalTime = z.union([time, z.literal("")]).default("");
const entry = z.object({
  id: z.string().min(1).max(120),
  descricao: text(500),
  data: optionalDate,
  valor: amount,
  documento: text(120),
  pessoa: text(),
  litros: amount.default(0),
  km: amount.nullable().default(null),
  motoristaPagou: z.boolean().default(false),
  origem: z.enum(["manual", "erp", "despesa"]).default("manual"),
  vinculo: text(180),
});
const meal = z.object({
  nome: z.enum(["Café da manhã", "Almoço", "Jantar"]),
  horario: time,
  valor: amount.max(10000),
  horas: z.number().finite().gt(0).max(24).nullable().default(null),
});
export const tripMealParametersSchema = z
  .array(meal)
  .length(3)
  .refine(
    (values) => new Set(values.map((m) => m.nome)).size === 3,
    "Informe café, almoço e jantar sem repetir refeições.",
  );
export const mealCalculationSchema = z
  .object({
    saida: date,
    horaSaida: time,
    chegada: date,
    horaChegada: time,
    refeicoes: tripMealParametersSchema,
  })
  .superRefine((v, ctx) => {
    const start = Date.parse(`${v.saida}T${v.horaSaida}:00-03:00`);
    const end = Date.parse(`${v.chegada}T${v.horaChegada}:00-03:00`);
    if (end < start || end - start > 366 * 86400000)
      ctx.addIssue({
        code: "custom",
        message:
          "Informe um período de até 366 dias, com retorno após a saída.",
      });
  });
export function calculateTripMeals(input) {
  const v = mealCalculationSchema.parse(input);
  const start = `${v.saida}T${v.horaSaida}`,
    end = `${v.chegada}T${v.horaChegada}`;
  const items = [];
  for (
    let day = Date.parse(`${v.saida}T12:00:00Z`);
    day <= Date.parse(`${v.chegada}T12:00:00Z`);
    day += 86400000
  ) {
    const data = new Date(day).toISOString().slice(0, 10);
    for (const m of v.refeicoes) {
      const when = `${data}T${m.horario}`;
      const segmentStart = Math.max(
        Date.parse(`${start}:00-03:00`),
        Date.parse(`${data}T00:00:00-03:00`),
      );
      const segmentEnd = Math.min(
        Date.parse(`${end}:00-03:00`),
        Date.parse(`${data}T00:00:00-03:00`) + 86400000 - 1,
      );
      const byTime = when >= start && when <= end;
      const byHours =
        m.horas !== null && segmentEnd - segmentStart >= m.horas * 3600000;
      if (byTime || byHours)
        items.push({
          data,
          refeicao: m.nome,
          horario: m.horario,
          valor: m.valor,
          incluir: true,
          motivo: byTime
            ? `Horário de referência: ${m.horario}`
            : `${m.horas} horas de viagem no dia`,
        });
    }
  }
  return {
    items,
    total: Math.round(items.reduce((sum, i) => sum + i.valor, 0) * 100) / 100,
  };
}
export const tripControlSchema = z
  .object({
    placa: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{7}$/, "Informe uma placa válida."),
    motorista: z.string().trim().min(1, "Informe o motorista.").max(160),
    reboque: text(10),
    origem: text(),
    destino: text(),
    saida: optionalDate,
    horaSaida: optionalTime,
    chegada: optionalDate,
    horaChegada: optionalTime,
    kmSaida: amount.nullable().default(null),
    kmChegada: amount.nullable().default(null),
    kmVazio: amount.default(0),
    observacao: text(5000),
    status: z
      .enum(["rascunho", "em_viagem", "conferencia", "concluida"])
      .default("rascunho"),
    fretes: z.array(entry).max(500).default([]),
    despesas: z.array(entry).max(500).default([]),
    abastecimentos: z.array(entry).max(500).default([]),
    adiantamentos: z.array(entry).max(500).default([]),
    recebimentos: z.array(entry).max(500).default([]),
    premios: z.array(entry).max(500).default([]),
    diariasAvulsas: z.array(entry).max(500).default([]),
    refeicoes: tripMealParametersSchema,
    diarias: z
      .array(
        z.object({
          data: date,
          refeicao: z.enum(["Café da manhã", "Almoço", "Jantar"]),
          horario: time,
          valor: amount,
          incluir: z.boolean(),
          motivo: text(120),
        }),
      )
      .max(1101)
      .default([]),
    diariasPeriodo: text(100),
    ocorrencias: z
      .array(
        z.object({
          id: z.string().min(1).max(120),
          data: date,
          tipo: z.enum(["Avaria", "Acidente", "Atraso", "Outro"]),
          descricao: z.string().trim().min(1).max(3000),
          resolvida: z.boolean().default(false),
        }),
      )
      .max(500)
      .default([]),
    conferido: z
      .object({
        fretes: z.boolean(),
        despesas: z.boolean(),
        abastecimentos: z.boolean(),
        motorista: z.boolean(),
        ocorrencias: z.boolean(),
      })
      .default({
        fretes: false,
        despesas: false,
        abastecimentos: false,
        motorista: false,
        ocorrencias: false,
      }),
  })
  .superRefine((v, ctx) => {
    const issue = (message) => ctx.addIssue({ code: "custom", message });
    if (
      v.chegada &&
      (!v.saida ||
        `${v.chegada}T${v.horaChegada || "23:59"}` <
          `${v.saida}T${v.horaSaida || "00:00"}`)
    )
      issue("O retorno deve ser posterior à saída.");
    if (v.kmSaida !== null && v.kmChegada !== null && v.kmChegada < v.kmSaida)
      issue("O KM de retorno não pode ser menor que o KM de saída.");
    for (const key of [
      "fretes",
      "despesas",
      "abastecimentos",
      "adiantamentos",
      "recebimentos",
      "premios",
      "diariasAvulsas",
    ]) {
      if (new Set(v[key].map((i) => i.id)).size !== v[key].length)
        issue("Há lançamentos duplicados.");
      const links = v[key].filter((i) => i.vinculo).map((i) => i.vinculo);
      if (new Set(links).size !== links.length)
        issue("O mesmo documento foi vinculado mais de uma vez.");
    }
    if (
      new Set(v.diarias.map((i) => `${i.data}:${i.refeicao}`)).size !==
      v.diarias.length
    )
      issue("Há refeições duplicadas no mesmo dia.");
    if (
      v.diarias.length &&
      v.diariasPeriodo !==
        `${v.saida}T${v.horaSaida}/${v.chegada}T${v.horaChegada}`
    )
      issue("O período mudou. Recalcule e confira as diárias.");
    if (
      v.status === "concluida" &&
      (!v.saida ||
        !v.horaSaida ||
        !v.chegada ||
        !v.horaChegada ||
        v.kmSaida === null ||
        v.kmChegada === null ||
        !Object.values(v.conferido).every(Boolean) ||
        v.ocorrencias.some((i) => !i.resolvida))
    )
      issue(
        "Para concluir, informe saída, retorno e quilometragens, confira todas as etapas e resolva as ocorrências.",
      );
  });

export function tripTotals(v) {
  const sum = (rows) =>
    Math.round(rows.reduce((s, r) => s + r.valor, 0) * 100) / 100;
  const diarias =
    sum(v.diarias.filter((i) => i.incluir)) + sum(v.diariasAvulsas || []);
  const receita = sum(v.fretes),
    despesas = sum(v.despesas),
    abastecimentos = sum(v.abastecimentos),
    premios = sum(v.premios);
  const reembolsos = sum(
    [...v.despesas, ...v.abastecimentos].filter((i) => i.motoristaPagou),
  );
  const adiantamentos = sum(v.adiantamentos),
    recebimentos = sum(v.recebimentos);
  return {
    receita,
    despesas,
    abastecimentos,
    diarias,
    premios,
    adiantamentos,
    recebimentos,
    reembolsos,
    resultado:
      Math.round(
        (receita - despesas - abastecimentos - diarias - premios) * 100,
      ) / 100,
    saldoMotorista:
      Math.round(
        (diarias + premios + reembolsos - adiantamentos - recebimentos) * 100,
      ) / 100,
  };
}
