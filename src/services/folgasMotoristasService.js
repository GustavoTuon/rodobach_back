import { quoteIdent, tableName } from "../config.js";
import { pool } from "../db/pool.js";
import { clientPool } from "../db/clientPool.js";
import { getVeiculosPool } from "../db/pool-veiculos.js";

const JORNADAS = () => tableName("jornada_motorista");
const MOVIMENTOS = () => tableName("movimento_folga_motorista");
const DIAS_POR_FOLGA = 6;
const DATA_INICIO_APURACAO = "2026-05-25";
const MINUTOS_SAIDA = 10;
const MINUTOS_RETORNO = 15;
const PLACAS_FROTA = ["RAA8G18", "RAA8G58", "RXO6C18", "RXW7J14", "RYI6H21", "RYP7D29", "RYU2G97", "SXR8D09", "SXY5D26"];
const normalizePlate = (value) => String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
const hoursBetween = (start, end = new Date()) => Math.max(0, (new Date(end) - new Date(start)) / 3600000);

// Converte permanencias estaveis dentro/fora da cerca em ciclos de trabalho.
// Oscilacoes curtas de GPS nao iniciam nem encerram uma jornada.
export function buildBaseCycles(runs = [], macros = [], now = new Date()) {
  const stable = [];
  for (const run of [...runs].sort((a, b) => new Date(a.inicio) - new Date(b.inicio))) {
    const minimum = run.na_base ? MINUTOS_RETORNO : MINUTOS_SAIDA;
    if (hoursBetween(run.inicio, run.fim) * 60 < minimum) continue;
    const previous = stable.at(-1);
    if (previous?.na_base === Boolean(run.na_base)) previous.fim = run.fim;
    else stable.push({ ...run, na_base: Boolean(run.na_base) });
  }
  const cycles = [];
  let departure = null;
  let seenBase = false;
  let lastObservedAt = null;
  for (const run of stable) {
    lastObservedAt = new Date(run.fim);
    if (run.na_base) seenBase = true;
    if (!run.na_base && seenBase && !departure) departure = new Date(run.inicio);
    else if (run.na_base && departure) {
      cycles.push({ saidaEm: departure.toISOString(), retornoEm: new Date(run.inicio).toISOString() });
      departure = null;
    }
  }
  if (departure) cycles.push({ saidaEm: departure.toISOString(), retornoEm: null });
  return cycles.map((cycle, index) => {
    const end = cycle.retornoEm ? new Date(cycle.retornoEm) : (lastObservedAt || now);
    const confirmations = macros.filter((event) => new Date(event.data_hora) >= new Date(cycle.saidaEm) && new Date(event.data_hora) <= end);
    const hours = hoursBetween(cycle.saidaEm, end);
    return { id: `cerca-${index}-${cycle.saidaEm}`, ...cycle, origemSaida: "cerca_base",
      origemRetorno: cycle.retornoEm ? "cerca_base" : null, horasFora: Math.round(hours * 100) / 100,
      diasTrabalhados: Math.floor(hours / 24), macrosConfirmacao: confirmations.length,
      telemetriaAte: end.toISOString(),
      primeiraMacro: confirmations[0]?.macro_descricao || null, ultimaMacro: confirmations.at(-1)?.macro_descricao || null };
  });
}

async function carregarCiclosPorPlaca() {
  const schema = quoteIdent(process.env.VEICULOS_DB_SCHEMA || "rodobach");
  const telemetryPool = getVeiculosPool();
  const { rows: bases } = await telemetryPool.query(`SELECT name,shape_type,polygon_points FROM ${schema}.geofences
    WHERE enabled IS TRUE AND type='base' AND exclude_from_daily IS TRUE ORDER BY id LIMIT 1`);
  const base = bases[0];
  if (!base || base.shape_type !== "polygon" || !Array.isArray(base.polygon_points) || base.polygon_points.length < 3) return { cycles: new Map(), geofence: null };
  const polygon = `((${base.polygon_points.map((point) => `${Number(point.longitude)},${Number(point.latitude)}`).join(") , (")}))`;
  const { rows: runs } = await telemetryPool.query(`WITH positions AS (
      SELECT regexp_replace(upper(v.placa),'[^A-Z0-9]','','g') placa,m.data_hora,
        point(m.longitude,m.latitude) <@ $2::polygon AS na_base
      FROM ${schema}.mensagens_cb m JOIN ${schema}.veiculos v ON v.veiculo_id=m.veiculo_id
      WHERE regexp_replace(upper(v.placa),'[^A-Z0-9]','','g')=ANY($1::text[])
        AND m.data_hora >= $3::date AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
    ), marked AS (SELECT *,CASE WHEN na_base IS DISTINCT FROM LAG(na_base) OVER
      (PARTITION BY placa ORDER BY data_hora) THEN 1 ELSE 0 END changed FROM positions),
    grouped AS (SELECT *,SUM(changed) OVER (PARTITION BY placa ORDER BY data_hora) grp FROM marked)
    SELECT placa,na_base,MIN(data_hora) inicio,MAX(data_hora) fim,COUNT(*)::int pontos
    FROM grouped GROUP BY placa,na_base,grp ORDER BY placa,inicio`, [PLACAS_FROTA, polygon, DATA_INICIO_APURACAO]);
  const { rows: macroRows } = await telemetryPool.query(`SELECT regexp_replace(upper(v.placa),'[^A-Z0-9]','','g') placa,
      m.data_hora,m.macro_descricao,m.motorista_id,m.motorista_nome
    FROM ${schema}.mensagens_cb m JOIN ${schema}.veiculos v ON v.veiculo_id=m.veiculo_id
    WHERE regexp_replace(upper(v.placa),'[^A-Z0-9]','','g')=ANY($1::text[])
      AND m.data_hora >= $2::date AND NULLIF(TRIM(m.macro_descricao),'') IS NOT NULL ORDER BY placa,m.data_hora`,
  [PLACAS_FROTA, DATA_INICIO_APURACAO]);
  const group = (rows) => rows.reduce((map, row) => { const key=normalizePlate(row.placa), list=map.get(key)||[]; list.push(row); map.set(key,list); return map; }, new Map());
  const runMap = group(runs), macroMap = group(macroRows), cycles = new Map();
  for (const plate of PLACAS_FROTA) cycles.set(plate, buildBaseCycles(runMap.get(plate)||[], macroMap.get(plate)||[]));
  return { cycles, geofence: base.name };
}

async function carregarMovimentos(keys) {
  if (!keys.length) return new Map();
  const { rows } = await pool.query(`SELECT empresa_motorista,codigo_motorista,
    COALESCE(SUM(quantidade) FILTER (WHERE tipo='uso'),0) utilizadas,
    COALESCE(SUM(quantidade) FILTER (WHERE tipo='ajuste'),0) ajustes FROM ${MOVIMENTOS()}
    WHERE (empresa_motorista::text||':'||codigo_motorista::text)=ANY($1::text[]) GROUP BY empresa_motorista,codigo_motorista`, [keys]);
  return new Map(rows.map((row) => [`${row.empresa_motorista}:${row.codigo_motorista}`, { utilizadas:Number(row.utilizadas||0), ajustes:Number(row.ajustes||0) }]));
}

const mapJornada = (row) => row ? ({ id:Number(row.id),saidaEm:row.saida_em,retornoPrevistoEm:row.retorno_previsto_em,
  retornoEm:row.retorno_em,origemSaida:row.origem_saida,origemRetorno:row.origem_retorno,observacoes:row.observacoes||"" }) : null;

export async function listarMotoristasFolgas({ busca="", status="", pagina=1, limite=50 }={}) {
  const termo=String(busca||"").trim();
  const { rows:motoristas }=await clientPool.query(`SELECT m.empresamot empresa,m.codigomot codigo,m.nomemot nome,m.apelidomot apelido,
    CONCAT_WS('',NULLIF(m.dddcelularmot::text,''),NULLIF(m.celularmot::text,'')) telefone,
    regexp_replace(upper(v.placavei::text),'[^A-Z0-9]','','g') placa
    FROM frotas.motoristas m JOIN frotas.veiculos v ON v.empresavei=m.empresamot AND v.motoristavei=m.codigomot
      AND v.tipopropriedadevei='P' AND v.situacaovei=1 AND v.tipovei=1
      AND regexp_replace(upper(v.placavei::text),'[^A-Z0-9]','','g')=ANY($2::text[])
    WHERE m.ativomot='S' AND COALESCE(m.situacaomot,1)=1 AND m.datademissaomot IS NULL
      AND ($1='' OR m.nomemot ILIKE '%'||$1||'%' OR COALESCE(m.apelidomot,'') ILIKE '%'||$1||'%' OR COALESCE(v.placavei,'') ILIKE '%'||$1||'%')
    ORDER BY m.nomemot`, [termo,PLACAS_FROTA]);
  const keys=motoristas.map((m)=>`${m.empresa}:${m.codigo}`);
  const [{cycles,geofence},movimentos]=await Promise.all([carregarCiclosPorPlaca(),carregarMovimentos(keys)]);
  let itens=motoristas.map((motorista)=>{
    const all=cycles.get(normalizePlate(motorista.placa))||[], jornada=all.at(-1)||null;
    const completas=all.filter((item)=>item.retornoEm), atual=jornada&&!jornada.retornoEm?jornada:null;
    const diasTrabalhados=completas.reduce((sum,item)=>sum+item.diasTrabalhados,0)+(atual?.diasTrabalhados||0);
    const diasFolga=Math.floor(diasTrabalhados/DIAS_POR_FOLGA),saldoDias=diasTrabalhados%DIAS_POR_FOLGA;
    const mov=movimentos.get(`${motorista.empresa}:${motorista.codigo}`)||{utilizadas:0,ajustes:0};
    const folgasDisponiveis=Math.max(0,diasFolga-mov.utilizadas+mov.ajustes), currentOutside=Boolean(atual);
    return { empresa:Number(motorista.empresa),codigo:Number(motorista.codigo),nome:motorista.nome||motorista.apelido||"Motorista",
      apelido:motorista.apelido||"",telefone:motorista.telefone||"",placa:motorista.placa||"",jornada,
      status:currentOutside?"fora":"disponivel",diasFora:jornada?.diasTrabalhados||0,horasFora:jornada?.horasFora||0,
      retroativo:{dataCorte:DATA_INICIO_APURACAO,viagensCompletas:completas.length,viagensPendentes:currentOutside?1:0,
        diasFora:diasTrabalhados,diasFolga,saldoDias,folgasUtilizadas:mov.utilizadas,ajustes:mov.ajustes,folgasDisponiveis},
      validacao:{nivel:jornada?.macrosConfirmacao?"confirmado":jornada?"provavel":"sem_dados",total:all.length,
        confirmadas:all.filter((item)=>item.macrosConfirmacao).length,parciais:all.filter((item)=>!item.macrosConfirmacao).length,
        divergentes:0,coberturaDesde:DATA_INICIO_APURACAO} };
  });
  if(status) itens=itens.filter((item)=>item.status===status);
  const total=itens.length,resumo={total,fora:itens.filter((x)=>x.status==="fora").length,emFolga:0,disponiveis:itens.filter((x)=>x.status==="disponivel").length};
  const page=Math.max(1,Number(pagina)||1),pageSize=Math.min(100,Math.max(10,Number(limite)||50));
  itens=itens.slice((page-1)*pageSize,page*pageSize);
  return {regra:{diasPorFolga:DIAS_POR_FOLGA,minutosSaida:MINUTOS_SAIDA,minutosRetorno:MINUTOS_RETORNO,origem:"cerca_base_e_macros",
    cercaBase:geofence,dataInicioApuracao:DATA_INICIO_APURACAO},resumo,pagina:page,limite:pageSize,total,itens};
}

export async function registrarMovimentoFolga(payload,usuario) {
  const {empresa,codigo,tipo,quantidade,dataMovimento,observacoes}=payload||{},amount=Number(quantidade);
  if(!empresa||!codigo||!["uso","ajuste"].includes(tipo)||!Number.isFinite(amount)||(tipo==="uso"&&amount<=0)) throw new Error("Dados do movimento de folga invalidos.");
  const {rows}=await pool.query(`INSERT INTO ${MOVIMENTOS()} (empresa_motorista,codigo_motorista,tipo,quantidade,data_movimento,observacoes,criado_por)
    VALUES ($1,$2,$3,$4,COALESCE($5::date,CURRENT_DATE),$6,$7) RETURNING *`,[empresa,codigo,tipo,amount,dataMovimento||null,observacoes||null,usuario||null]); return rows[0];
}

export async function registrarSaida(payload,usuario) {
  const {empresa,codigo,saidaEm,retornoPrevistoEm,observacoes}=payload||{}; if(!empresa||!codigo||!saidaEm) throw new Error("Motorista e data de saida sao obrigatorios.");
  const {rows}=await pool.query(`INSERT INTO ${JORNADAS()} (empresa_motorista,codigo_motorista,saida_em,retorno_previsto_em,observacoes,criado_por,atualizado_por)
    VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING *`,[empresa,codigo,saidaEm,retornoPrevistoEm||null,observacoes||null,usuario||null]); return mapJornada(rows[0]);
}
export async function registrarRetorno(id,payload,usuario) {
  const {retornoEm,observacoes}=payload||{}; if(!retornoEm) throw new Error("Data de retorno e obrigatoria.");
  const {rows}=await pool.query(`UPDATE ${JORNADAS()} SET retorno_em=$2,origem_retorno='manual',observacoes=COALESCE($3,observacoes),atualizado_por=$4,atualizado_em=NOW()
    WHERE id=$1 AND retorno_em IS NULL RETURNING *`,[id,retornoEm,observacoes||null,usuario||null]); if(!rows[0]) throw new Error("Jornada aberta nao encontrada."); return mapJornada(rows[0]);
}
