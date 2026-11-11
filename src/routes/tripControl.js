import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { clientPool } from "../db/clientPool.js";
import { tableName } from "../config.js";
import { loadErpTrip } from "./consultaViagens.js";
import {
  calculateTripMeals,
  tripControlSchema,
  tripTotals,
  tripMealParametersSchema,
} from "../services/tripControl.js";

const base = "/financeiro/controle-viagens";
const table = () => tableName("controle_viagens_norte");
const links = () => tableName("controle_viagens_norte_vinculos");
const history = () => tableName("controle_viagens_norte_historico");
const keys = [
  "fretes",
  "despesas",
  "abastecimentos",
  "adiantamentos",
  "recebimentos",
  "premios",
  "diariasAvulsas",
];
const idSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const map = (r) => ({
  id: String(r.id),
  revisao: r.revisao,
  erpEmpresa: r.erp_empresa,
  erpNumero: r.erp_numero,
  atualizadoEm: r.atualizado_em,
  diariasAvulsas: [],
  ...r.dados,
  totais: tripTotals(r.dados),
});
const entry = (row, key) => ({
  id: randomUUID(),
  descricao: String(row.descricao || ""),
  data: String(row.data || "").slice(0, 10),
  valor: Number(row.valor || 0),
  documento: String(row.documento || ""),
  pessoa: String(row.pessoa || ""),
  litros: Number(row.litros || 0),
  km: row.km == null ? null : Number(row.km),
  motoristaPagou: false,
  origem: key.startsWith("despesa:") ? "despesa" : "erp",
  vinculo: key,
});
export function importedTrip(data, company, number) {
  const v = data.viagem;
  return tripControlSchema.parse({
    placa: String(v.placa || "")
      .replace(/[^a-z0-9]/gi, "")
      .toUpperCase(),
    motorista: v.motorista || "",
    reboque: v.reboque || "",
    saida: String(v.saida || "").slice(0, 10),
    horaSaida: String(v.horaSaida || "").slice(0, 5),
    chegada: String(v.chegada || "").slice(0, 10),
    horaChegada: String(v.horaChegada || "").slice(0, 5),
    kmSaida: v.kmSaida == null ? null : Number(v.kmSaida),
    kmChegada: v.kmChegada == null ? null : Number(v.kmChegada),
    observacao: v.observacaoPrincipal || v.observacao || "",
    fretes: data.fretes.map((f) =>
      entry(
        {
          data: f.data,
          valor: f.valor,
          documento: f.documento,
          pessoa: f.cliente,
          descricao: [f.origem, f.destino].filter(Boolean).join(" → "),
        },
        f.documento && f.empresaDocumento && f.serie
          ? `cte:${f.empresaDocumento}:${String(f.serie).trim()}:${f.documento}`
          : `frete:${company}:${number}:${f.sequencia}`,
      ),
    ),
    despesas: data.despesas.map((d) =>
      entry(
        {
          data: d.data,
          valor: d.valor,
          documento: d.documento,
          pessoa: d.fornecedor,
          descricao: d.observacao || String(d.tipo || "Despesa"),
        },
        `erpdespesa:${company}:${number}:${d.sequencia}`,
      ),
    ),
    abastecimentos: data.abastecimentos.map((a) =>
      entry(
        { ...a, descricao: "Abastecimento" },
        `abastecimento:${a.empresa}:${a.codigo}`,
      ),
    ),
    adiantamentos: (data.adiantamentos || []).map((r) =>
      entry(r, `adiantamento:${company}:${number}:${r.sequencia}`),
    ),
    recebimentos: (data.recebimentos || []).map((r) =>
      entry(r, `recebimento:${company}:${number}:${r.sequencia}`),
    ),
    diariasAvulsas:
      Number(v.diarias) > 0
        ? [
            entry(
              {
                valor: v.diarias,
                descricao: "Diárias registradas no ERP",
                data: String(v.acerto || v.saida || "").slice(0, 10),
              },
              `diarias:${company}:${number}`,
            ),
          ]
        : [],
    premios:
      Number(v.comissao) > 0
        ? [
            entry(
              {
                valor: v.comissao,
                descricao: "Comissão do motorista no ERP",
                data: String(v.acerto || v.saida || "").slice(0, 10),
              },
              `comissao:${company}:${number}`,
            ),
          ]
        : [],
    refeicoes: [
      { nome: "Café da manhã", horario: "07:00", valor: 0 },
      { nome: "Almoço", horario: "12:00", valor: 0 },
      { nome: "Jantar", horario: "19:00", valor: 0 },
    ],
  });
}
async function saveTrip({ db, id, revision, data, user, erp }) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    let row;
    if (id) {
      const result = await client.query(
        `UPDATE ${table()} SET dados=$1,revisao=revisao+1,atualizado_por=$2,atualizado_em=NOW() WHERE id=$3 AND revisao=$4 RETURNING *`,
        [data, user, id, revision],
      );
      if (!result.rowCount)
        throw Object.assign(
          new Error(
            "Esta viagem foi alterada por outra pessoa. Reabra a viagem antes de salvar.",
          ),
          { status: 409 },
        );
      row = result.rows[0];
    } else {
      const result = await client.query(
        `INSERT INTO ${table()}(dados,criado_por,atualizado_por,erp_empresa,erp_numero) VALUES($1,$2,$2,$3,$4) RETURNING *`,
        [data, user, erp?.empresa || null, erp?.numero || null],
      );
      row = result.rows[0];
    }
    await client.query(`DELETE FROM ${links()} WHERE viagem_id=$1`, [row.id]);
    for (const key of keys)
      for (const item of data[key].filter((i) => i.vinculo))
        await client.query(
          `INSERT INTO ${links()}(vinculo,viagem_id,tipo) VALUES($1,$2,$3)`,
          [item.vinculo, row.id, key],
        );
    await client.query(
      `INSERT INTO ${history()}(viagem_id,revisao,dados,usuario_id) VALUES($1,$2,$3,$4)`,
      [row.id, row.revisao, data, user],
    );
    await client.query("COMMIT");
    return map(row);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505")
      throw Object.assign(
        new Error(
          "Esta viagem ou um dos documentos já está vinculado a outro controle. Confira os vínculos.",
        ),
        { status: 409 },
      );
    throw error;
  } finally {
    client.release();
  }
}
export function createTripControlRouter({
  db = pool,
  erpDb = clientPool,
  loadTrip = loadErpTrip,
} = {}) {
  const router = Router();
  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof z.ZodError)
        return res
          .status(400)
          .json({ error: e.issues.map((i) => i.message).join(" ") });
      next(e);
    }
  };
  router.get(
    base,
    handle(async (req, res) => {
      const q = z
        .object({
          search: z.string().max(120).default(""),
          status: z
            .enum(["", "rascunho", "em_viagem", "conferencia", "concluida"])
            .default(""),
          page: z.coerce.number().int().min(1).max(10000).default(1),
        })
        .parse(req.query);
      const where = `WHERE ($1='' OR concat_ws(' ',id::text,dados->>'placa',dados->>'motorista',erp_numero::text) ILIKE '%'||$1||'%') AND ($2='' OR dados->>'status'=$2)`;
      const [rows, count] = await Promise.all([
        db.query(
          `SELECT * FROM ${table()} ${where} ORDER BY atualizado_em DESC,id DESC LIMIT 30 OFFSET $3`,
          [q.search, q.status, (q.page - 1) * 30],
        ),
        db.query(`SELECT count(*)::int AS total FROM ${table()} ${where}`, [
          q.search,
          q.status,
        ]),
      ]);
      res.json({
        itens: rows.rows.map(map),
        total: count.rows[0].total,
        page: q.page,
      });
    }),
  );
  router.post(
    `${base}/diarias/calcular`,
    handle(async (req, res) => res.json(calculateTripMeals(req.body))),
  );
  router.get(
    `${base}/diarias/parametros`,
    handle(async (_req, res) => {
      const { rows } = await db.query(
        `SELECT refeicoes,revisao FROM ${tableName("controle_viagens_diarias_parametros")} WHERE id=1`,
      );
      if (!rows[0])
        return res
          .status(503)
          .json({
            error:
              "Parâmetros de diárias não configurados. Aplique a migração de diárias.",
          });
      res.json({
        ...rows[0],
        refeicoes: tripMealParametersSchema.parse(rows[0].refeicoes),
      });
    }),
  );
  router.put(
    `${base}/diarias/parametros`,
    handle(async (req, res) => {
      const values = z
        .object({ refeicoes: tripMealParametersSchema, revisao: idSchema })
        .parse(req.body);
      const c = await db.connect();
      try {
        await c.query("BEGIN");
        const { rows } = await c.query(
          `UPDATE ${tableName("controle_viagens_diarias_parametros")} SET refeicoes=$1,revisao=revisao+1,atualizado_por=$2,atualizado_em=NOW() WHERE id=1 AND revisao=$3 RETURNING refeicoes,revisao`,
          [JSON.stringify(values.refeicoes), req.user.id, values.revisao],
        );
        if (!rows[0])
          throw Object.assign(
            new Error(
              "Os parâmetros foram alterados por outra pessoa. Feche e abra novamente para atualizar.",
            ),
            { status: 409 },
          );
        await c.query(
          `INSERT INTO ${tableName("controle_viagens_diarias_historico")}(revisao,refeicoes,usuario_id) VALUES($1,$2,$3)`,
          [rows[0].revisao, JSON.stringify(rows[0].refeicoes), req.user.id],
        );
        await c.query("COMMIT");
        res.json(rows[0]);
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    }),
  );
  router.post(
    `${base}/importar`,
    handle(async (req, res) => {
      const erp = z
        .object({ empresa: idSchema, numero: idSchema })
        .parse(req.body);
      const existing = await db.query(
        `SELECT * FROM ${table()} WHERE erp_empresa=$1 AND erp_numero=$2`,
        [erp.empresa, erp.numero],
      );
      if (existing.rowCount) return res.json(map(existing.rows[0]));
      const source = await loadTrip(erp.empresa, erp.numero);
      const [advances, receipts] = await Promise.all([
        erpDb.query(
          `SELECT sequenciacvt AS sequencia, datacvt::text AS data, valorcvt AS valor, COALESCE(observacaocvt,'Adiantamento no ERP') AS descricao FROM logistica.controleviagensadiantamentos WHERE empresacvt=$1 AND codigocvt=$2 ORDER BY sequenciacvt`,
          [erp.empresa, erp.numero],
        ),
        erpDb.query(
          `SELECT sequenciacvr AS sequencia, datacvr::text AS data, valorcvr AS valor, COALESCE(observacaocvr,'Recebimento no ERP') AS descricao, duplicatacvr::text AS documento FROM logistica.controleviagensrecebimentos WHERE empresacvr=$1 AND codigocvr=$2 ORDER BY sequenciacvr`,
          [erp.empresa, erp.numero],
        ),
      ]);
      source.adiantamentos = advances.rows;
      source.recebimentos = receipts.rows;
      const parameters = await db.query(
        `SELECT refeicoes FROM ${tableName("controle_viagens_diarias_parametros")} WHERE id=1`,
      );
      if (!parameters.rows[0])
        throw Object.assign(
          new Error("Configure os parâmetros de diárias antes de importar."),
          { status: 503 },
        );
      const imported = importedTrip(source, erp.empresa, erp.numero);
      imported.refeicoes = tripMealParametersSchema.parse(
        parameters.rows[0].refeicoes,
      );
      res.status(201).json(
        await saveTrip({
          db,
          user: req.user.id,
          data: imported,
          erp,
        }),
      );
    }),
  );
  router.get(
    `${base}/documentos`,
    handle(async (req, res) => {
      const q = z
        .object({
          tipo: z.enum(["fretes", "despesas", "abastecimentos"]),
          placa: z.string().regex(/^[A-Z0-9]{7}$/),
          inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
        .parse(req.query);
      if (
        q.fim < q.inicio ||
        Date.parse(q.fim) - Date.parse(q.inicio) > 366 * 86400000
      )
        throw Object.assign(new Error("Informe um período de até 366 dias."), {
          status: 400,
        });
      let result;
      if (q.tipo === "fretes")
        result = await erpDb.query(
          `SELECT concat('cte:',c.empresacon,':',trim(c.seriecon),':',c.codigocon) AS vinculo,c.dataemissaocon::text AS data,COALESCE(NULLIF(c.totalcon,0),c.valorfretecon,0) AS valor,COALESCE(c.numeroctecon,c.codigocon)::text AS documento,COALESCE(cli.nomecli,'') AS pessoa,'CT-e / frete' AS descricao FROM logistica.conhecimentos c LEFT JOIN LATERAL (SELECT nomecli FROM gerais.clientes WHERE codigocli=c.clientecon ORDER BY (empresacli=c.empresacon) DESC,empresacli LIMIT 1) cli ON true WHERE c.statuscon=2 AND regexp_replace(upper(c.veiculocon),'[^A-Z0-9]','','g')=$1 AND c.dataemissaocon BETWEEN $2::date AND $3::date ORDER BY c.dataemissaocon DESC,c.empresacon,c.seriecon,c.codigocon LIMIT 101`,
          [q.placa, q.inicio, q.fim],
        );
      else if (q.tipo === "abastecimentos")
        result = await erpDb.query(
          `SELECT concat('abastecimento:',empresaaba,':',codigoaba) AS vinculo,dataaba::text AS data,totalaba AS valor,litrosaba AS litros,kilometragematualaba AS km,documentoaba::text AS documento,'Abastecimento' AS descricao FROM frotas.abastecimentos WHERE regexp_replace(upper(veiculoaba),'[^A-Z0-9]','','g')=$1 AND dataaba BETWEEN $2::date AND $3::date ORDER BY dataaba DESC,empresaaba,codigoaba LIMIT 101`,
          [q.placa, q.inicio, q.fim],
        );
      else
        result = await db.query(
          `SELECT concat('despesa:',id) AS vinculo,data_despesa::text AS data,valor,documento,fornecedor AS pessoa,servico AS descricao FROM ${tableName("manutencao_plantao")} WHERE excluido_em IS NULL AND placa=$1 AND data_despesa BETWEEN $2::date AND $3::date ORDER BY data_despesa DESC,id LIMIT 101`,
          [q.placa, q.inicio, q.fim],
        );
      const entries = result.rows.slice(0, 100).map((r) => entry(r, r.vinculo));
      const bound = await db.query(
        `SELECT vinculo,viagem_id FROM ${links()} WHERE vinculo=ANY($1::text[])`,
        [entries.map((i) => i.vinculo)],
      );
      res.json({
        itens: entries.map((i) => ({
          ...i,
          viagemVinculada:
            bound.rows.find((b) => b.vinculo === i.vinculo)?.viagem_id || null,
        })),
        temMais: result.rows.length > 100,
      });
    }),
  );
  router.get(
    `${base}/:id`,
    handle(async (req, res) => {
      const id = idSchema.parse(req.params.id);
      const result = await db.query(`SELECT * FROM ${table()} WHERE id=$1`, [
        id,
      ]);
      if (!result.rowCount)
        return res.status(404).json({ error: "Controle não encontrado." });
      res.json(map(result.rows[0]));
    }),
  );
  router.post(
    base,
    handle(async (req, res) =>
      res.status(201).json(
        await saveTrip({
          db,
          user: req.user.id,
          data: tripControlSchema.parse(req.body),
        }),
      ),
    ),
  );
  router.put(
    `${base}/:id`,
    handle(async (req, res) =>
      res.json(
        await saveTrip({
          db,
          user: req.user.id,
          id: idSchema.parse(req.params.id),
          revision: idSchema.parse(req.body.revisao),
          data: tripControlSchema.parse(req.body),
        }),
      ),
    ),
  );
  return router;
}
export const tripControlRouter = createTripControlRouter();
