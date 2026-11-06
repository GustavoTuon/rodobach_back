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
  const iso = String(value).match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (iso) return iso;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};
const money = value => Number(value || 0);
const today = () => new Date().toISOString().slice(0, 10);
const daysFromToday = value => value ? Math.round((new Date(`${value}T00:00:00.000Z`) - new Date(`${today()}T00:00:00.000Z`)) / 86400000) : null;
const incompleteReasons = fine => [
  !fine.auto && "sem_auto",
  !fine.placa && "sem_placa",
  !fine.vencimento && "sem_vencimento",
  fine.valor <= 0 && "sem_valor",
  !fine.controle.responsavel && "sem_responsavel",
  fine.controle.statusMotorista !== "empresa" && !fine.motorista && "sem_motorista",
].filter(Boolean);
const operationalPriority = fine => {
  const days = daysFromToday(fine.vencimento);
  if (!fine.paga && (fine.vencida || days === 0)) return "critica";
  if (!fine.paga && days !== null && days > 0 && days <= 3) return "alta";
  if ((!fine.paga && days !== null && days <= 7) || fine.controle.statusIndicacao === "pendente" || fine.incompleta) return "atencao";
  return "normal";
};
const nextAction = fine => {
  if (fine.paga && fine.controle.statusMotorista === "alerta") return "Conferir desconto do motorista";
  if (fine.controle.statusIndicacao === "pendente" || fine.controle.statusIndicacao === "prazo_perdido") return "Conferir indicação do condutor";
  if (fine.controle.statusMotorista === "em_aberto") return "Conferir desconto do motorista";
  if (fine.paga) return "Nenhuma ação pendente";
  if (fine.vencida) return "Conferir pagamento vencido";
  if (fine.diasParaVencimento !== null && fine.diasParaVencimento <= 7) return "Programar pagamento";
  if (!fine.controle.responsavel) return "Atribuir responsável pelo acompanhamento";
  if (fine.controle.statusInterno === "em_defesa") return "Acompanhar defesa";
  return "Acompanhar ocorrência";
};
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
  const driverStatus = row.desconto_realizado || control.descontado_motorista ? "descontado" : driverStatusFromErp(row, paid);
  const fineDescription = row.infracao_descricao || "Descrição não cadastrada no ERP";
  const fine = {
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
    gravidadeDescricao: row.gravidade_descricao || "", pontos: row.pontos_infracao == null ? null : Number(row.pontos_infracao),
    paga: paid, vencida: Boolean(overdue), descontarMotorista: row.descontarmultamotoristamtr || "",
    observacaoErp: row.observacaomtr || "", statusErp: row.statusmtr, ultimoStatusErp: row.ultimostatusmtr,
    controle: {
      statusIndicacao: control.status_indicacao || (driverStatus === "empresa" ? "nao_aplicavel" : "pendente"), indicadoEm: dateText(control.indicado_em),
      responsavel: control.responsavel || "", statusInterno: control.status_interno || "acompanhar",
      orgaoAutuador: control.orgao_autuador || "",
      statusMotorista: driverStatus,
      descontadoMotorista: Boolean(row.desconto_realizado || control.descontado_motorista),
      descontoErp: Boolean(row.desconto_realizado), descontadoEm: dateText(control.descontado_em),
      prazoIndicacao: dateText(control.prazo_indicacao),
      statusMulta: paid ? "paga" : (control.status_multa || "desconto_20"),
      statusMotoristaAutomatico: true, statusMultaBloqueado: paid,
      comprovanteUrl: control.comprovante_url || "", observacoes: control.observacoes || "",
      atualizadoPor: control.atualizado_por_login || "", atualizadoEm: control.atualizado_em || null,
    },
  };
  fine.incompletudes = incompleteReasons(fine);
  fine.incompleta = fine.incompletudes.length > 0;
  fine.diasParaVencimento = daysFromToday(fine.vencimento);
  fine.prioridade = operationalPriority(fine);
  fine.proximaAcao = nextAction(fine);
  return fine;
}

function ranking(rows, keyFn, labelKey) {
  const grouped = new Map();
  for (const fine of rows) {
    const key = keyFn(fine) || "Nao informado";
    const item = grouped.get(key) || { [labelKey]: key, quantidade: 0, valor: 0, abertas: 0 };
    item.quantidade += 1;
    item.valor += fine.valorFinal;
    if (!fine.paga) item.abertas += 1;
    grouped.set(key, item);
  }
  return [...grouped.values()].sort((a, b) => b.quantidade - a.quantidade || b.valor - a.valor).slice(0, 10);
}

function buildOperationalData(all) {
  const open = all.filter(fine => !fine.paga);
  const due7 = open.filter(fine => fine.diasParaVencimento !== null && fine.diasParaVencimento >= 0 && fine.diasParaVencimento <= 7);
  const company = all.filter(fine => fine.controle.statusMotorista === "empresa");
  const driver = all.filter(fine => fine.controle.statusMotorista !== "empresa");
  const incomplete = all.filter(fine => fine.incompleta);
  const pending = all.filter(fine => ["pendente", "prazo_perdido"].includes(fine.controle.statusIndicacao));
  const alerts = [
    all.filter(fine => fine.vencida && !fine.paga).length && { prioridade: "critica", titulo: `${all.filter(fine => fine.vencida && !fine.paga).length} multa(s) vencida(s)`, detalhe: "Pagamento requer conferencia imediata.", filtro: "vencidas" },
    open.filter(fine => fine.diasParaVencimento !== null && fine.diasParaVencimento >= 0 && fine.diasParaVencimento <= 3).length && { prioridade: "alta", titulo: `${open.filter(fine => fine.diasParaVencimento !== null && fine.diasParaVencimento >= 0 && fine.diasParaVencimento <= 3).length} multa(s) vencem em ate 3 dias`, detalhe: "Priorize a verificacao do pagamento.", filtro: "vencendo" },
    pending.length && { prioridade: "alta", titulo: `${pending.length} indicacao(oes) pendente(s)`, detalhe: "Confira o prazo de indicacao nos detalhes da multa.", filtro: "sem_indicacao" },
    incomplete.length && { prioridade: "atencao", titulo: `${incomplete.length} registro(s) incompleto(s)`, detalhe: "Confira vencimento, placa, motorista, auto e responsavel.", filtro: "incompletas" },
  ].filter(Boolean).slice(0, 5);
  const evolutionMap = new Map();
  for (const fine of all) {
    const month = String(fine.dataInfracao || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const item = evolutionMap.get(month) || { mes: month, quantidade: 0, valor: 0, aberto: 0 };
    item.quantidade += 1;
    item.valor += fine.valorFinal;
    if (!fine.paga) item.aberto += fine.valorFinal;
    evolutionMap.set(month, item);
  }
  const qualidade = {
    semVencimento: all.filter(fine => fine.incompletudes.includes("sem_vencimento")).length,
    semMotorista: all.filter(fine => fine.incompletudes.includes("sem_motorista")).length,
    semPlaca: all.filter(fine => fine.incompletudes.includes("sem_placa")).length,
    semResponsavel: all.filter(fine => fine.incompletudes.includes("sem_responsavel")).length,
    semAuto: all.filter(fine => fine.incompletudes.includes("sem_auto")).length,
    semValor: all.filter(fine => fine.incompletudes.includes("sem_valor")).length,
  };

  return {
    resumo: {
      total: all.length,
      valorOriginal: all.reduce((sum, fine) => sum + fine.valor, 0),
      abertas: open.length,
      valorAberto: open.reduce((sum, fine) => sum + fine.valorFinal, 0),
      pagas: all.filter(fine => fine.paga).length,
      valorPago: all.reduce((sum, fine) => sum + fine.valorPago, 0),
      vencidas: all.filter(fine => fine.vencida && !fine.paga).length,
      valorVencido: all.filter(fine => fine.vencida && !fine.paga).reduce((sum, fine) => sum + fine.valorFinal, 0),
      vencendo7: due7.length,
      valorVencendo7: due7.reduce((sum, fine) => sum + fine.valorFinal, 0),
      indicacaoPendente: pending.length,
      aDescontar: driver.filter(i=>!i.controle.descontadoMotorista).length,
      valorADescontar: driver.filter(i=>!i.controle.descontadoMotorista).reduce((n,i)=>n+i.valorFinal,0),
      descontadas: all.filter(i=>i.controle.descontadoMotorista).length,
      semVencimento: open.filter(i=>!i.vencimento).length,
      responsabilidadeEmpresa: company.length,
      valorResponsabilidadeEmpresa: company.reduce((sum, fine) => sum + fine.valorFinal, 0),
      responsabilidadeMotorista: driver.length,
      valorResponsabilidadeMotorista: driver.reduce((sum, fine) => sum + fine.valorFinal, 0),
      incompletos: incomplete.length,
    },
    alertas: alerts,
    evolucao: [...evolutionMap.values()].sort((a, b) => a.mes.localeCompare(b.mes)).slice(-12),
    qualidade,
    rankings: {
      motoristas: ranking(all.filter(fine => fine.motorista), fine => fine.motorista, "motorista"),
      veiculos: ranking(all.filter(fine => fine.placa), fine => fine.placa, "placa"),
      infracoes: ranking(all, fine => fine.infracaoCategoria, "infracao"),
    },
  };
}

function groupFines(items, mode) {
  const groups = new Map();
  for (const item of items) {
    const key = mode === "placa" ? (item.placa || "sem-placa") : item.motoristaCodigo != null ? `${item.empresa}:${item.motoristaCodigo}` : (item.motorista || "sem-motorista");
    if (!groups.has(key)) groups.set(key, {id:key, nome:mode === "placa" ? (item.placa || "Sem placa") : (item.motorista || "Sem motorista"), multas:[], pontos:0, semPontos:0, valorTotal:0, valorAberto:0, etapas:0, concluidas:0});
    const group=groups.get(key);
    group.multas.push(item);
    group.pontos += Number(item.pontos || 0);
    if (item.pontos == null) group.semPontos++;
    group.valorTotal += item.valorFinal;
    if (!item.paga) group.valorAberto += item.valorFinal;
    group.etapas++;
    if (item.paga) group.concluidas++;
    if (item.controle.statusIndicacao !== "nao_aplicavel") {
      group.etapas++;
      if (["indicada","confirmada"].includes(item.controle.statusIndicacao)) group.concluidas++;
    }
    if (item.controle.statusMotorista !== "empresa") {
      group.etapas++;
      if (item.controle.descontadoMotorista) group.concluidas++;
    }
  }
  return [...groups.values()].sort((a,b)=>a.nome.localeCompare(b.nome,"pt-BR",{numeric:true})).map(group=>({...group,progresso:Math.round(group.concluidas/group.etapas*100)}));
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
    const infractionFrom = dateText(req.query.infracaoDe);
    const infractionTo = dateText(req.query.infracaoAte);
    const opcoesFiltros = {motoristas:[...new Set(all.map(i=>i.motorista).filter(Boolean))].sort(), placas:[...new Set(all.map(i=>i.placa).filter(Boolean))].sort()};
    const dueFrom = dateText(req.query.vencimentoDe);
    const dueTo = dateText(req.query.vencimentoAte);
    const quick = String(req.query.rapido || "todas");
    if (q) items = items.filter(i => [i.auto,i.infracao,i.infracaoDescricao,i.infracaoCategoria,i.placa,i.motorista,i.cidade].join(" ").toLowerCase().includes(q));
    if (status === "aberta") items = items.filter(i => !i.paga);
    if (status === "paga") items = items.filter(i => i.paga);
    if (status === "vencida") items = items.filter(i => i.vencida);
    if (indication !== "todos") items = items.filter(i => i.controle.statusIndicacao === indication);
    if (driverStatus !== "todos") items = items.filter(i => i.controle.statusMotorista === driverStatus);
    if (fineStatus !== "todos") items = items.filter(i => i.controle.statusMulta === fineStatus);
    if (plate) items = items.filter(i => i.placa.toLowerCase().includes(plate));
    if (driver) items = items.filter(i => i.motorista.toLowerCase().includes(driver));
    if (infractionFrom) items = items.filter(i => i.dataInfracao && i.dataInfracao >= infractionFrom);
    if (infractionTo) items = items.filter(i => i.dataInfracao && i.dataInfracao <= infractionTo);
    if (dueFrom) items = items.filter(i => i.vencimento && i.vencimento >= dueFrom);
    if (dueTo) items = items.filter(i => i.vencimento && i.vencimento <= dueTo);
    const operational = buildOperationalData(items);
    if (quick === "abertas") items = items.filter(i => !i.paga);
    if (quick === "vencendo") items = items.filter(i => !i.paga && i.diasParaVencimento !== null && i.diasParaVencimento >= 0 && i.diasParaVencimento <= 7);
    if (quick === "vencidas") items = items.filter(i => i.vencida && !i.paga);
    if (quick === "sem_indicacao") items = items.filter(i => ["pendente", "prazo_perdido"].includes(i.controle.statusIndicacao));
    if (quick === "a_descontar") items = items.filter(i => i.controle.statusMotorista !== "empresa" && !i.controle.descontadoMotorista);
    if (quick === "descontadas") items = items.filter(i => i.controle.descontadoMotorista);
    if (quick === "empresa") items = items.filter(i => i.controle.statusMotorista === "empresa");
    if (quick === "motorista") items = items.filter(i => i.controle.statusMotorista !== "empresa");
    if (quick === "sem_responsavel") items = items.filter(i => !i.controle.responsavel);
    if (quick === "incompletas") items = items.filter(i => i.incompleta);
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
      else if (order === "prioridade") result = ["critica","alta","atencao","normal"].indexOf(a.prioridade) - ["critica","alta","atencao","normal"].indexOf(b.prioridade) || compare(a.vencimento, b.vencimento);
      else result = compare(a.placa, b.placa) || -compare(a.dataInfracao, b.dataInfracao);
      return result * direction;
    });
    if (["motorista","placa"].includes(req.query.agrupar)) {
      const groups=groupFines(items,req.query.agrupar);
      const pageSize=Math.min(Math.max(Number(req.query.pageSize)||10,1),30);
      const totalPages=Math.max(1,Math.ceil(groups.length/pageSize));
      const page=Math.min(Math.max(Number(req.query.page)||1,1),totalPages);
      return res.json({...operational, opcoesFiltros, filtroPeriodoSuportado:true, indicadoresFiltradosVersao:2, grupos:groups.slice((page-1)*pageSize,page*pageSize), totalMultas:items.length,
        paginacao:{page,pageSize,total:groups.length,totalPages}, fonte:"frotas.multastransito (somente leitura)"});
    }
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
      ...operational,
      multas: items.slice((page - 1) * pageSize, page * pageSize),
      gruposPlaca, paginacao: { page, pageSize, total, totalPages }, fonte: "frotas.multastransito (somente leitura)"
    });
  } catch (error) { next(error); }
});

multasFrotaRouter.put("/frota/multas/:empresa/:codigo/controle", async (req, res, next) => {
  let client;
  try {
    const empresa = Number(req.params.empresa), codigo = Number(req.params.codigo);
    if (!Number.isInteger(empresa) || !Number.isInteger(codigo)) return res.status(400).json({error:"Multa inválida."});
    const erpResult = await clientPool.query(`SELECT m.*,
      EXISTS (SELECT 1 FROM frotas.multastransitodescontosmultas mdm JOIN frotas.multastransitodescontos mtd ON mtd.codigomtd=mdm.codigomdm WHERE mdm.multamdm=m.codigomtr AND mtd.clientemtd IS NOT NULL) AS desconto_realizado
      FROM frotas.multastransito m WHERE m.empresamtr=$1 AND m.codigomtr=$2`, [empresa,codigo]);
    if (!erpResult.rows[0]) return res.status(404).json({error:"Multa não encontrada no ERP."});
    const row=erpResult.rows[0];
    client=await pool.connect();
    await client.query("BEGIN");
    // Serialize edits even when this fine has no control record yet.
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [empresa,codigo]);
    const before=await client.query(`SELECT * FROM ${CONTROL()} WHERE empresa=$1 AND codigo_multa=$2 FOR UPDATE`,[empresa,codigo]);
    const previous=before.rows[0]||{};
    const current=mapFine(row,previous).controle;
    const body={...current,...req.body};
    const validDate=value=>!value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value);
    if (!INDICATION.has(body.statusIndicacao)||!INTERNAL.has(body.statusInterno)||typeof body.descontadoMotorista!=="boolean"||![body.indicadoEm,body.descontadoEm,body.prazoIndicacao].every(validDate)) {
      await client.query("ROLLBACK"); return res.status(400).json({error:"Confira os campos de indicação, desconto e datas."});
    }
    if (typeof body.orgaoAutuador !== "string" || body.orgaoAutuador.trim().length > 160) {
      await client.query("ROLLBACK"); return res.status(400).json({error:"Informe um órgão autuador com até 160 caracteres."});
    }
    const manualDiscount = row.desconto_realizado ? Boolean(previous.descontado_motorista) : body.descontadoMotorista;
    if (manualDiscount && driverStatusFromErp(row,false)==="empresa") {
      await client.query("ROLLBACK"); return res.status(400).json({error:"A multa é de responsabilidade da empresa no sistema."});
    }
    const statusMotorista=row.desconto_realizado||manualDiscount?"descontado":driverStatusFromErp(row,Boolean(row.datapagamentomtr||row.pagamtr||row.pagafinanceiromtr));
    const indicated=["indicada","confirmada"].includes(body.statusIndicacao);
    const values=[empresa,codigo,body.statusIndicacao,indicated?(body.indicadoEm||today()):null,req.user?.login||null,body.statusInterno,String(body.comprovanteUrl||"").trim()||null,String(body.observacoes||"").trim()||null,req.user?.id||null,req.user?.login||null,statusMotorista,manualDiscount,manualDiscount?(body.descontadoEm||today()):null,body.prazoIndicacao||null,body.orgaoAutuador.trim()||null];
    const {rows}=await client.query(`INSERT INTO ${CONTROL()} (empresa,codigo_multa,status_indicacao,indicado_em,responsavel,status_interno,comprovante_url,observacoes,atualizado_por_id,atualizado_por_login,status_motorista,descontado_motorista,descontado_em,prazo_indicacao,orgao_autuador)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(empresa,codigo_multa) DO UPDATE SET status_indicacao=$3,indicado_em=$4,responsavel=$5,status_interno=$6,comprovante_url=$7,observacoes=$8,atualizado_por_id=$9,atualizado_por_login=$10,status_motorista=$11,descontado_motorista=$12,descontado_em=$13,prazo_indicacao=$14,orgao_autuador=$15,atualizado_em=NOW() RETURNING *`,values);
    await client.query(`INSERT INTO ${AUDIT()} (empresa,codigo_multa,dados_anteriores,dados_novos,usuario_id,usuario_login) VALUES($1,$2,$3,$4,$5,$6)`,[empresa,codigo,before.rows[0]||null,rows[0],req.user?.id||null,req.user?.login||null]);
    await client.query("COMMIT"); res.json({controle:rows[0]});
  } catch(error) { if(client) await client.query("ROLLBACK").catch(()=>{}); next(error); }
  finally { client?.release(); }
});

multasFrotaRouter.get("/frota/multas/:empresa/:codigo/auditoria", async (req,res,next) => {
  try { const { rows } = await pool.query(`SELECT * FROM ${AUDIT()} WHERE empresa=$1 AND codigo_multa=$2 ORDER BY criado_em DESC,id DESC`, [Number(req.params.empresa),Number(req.params.codigo)]); res.json({ auditoria: rows }); }
  catch(error) { next(error); }
});
