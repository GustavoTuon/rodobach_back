import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import {
  calculateTripMeals,
  tripControlSchema,
  tripTotals,
} from "../src/services/tripControl.js";
import {
  createTripControlRouter,
  importedTrip,
} from "../src/routes/tripControl.js";
import { requireRoutePermission } from "../src/middleware/permissions.js";

const meals = [
  { nome: "Café da manhã", horario: "07:00", valor: 15 },
  { nome: "Almoço", horario: "12:00", valor: 30 },
  { nome: "Jantar", horario: "19:00", valor: 25 },
];
const period = {
  saida: "2026-11-01",
  horaSaida: "12:00",
  chegada: "2026-11-02",
  horaChegada: "07:00",
  refeicoes: meals,
};
const trip = () =>
  tripControlSchema.parse({
    placa: "ABC1D23",
    motorista: "Motorista teste",
    refeicoes: meals,
  });
test("diárias incluem limites de saída/retorno e não contam refeições fora do período", () => {
  const result = calculateTripMeals(period);
  assert.deepEqual(
    result.items.map((i) => [i.data, i.refeicao]),
    [
      ["2026-11-01", "Almoço"],
      ["2026-11-01", "Jantar"],
      ["2026-11-02", "Café da manhã"],
    ],
  );
  assert.equal(result.total, 70);
  assert.equal(
    calculateTripMeals({
      ...period,
      chegada: period.saida,
      horaSaida: "13:00",
      horaChegada: "18:00",
    }).total,
    0,
  );
});
test("diárias rejeitam datas impossíveis, período invertido, valores negativos e refeição repetida", () => {
  for (const invalid of [
    { saida: "2026-02-30" },
    { chegada: "2026-10-30" },
    { chegada: "2028-11-02" },
    { refeicoes: meals.map((m) => ({ ...m, valor: -1 })) },
    { refeicoes: [meals[0], meals[0], meals[1]] },
  ])
    assert.throws(() => calculateTripMeals({ ...period, ...invalid }));
});
test("totais descontam custos uma vez e separam o acerto do motorista do resultado", () => {
  const v = trip();
  v.fretes = [{ valor: 1000 }];
  v.despesas = [{ valor: 100, motoristaPagou: true }];
  v.abastecimentos = [{ valor: 200, motoristaPagou: false }];
  v.diarias = [
    { valor: 70, incluir: true },
    { valor: 30, incluir: false },
  ];
  v.premios = [{ valor: 50 }];
  v.adiantamentos = [{ valor: 40 }];
  v.recebimentos = [{ valor: 100 }];
  const t = tripTotals(v);
  assert.equal(t.resultado, 580);
  assert.equal(t.saldoMotorista, 80);
});
test("fechamento exige conferência e impede KM regressivo, duplicação e diárias de período antigo", () => {
  const v = trip();
  assert.equal(
    tripControlSchema.safeParse({ ...v, status: "concluida" }).success,
    false,
  );
  assert.equal(
    tripControlSchema.safeParse({ ...v, kmSaida: 100, kmChegada: 90 }).success,
    false,
  );
  assert.equal(
    tripControlSchema.safeParse({
      ...v,
      fretes: [
        { id: "a", valor: 1, vinculo: "cte:1:A:1" },
        { id: "b", valor: 1, vinculo: "cte:1:A:1" },
      ],
    }).success,
    false,
  );
  assert.equal(
    tripControlSchema.safeParse({
      ...v,
      ...period,
      diarias: calculateTripMeals(period).items,
      diariasPeriodo: "antigo",
    }).success,
    false,
  );
  const complete = {
    ...v,
    ...period,
    kmSaida: 100,
    kmChegada: 500,
    status: "concluida",
    conferido: {
      fretes: true,
      despesas: true,
      abastecimentos: true,
      motorista: true,
      ocorrencias: true,
    },
  };
  assert.equal(tripControlSchema.safeParse(complete).success, true);
  assert.equal(
    tripControlSchema.safeParse({
      ...complete,
      ocorrencias: [
        {
          id: "a",
          data: "2026-11-01",
          tipo: "Avaria",
          descricao: "Pendente",
          resolvida: false,
        },
      ],
    }).success,
    false,
  );
});
test("importação mantém identificadores, diárias e comissão sem escrever no ERP", () => {
  const v = importedTrip(
    {
      viagem: {
        placa: "ABC1D23",
        motorista: "Teste",
        saida: "2026-11-01",
        diarias: 70,
        comissao: 100,
      },
      fretes: [
        { empresaDocumento: 1, serie: " A ", documento: 23, valor: 1000 },
      ],
      despesas: [],
      abastecimentos: [{ empresa: 1, codigo: 9, valor: 200, litros: 40 }],
    },
    1,
    887,
  );
  assert.equal(v.fretes[0].vinculo, "cte:1:A:23");
  assert.equal(v.abastecimentos[0].vinculo, "abastecimento:1:9");
  assert.equal(tripTotals(v).diarias, 70);
  assert.equal(tripTotals(v).premios, 100);
  assert.equal(v.status, "rascunho");
});
function app(db, permissions = { "lucro-viagens": true }) {
  const a = express();
  a.use(express.json());
  a.use((req, res, next) => {
    req.user = { id: 1, permissions };
    next();
  });
  a.use(requireRoutePermission);
  a.use(createTripControlRouter({ db }));
  a.use((err, req, res, _next) =>
    res.status(err.status || 500).json({ error: err.message }),
  );
  return a;
}
test("gravação usa revisão otimista e reverte transação quando outra pessoa já editou", async () => {
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      return { rowCount: 0, rows: [] };
    },
    release() {},
  };
  const res = await request(app({ connect: async () => client }))
    .put("/financeiro/controle-viagens/7")
    .send({ ...trip(), revisao: 1 });
  assert.equal(res.status, 409);
  assert.ok(calls.some((s) => s.includes("AND revisao=$4")));
  assert.ok(calls.includes("ROLLBACK"));
  assert.ok(!calls.includes("COMMIT"));
});
test("conflito de documento em outra viagem reverte criação e retorna mensagem útil", async () => {
  const calls = [];
  const v = trip();
  v.fretes = [{ id: "a", valor: 100, vinculo: "cte:1:A:23" }];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes("INSERT INTO") && sql.includes("vinculos"))
        throw Object.assign(new Error("duplicate"), { code: "23505" });
      return { rowCount: 1, rows: [{ id: "1", revisao: 1, dados: v }] };
    },
    release() {},
  };
  const res = await request(app({ connect: async () => client }))
    .post("/financeiro/controle-viagens")
    .send(v);
  assert.equal(res.status, 409);
  assert.ok(calls.includes("ROLLBACK"));
});
test("usuário sem permissão financeira não pode criar controle nem consultar dados", async () => {
  const a = app(
    {
      query: () => {
        throw new Error("Não deve consultar");
      },
    },
    {},
  );
  await request(a).get("/financeiro/controle-viagens").expect(403);
  await request(a)
    .post("/financeiro/controle-viagens")
    .send(trip())
    .expect(403);
});
const customerMeals = [
  { nome: "Café da manhã", horario: "08:00", valor: 19.27, horas: null },
  { nome: "Almoço", horario: "12:00", valor: 38.54, horas: null },
  { nome: "Jantar", horario: "21:00", valor: 28.9, horas: 11 },
];
test("parâmetros do cliente: 11 horas geram jantar, sem duplicar com horário das 21h", () => {
  const input = {
    saida: "2026-11-10",
    chegada: "2026-11-10",
    horaSaida: "07:00",
    horaChegada: "18:00",
    refeicoes: customerMeals,
  };
  const result = calculateTripMeals(input);
  assert.equal(result.total, 86.71);
  assert.equal(result.items.length, 3);
  assert.equal(result.items[2].motivo, "11 horas de viagem no dia");
  assert.equal(
    calculateTripMeals({ ...input, horaChegada: "17:59" }).total,
    57.81,
  );
  assert.equal(
    calculateTripMeals({ ...input, horaChegada: "21:00" }).items.filter(
      (i) => i.refeicao === "Jantar",
    ).length,
    1,
  );
  assert.equal(
    calculateTripMeals({ ...input, horaSaida: "20:00", horaChegada: "21:00" })
      .total,
    28.9,
  );
});
test("horas reiniciam à meia-noite, respeitam frações e não dependem do fuso do processo", () => {
  const input = {
    saida: "2026-11-10",
    chegada: "2026-11-11",
    horaSaida: "22:00",
    horaChegada: "09:00",
    refeicoes: customerMeals,
  };
  assert.equal(calculateTripMeals(input).total, 19.27);
  const fractional = {
    ...input,
    saida: "2026-11-11",
    horaSaida: "07:00",
    horaChegada: "18:30",
    refeicoes: customerMeals.map((m) =>
      m.nome === "Jantar" ? { ...m, horas: 11.5 } : m,
    ),
  };
  assert.equal(calculateTripMeals(fractional).total, 86.71);
  assert.equal(
    calculateTripMeals({ ...fractional, horaChegada: "18:29" }).total,
    57.81,
  );
  const original = process.env.TZ;
  try {
    process.env.TZ = "Pacific/Auckland";
    assert.equal(calculateTripMeals(fractional).total, 86.71);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
test("parâmetros rejeitam horas inválidas e PUT exige revisão atual", async () => {
  for (const horas of [-1, 0, 25])
    assert.throws(() =>
      calculateTripMeals({
        ...period,
        refeicoes: customerMeals.map((m) => ({ ...m, horas })),
      }),
    );
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const res = await request(app({ connect: async () => client }))
    .put("/financeiro/controle-viagens/diarias/parametros")
    .send({ refeicoes: customerMeals, revisao: 1 });
  assert.equal(res.status, 409);
  assert.ok(calls.includes("ROLLBACK"));
  assert.ok(!calls.includes("COMMIT"));
  await request(app({}, {}))
    .put("/financeiro/controle-viagens/diarias/parametros")
    .send({ refeicoes: customerMeals, revisao: 1 })
    .expect(403);
});
