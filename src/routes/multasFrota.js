import { Router } from "express";
import { pool } from "../db/pool.js";
import { clientPool } from "../db/clientPool.js";
import { tableName } from "../config.js";

export const multasFrotaRouter = Router();
const CONTROL = () => tableName("controle_multas_frota");
const AUDIT = () => tableName("controle_multas_frota_auditoria");
const INDICATION = new Set(["nao_aplicavel", "pendente", "indicada", "confirmada", "prazo_perdido"]);
const INTERNAL = new Set(["acompanhar", "em_defesa", "deferida", "indeferida", "encerrada"]);
const DRIVER_STATUS = new Set(["empresa", "descontado", "em_aberto", "alerta"]);
const FINE_STATUS = new Set(["desconto_20", "desconto_40", "recorrer", "paga"]);
const dateText = value => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const iso = String(value).match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (iso) return iso;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};
const money = value => Number(value || 0);
const fineCategory = description => {
  const text = String(description || "").toLowerCase();
  if (/velocidade|máxima permitida|radar/.test(text)) return "Velocidade";
  if (/sinal|semáforo|faixa|preferência|conversão|retorno/.test(text)) return "Sinalização e circulação";
  if (/estacion|parar |parada|imobiliza/.test(text)) return "Estacionamento e parada";
  if (/peso|pbt|pbtc|eixo|dimensão|lotação/.test(text)) return "Peso e dimensões";
  if (/document|licenc|registro|habilita|cnh|placa/.test(text)) return "Documentação";
  if (/condutor|identifica/.test(text)) return "Identificação do condutor";
  if (/cinto|capacete|celular|telefone/.test(text)) return "Segurança do condutor";
  if (/ultrapass|contramão|transitar|circulação/.test(text)) return "Circulação";
  return "Outros";
};
const driverStatusFromErp = (row, paid) => {
  const shouldDiscount = String(row.descontarmultamotoristamtr || "").trim().toUpperCase() === "S";
  if (!shouldDiscount) return "empresa";
  if (row.desconto_realizado) return "descontado";
  return paid ? "alerta" : "em_aberto";
};

function mapFine(row, control = {}) {
  const paid = Boolean(row.datapagamentomtr || row.pagamtr || row.pagafinanceiromtr);
  const due = dateText(row.datavencimentoboletomtr);
  const overdue = !paid && due && due < new Date().toISOString().slice(0, 10);
  const driverStatus = driverStatusFromErp(row, paid);
  const fineDescription = row.infracao_descricao || "Descrição não cadastrada no ERP";
  return {
    id: `${row.empresamtr}:${row.codigomtr}`,
    empresa: Number(row.empresamtr), codigo: Number(row.codigomtr), auto: row.numeroautomtr || "",
    infracao: row.infracaomtr || "Multa de trânsito", placa: row.veiculomtr || "",
    infracaoDescricao: fineDescription, infracaoCategoria: fineCategory(fineDescription),
    motoristaCodigo: row.motoristamtr, motorista: row.motorista_nome || "",
    local: row.localinfracaomtr || "", cidade: row.cidade_nome || "",
    dataInfracao: dateText(row.datainfracaomtr), horaInfracao: row.horainfracaomtr || "",
    limiteDefesaPrevia: dateText(row.datalimitedefesapreviamtr), limiteDefesa: dateText(row.datalimitedefesamtr),
    vencimento: due, dataPagamento: dateText(row.datapagamentomtr), gravidade: row.gravidademtr,
    valor: money(row.valormtr), desconto: money(row.valordescontomtr), juros: money(row.valorjurosmtr),
    valorFinal: money(row.valormtr) - money(row.valordescontomtr) + money(row.valorjurosmtr),
    valorPago: paid ? money(row.valormtr) - money(row.valordescontomtr) + money(row.valorjurosmtr) : 0,
    gravidadeDescricao: row.gravidade_descricao || "", pontos: Number(row.pontos_infracao || 0),
    paga: paid, vencida: Boolean(overdue), descontarMotorista: row.descontarmultamotoristamtr || "",
    observacaoErp: row.observacaomtr || "", statusErp: row.statusmtr, ultimoStatusErp: row.ultimostatusmtr,
    controle: {
      statusIndicacao: control.status_indicacao || "nao_aplicavel", indicadoEm: dateText(control.indicado_em),
      responsavel: control.responsavel || "", statusInterno: control.status_interno || "acompanhar",
      statusMotorista: driverStatus,
      statusMulta: paid ? "paga" : (control.status_multa || "desconto_20"),
      statusMotoristaAutomatico: true, statusMultaBloqueado: paid,
      comprovanteUrl: control.comprovante_url || "", observacoes: control.observacoes || "",
      atualizadoPor: control.atualizado_por_login || "", atualizadoEm: control.atualizado_em || null,
    },
  };
}

multasFrotaRouter.get("/frota/multas", async (req, res, next) => {
  try {
    const { rows } = await clientPool.query(`
      SELECT m.*, mot.nomemot AS motorista_nome, cid.nomecid AS cidade_nome,
        itr.descricaoitr AS infracao_descricao, igr.descricaoigr AS gravidade_descricao, igr.pontosigr AS pontos_infracao,
        EXISTS (
          SELECT 1
          FROM frotas.multastransitodescontosmultas mdm
          JOIN frotas.multastransitodescontos mtd ON mtd.codigomtd=mdm.codigomdm
          WHERE mdm.multamdm=m.codigomtr AND mtd.clientemtd IS NOT NULL
        ) AS desconto_realizado
      FROM frotas.multastransito m
      LEFT JOIN frotas.motoristas mot ON mot.codigomot=m.motoristamtr AND mot.empresamot=m.empresamtr
      LEFT JOIN localidades.cidades cid ON cid.codigocid=m.cidadeinfracaomtr
      LEFT JOIN frotas.infracoestransito itr ON itr.codigoitr::text=m.infracaomtr::text
      LEFT JOIN frotas.infracoesgravidades igr ON igr.codigoigr=m.gravidademtr
      ORDER BY COALESCE(m.datainfracaomtr,m.dataentradamtr,m.dataemissaomtr) DESC, m.codigomtr DESC
    `);
    const controls = await pool.query(`SELECT * FROM ${CONTROL()}`);
    const byKey = new Map(controls.rows.map(c => [`${c.empresa}:${c.codigo_multa}`, c]));
    const all = rows.map(row => mapFine(row, byKey.get(`${row.empresamtr}:${row.codigomtr}`)));
    let items = [...all];
    const q = String(req.query.q || "").trim().toLowerCase();
    const status = String(req.query.status || "todos");
    const indication = String(req.query.indicacao || "todos");
    const driverStatus = String(req.query.statusMotorista || "todos");
    const fineStatus = String(req.query.statusMulta || "todos");
    const plate = String(req.query.placa || "").trim().toLowerCase();
    const driver = String(req.query.motorista || "").trim().toLowerCase();
    const dueFrom = dateText(req.query.vencimentoDe);
    const dueTo = dateText(req.query.vencimentoAte);
    if (q) items = items.filter(i => [i.auto,i.infracao,i.infracaoDescricao,i.infracaoCategoria,i.placa,i.motorista,i.cidade].join(" ").toLowerCase().includes(q));
    if (status === "aberta") items = items.filter(i => !i.paga);
    if (status === "paga") items = items.filter(i => i.paga);
    if (status === "vencida") items = items.filter(i => i.vencida);
    if (indication !== "todos") items = items.filter(i => i.controle.statusIndicacao === indication);
    if (driverStatus !== "todos") items = items.filter(i => i.controle.statusMotorista === driverStatus);
    if (fineStatus !== "todos") items = items.filter(i => i.controle.statusMulta === fineStatus);
    if (plate) items = items.filter(i => i.placa.toLowerCase().includes(plate));
    if (driver) items = items.filter(i => i.motorista.toLowerCase().includes(driver));
    if (dueFrom) items = items.filter(i => i.vencimento && i.vencimento >= dueFrom);
    if (dueTo) items = items.filter(i => i.vencimento && i.vencimento <= dueTo);
    const order = String(req.query.ordenar || "placa");
    const direction = String(req.query.direcao || "asc") === "desc" ? -1 : 1;
    const compare = (a, b) => String(a || "").localeCompare(String(b || ""), "pt-BR", { numeric: true });
    items.sort((a, b) => {
      let result;
      if (order === "auto") result = compare(a.auto, b.auto) || compare(a.infracao, b.infracao);
      else if (order === "vencimento") result = compare(a.vencimento, b.vencimento);
      else if (order === "valor") result = a.valorFinal - b.valorFinal;
      else if (order === "motorista") result = compare(a.motorista, b.motorista);
      else if (order === "dataInfracao") result = compare(a.dataInfracao, b.dataInfracao);
      else if (order === "statusMotorista") result = compare(a.controle.statusMotorista, b.controle.statusMotorista);
      else if (order === "statusMulta") result = compare(a.controle.statusMulta, b.controle.statusMulta);
      else if (order === "responsavel") result = compare(a.controle.responsavel, b.controle.responsavel);
      else result = compare(a.placa, b.placa) || -compare(a.dataInfracao, b.dataInfracao);
      return result * direction;
    });
    const total = items.length;
    const gruposPlaca = items.reduce((groups, item) => {
      const key = item.placa || "Sem placa";
      const group = groups[key] || { quantidade:0, valorTotal:0, pagas:0, abertas:0, alertas:0 };
      group.quantidade += 1; group.valorTotal += item.valorFinal;
      if (item.paga) group.pagas += 1; else group.abertas += 1;
      if (item.controle.statusMotorista === "alerta") group.alertas += 1;
      groups[key] = group; return groups;
    }, {});
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 40, 10), 100);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(Number(req.query.page) || 1, 1), totalPages);
    res.json({
      resumo: { total: all.length, abertas: all.filter(i=>!i.paga).length, pagas: all.filter(i=>i.paga).length,
        vencidas: all.filter(i=>i.vencida).length, indicacaoPendente: all.filter(i=>i.controle.statusIndicacao==="pendente").length,
        valorAberto: all.filter(i=>!i.paga).reduce((sum,i)=>sum+i.valorFinal,0) },
      multas: items.slice((page - 1) * pageSize, page * pageSize),
      gruposPlaca, paginacao: { page, pageSize, total, totalPages }, fonte: "frotas.multastransito (somente leitura)"
    });
  } catch (error) { next(error); }
});

multasFrotaRouter.put("/frota/multas/:empresa/:codigo/controle", async (req, res, next) => {
  const empresa = Number(req.params.empresa); const codigo = Number(req.params.codigo);
  const statusIndicacao = String(req.body.statusIndicacao || "nao_aplicavel");
  const statusInterno = String(req.body.statusInterno || "acompanhar");
  const erpResult = await clientPool.query(`SELECT m.*,
    EXISTS (SELECT 1 FROM frotas.multastransitodescontosmultas mdm JOIN frotas.multastransitodescontos mtd ON mtd.codigomtd=mdm.codigomdm WHERE mdm.multamdm=m.codigomtr AND mtd.clientemtd IS NOT NULL) AS desconto_realizado
    FROM frotas.multastransito m WHERE m.empresamtr=$1 AND m.codigomtr=$2`, [empresa, codigo]);
  if (!erpResult.rows[0]) return res.status(404).json({ error: "Multa não encontrada no ERP." });
  const erpFine = erpResult.rows[0];
  const paid = Boolean(erpFine.datapagamentomtr || erpFine.pagamtr || erpFine.pagafinanceiromtr);
  const statusMotorista = driverStatusFromErp(erpFine, paid);
  const statusMulta = paid ? "paga" : String(req.body.statusMulta || "desconto_20");
  if (!INDICATION.has(statusIndicacao) || !INTERNAL.has(statusInterno) || !DRIVER_STATUS.has(statusMotorista) || !FINE_STATUS.has(statusMulta)) return res.status(400).json({ error: "Status inválido." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query(`SELECT * FROM ${CONTROL()} WHERE empresa=$1 AND codigo_multa=$2 FOR UPDATE`, [empresa,codigo]);
    const values = [empresa,codigo,statusIndicacao,req.body.indicadoEm||null,req.user?.login||null,statusInterno,String(req.body.comprovanteUrl||"").trim()||null,String(req.body.observacoes||"").trim()||null,req.user?.id||null,req.user?.login||null,statusMotorista,statusMulta];
    const { rows } = await client.query(`INSERT INTO ${CONTROL()} (empresa,codigo_multa,status_indicacao,indicado_em,responsavel,status_interno,comprovante_url,observacoes,atualizado_por_id,atualizado_por_login,status_motorista,status_multa)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(empresa,codigo_multa) DO UPDATE SET status_indicacao=$3,indicado_em=$4,responsavel=$5,status_interno=$6,comprovante_url=$7,observacoes=$8,atualizado_por_id=$9,atualizado_por_login=$10,status_motorista=$11,status_multa=$12,atualizado_em=NOW() RETURNING *`, values);
    await client.query(`INSERT INTO ${AUDIT()} (empresa,codigo_multa,dados_anteriores,dados_novos,usuario_id,usuario_login) VALUES($1,$2,$3,$4,$5,$6)`, [empresa,codigo,before.rows[0]||null,rows[0],req.user?.id||null,req.user?.login||null]);
    await client.query("COMMIT"); res.json({ controle: rows[0] });
  } catch(error) { await client.query("ROLLBACK").catch(()=>{}); next(error); } finally { client.release(); }
});

multasFrotaRouter.get("/frota/multas/:empresa/:codigo/auditoria", async (req,res,next) => {
  try { const { rows } = await pool.query(`SELECT * FROM ${AUDIT()} WHERE empresa=$1 AND codigo_multa=$2 ORDER BY criado_em DESC,id DESC`, [Number(req.params.empresa),Number(req.params.codigo)]); res.json({ auditoria: rows }); }
  catch(error) { next(error); }
});
