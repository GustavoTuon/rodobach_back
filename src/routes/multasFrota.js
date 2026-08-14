import { Router } from "express";
import { pool } from "../db/pool.js";
import { clientPool } from "../db/clientPool.js";
import { tableName } from "../config.js";

export const multasFrotaRouter = Router();

const CONTROL = () => tableName("controle_multas_frota");
const AUDIT = () => tableName("controle_multas_frota_auditoria");
const INDICATION = new Set(["nao_aplicavel", "pendente", "indicada", "confirmada", "prazo_perdido"]);
const INTERNAL = new Set(["acompanhar", "em_defesa", "deferida", "indeferida", "encerrada"]);
const dateText = value => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = String(value);
  const iso = text.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (iso) return iso;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};
const money = value => Number(value || 0);

function mapFine(row, control = {}) {
  const paid = Boolean(row.datapagamentomtr || row.pagamtr || row.pagafinanceiromtr);
  const due = dateText(row.datavencimentoboletomtr);
  const overdue = !paid && due && due < new Date().toISOString().slice(0, 10);
  return {
    id: `${row.empresamtr}:${row.codigomtr}`,
    empresa: Number(row.empresamtr), codigo: Number(row.codigomtr), auto: row.numeroautomtr || "",
    infracao: row.infracaomtr || "Multa de trânsito", placa: row.veiculomtr || "",
    motoristaCodigo: row.motoristamtr, motorista: row.motorista_nome || "",
    local: row.localinfracaomtr || "", cidade: row.cidade_nome || "",
    dataInfracao: dateText(row.datainfracaomtr), horaInfracao: row.horainfracaomtr || "",
    limiteDefesaPrevia: dateText(row.datalimitedefesapreviamtr), limiteDefesa: dateText(row.datalimitedefesamtr),
    vencimento: due, dataPagamento: dateText(row.datapagamentomtr), gravidade: row.gravidademtr,
    valor: money(row.valormtr), desconto: money(row.valordescontomtr), juros: money(row.valorjurosmtr),
    valorFinal: money(row.valormtr) - money(row.valordescontomtr) + money(row.valorjurosmtr),
    paga: paid, vencida: Boolean(overdue), descontarMotorista: row.descontarmultamotoristamtr || "",
    observacaoErp: row.observacaomtr || "", statusErp: row.statusmtr, ultimoStatusErp: row.ultimostatusmtr,
    controle: {
      statusIndicacao: control.status_indicacao || "nao_aplicavel", indicadoEm: dateText(control.indicado_em),
      responsavel: control.responsavel || "", statusInterno: control.status_interno || "acompanhar",
      comprovanteUrl: control.comprovante_url || "", observacoes: control.observacoes || "",
      atualizadoPor: control.atualizado_por_login || "", atualizadoEm: control.atualizado_em || null,
    },
  };
}

multasFrotaRouter.get("/frota/multas", async (req, res, next) => {
  try {
    const { rows } = await clientPool.query(`
      SELECT m.*, mot.nomemot AS motorista_nome, cid.nomecid AS cidade_nome
      FROM frotas.multastransito m
      LEFT JOIN frotas.motoristas mot ON mot.codigomot=m.motoristamtr AND mot.empresamot=m.empresamtr
      LEFT JOIN localidades.cidades cid ON cid.codigocid=m.cidadeinfracaomtr
      ORDER BY COALESCE(m.datainfracaomtr,m.dataentradamtr,m.dataemissaomtr) DESC, m.codigomtr DESC
    `);
    const controls = await pool.query(`SELECT * FROM ${CONTROL()}`);
    const byKey = new Map(controls.rows.map(c => [`${c.empresa}:${c.codigo_multa}`, c]));
    let items = rows.map(row => mapFine(row, byKey.get(`${row.empresamtr}:${row.codigomtr}`)));
    const q = String(req.query.q || "").trim().toLowerCase();
    const status = String(req.query.status || "todos");
    const indication = String(req.query.indicacao || "todos");
    if (q) items = items.filter(i => [i.auto,i.infracao,i.placa,i.motorista,i.cidade].join(" ").toLowerCase().includes(q));
    if (status === "aberta") items = items.filter(i => !i.paga);
    if (status === "paga") items = items.filter(i => i.paga);
    if (status === "vencida") items = items.filter(i => i.vencida);
    if (indication !== "todos") items = items.filter(i => i.controle.statusIndicacao === indication);
    const all = rows.map(row => mapFine(row, byKey.get(`${row.empresamtr}:${row.codigomtr}`)));
    res.json({
      resumo: { total: all.length, abertas: all.filter(i=>!i.paga).length, pagas: all.filter(i=>i.paga).length,
        vencidas: all.filter(i=>i.vencida).length, indicacaoPendente: all.filter(i=>i.controle.statusIndicacao==="pendente").length,
        valorAberto: all.filter(i=>!i.paga).reduce((s,i)=>s+i.valorFinal,0) },
      multas: items.slice(0, Math.min(Number(req.query.limit)||1000, 2000)), fonte: "frotas.multastransito (somente leitura)"
    });
  } catch (error) { next(error); }
});

multasFrotaRouter.put("/frota/multas/:empresa/:codigo/controle", async (req, res, next) => {
  const empresa = Number(req.params.empresa); const codigo = Number(req.params.codigo);
  const statusIndicacao = String(req.body.statusIndicacao || "nao_aplicavel");
  const statusInterno = String(req.body.statusInterno || "acompanhar");
  if (!INDICATION.has(statusIndicacao) || !INTERNAL.has(statusInterno)) return res.status(400).json({ error: "Status inválido." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query(`SELECT * FROM ${CONTROL()} WHERE empresa=$1 AND codigo_multa=$2 FOR UPDATE`, [empresa,codigo]);
    const values = [empresa,codigo,statusIndicacao,req.body.indicadoEm||null,String(req.body.responsavel||"").trim()||null,statusInterno,String(req.body.comprovanteUrl||"").trim()||null,String(req.body.observacoes||"").trim()||null,req.user?.id||null,req.user?.login||null];
    const { rows } = await client.query(`INSERT INTO ${CONTROL()} (empresa,codigo_multa,status_indicacao,indicado_em,responsavel,status_interno,comprovante_url,observacoes,atualizado_por_id,atualizado_por_login)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(empresa,codigo_multa) DO UPDATE SET status_indicacao=$3,indicado_em=$4,responsavel=$5,status_interno=$6,comprovante_url=$7,observacoes=$8,atualizado_por_id=$9,atualizado_por_login=$10,atualizado_em=NOW() RETURNING *`, values);
    await client.query(`INSERT INTO ${AUDIT()} (empresa,codigo_multa,dados_anteriores,dados_novos,usuario_id,usuario_login) VALUES($1,$2,$3,$4,$5,$6)`, [empresa,codigo,before.rows[0]||null,rows[0],req.user?.id||null,req.user?.login||null]);
    await client.query("COMMIT"); res.json({ controle: rows[0] });
  } catch(error) { await client.query("ROLLBACK").catch(()=>{}); next(error); } finally { client.release(); }
});

multasFrotaRouter.get("/frota/multas/:empresa/:codigo/auditoria", async (req,res,next) => {
  try { const { rows } = await pool.query(`SELECT * FROM ${AUDIT()} WHERE empresa=$1 AND codigo_multa=$2 ORDER BY criado_em DESC,id DESC`, [Number(req.params.empresa),Number(req.params.codigo)]); res.json({ auditoria: rows }); }
  catch(error) { next(error); }
});
