import {getVeiculosPool} from '../db/pool-veiculos.js';
import {quoteIdent} from '../config.js';

// Match only the macro title, never text entered by the driver in a free message.
export function cargoMacroType(description) {
  const title=String(description||'').split(/[\r\n]/)[0].normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/^\s*\d+[.\s-]+/,'').replace(/\s+/g,' ').trim().toUpperCase();
  if(['INICIO DE VIAGEM CARREGADO','CARREGAMENTO CONCLUIDO','FIM DE CARREGAMENTO'].includes(title))return 'carregado';
  if(['INICIO DE VIAGEM VAZIO','VEICULO VAZIO','ULTIMA DESCARGA CONCLUIDA'].includes(title))return 'vazio';
  if(['CHEGADA AO CLIENTE','CHEGADA NO CLIENTE','CHEGADA NO DESTINO','PARADA ENTREGA/CLIENTE'].includes(title))return 'chegada';
  if(['FIM DE DESCARGA','DESCARGA CONCLUIDA'].includes(title))return 'descarga';
  if(title==='FIM DE VIAGEM')return 'fim_viagem';
  if(['INICIO DE VIAGEM','REINICIO DE VIAGEM'].includes(title))return 'viagem';
  return null;
}

export async function loadCargoMacros(plates) {
  const schema=quoteIdent(process.env.VEICULOS_DB_SCHEMA||'rodobach');
  const {rows}=await getVeiculosPool().query(`SELECT regexp_replace(upper(v.placa),'[^A-Z0-9]','','g') placa,
    m.id,m.data_hora,m.macro_descricao,m.municipio,m.uf,m.ponto_controle_nome,m.latitude,m.longitude
    FROM ${schema}.veiculos v CROSS JOIN LATERAL (
      SELECT id,data_hora,macro_descricao,municipio,uf,ponto_controle_nome,latitude,longitude
      FROM ${schema}.mensagens_cb WHERE veiculo_id=v.veiculo_id
      AND data_hora>=now()-interval '30 days' AND data_hora<=now()
      AND nullif(trim(macro_descricao),'') IS NOT NULL ORDER BY data_hora DESC,id DESC LIMIT 500
    ) m WHERE regexp_replace(upper(v.placa),'[^A-Z0-9]','','g')=ANY($1::text[])`,[plates]);
  const map=new Map();
  for(const row of rows){
    const events=map.get(row.placa)||[];
    events.push({id:String(row.id),dataHora:row.data_hora,descricao:String(row.macro_descricao).split(/[\r\n]/)[0].trim(),
      tipo:cargoMacroType(row.macro_descricao),local:[row.municipio,row.uf?.trim()].filter(Boolean).join(' / '),ponto:row.ponto_controle_nome||null,latitude:row.latitude,longitude:row.longitude});
    map.set(row.placa,events);
  }
  return map;
}

export function cargoMacroEvidence(events=[],operationSince=null,now=new Date()) {
  const since=operationSince?new Date(operationSince).getTime():now-30*86400000;
  const unique=new Map();
  for(const event of events){
    const time=new Date(event.dataHora).getTime();
    if(!Number.isFinite(time)||time>now||now-time>30*86400000)continue;
    unique.set(`${time}:${event.tipo}:${event.descricao}`,event);
  }
  const ordered=[...unique.values()].sort((a,b)=>new Date(b.dataHora)-new Date(a.dataHora)||String(b.id).localeCompare(String(a.id)));
  const current=ordered.filter(e=>new Date(e.dataHora).getTime()>=since);
  const relevant=current.find(e=>e.tipo&&e.tipo!=='viagem');
  // Equal-time contradictory state messages cannot be resolved using arrival order.
  const state=current.find(e=>['carregado','vazio'].includes(e.tipo));
  const conflict=state&&current.some(e=>+new Date(e.dataHora)===+new Date(state.dataHora)&&['carregado','vazio'].includes(e.tipo)&&e.tipo!==state.tipo);
  return {ultima:ordered[0]||null,operacional:relevant||null,
    confirmacao:conflict?null:state||null,conflito:Boolean(conflict),
    historico:ordered.slice(0,6).map(e=>({...e,operacaoAtual:current.includes(e)}))};
}
