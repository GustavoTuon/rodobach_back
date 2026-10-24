import {manifestosMessageCode} from './manifestos-message-code.js';
import {config} from '../src/config.js';
import {clientPool} from '../src/db/clientPool.js';
import {writeFileSync} from 'node:fs';

const name='Rodobach - Manifestos em aberto - segunda a sexta 16h';
const number='5548999503759';
const query=`SELECT m.empresamdf empresa,m.seriemdf serie,m.codigomdf numero,
 m.veiculomdf placa,to_char(m.datahoraautorizacaomdf AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY') autorizado,
 count(*) OVER()::int total
 FROM logistica.mdfe m
 WHERE m.statusmdf IN (3,5) AND m.datahoraencerramentomdf IS NULL AND m.datahoracancelamentomdf IS NULL
 ORDER BY m.datahoraautorizacaomdf ASC NULLS LAST,m.empresamdf,m.seriemdf,m.codigomdf LIMIT 30`;
const code=manifestosMessageCode;
async function api(path,method='GET',body){
 const r=await fetch(config.n8n.apiUrl+'/api/v1'+path,{method,headers:{'X-N8N-API-KEY':config.n8n.apiKey,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw new Error('n8n request failed: '+r.status);
 return r.json();
}
try {
 const {rows}=await clientPool.query(query);
 // Validate the exact formatter without contacting WhatsApp.
 const run=new Function('$input','$now','$getWorkflowStaticData',code);
 const now={setZone:()=>({toFormat:format=>format==='yyyy-MM-dd'?'2026-10-23':'23/10/2026'})};
 const preview=run({all:()=>rows.map(json=>({json}))},now,()=>({}));
 if(run({all:()=>[]},now,()=>({})).length)throw new Error('Empty report guard failed');
 if(run({all:()=>rows.map(json=>({json}))},now,()=>({lastSentDay:'2026-10-23'})).length)throw new Error('Duplicate guard failed');
 console.log(JSON.stringify({validation:'passed',openCount:rows[0]?.total||0,listed:rows.length,messageCharacters:preview[0]?.json.text.length||0,recipient:number}));
 if(!process.argv.includes('--activate'))process.exitCode=0;
 else {
  const all=await api('/workflows?limit=100');
  if(all.nextCursor)throw new Error('Workflow inventory requires pagination; stop to avoid duplicate creation');
  if(all.data.some(w=>w.name===name || w.name.startsWith('Rodobach - Manifestos em aberto -')))throw new Error('Workflow already exists; inspect before changing');
  const template=await api('/workflows/y9b8gFg18TmR7pzw');
  const credentials=template.nodes.find(n=>n.type==='n8n-nodes-base.postgres').credentials;
  const nodes=[
   {id:'schedule',name:'Segunda a sexta 16h Brasilia',type:'n8n-nodes-base.scheduleTrigger',typeVersion:1.2,position:[0,0],parameters:{rule:{interval:[{field:'cronExpression',expression:'0 16 * * 1-5'}]}}},
   {id:'query',name:'Consultar manifestos abertos',type:'n8n-nodes-base.postgres',typeVersion:2.6,position:[240,0],credentials,parameters:{operation:'executeQuery',query,options:{}}},
   {id:'format',name:'Montar resumo',type:'n8n-nodes-base.code',typeVersion:2,position:[480,0],parameters:{jsCode:code}},
   {id:'send',name:'Enviar WhatsApp',type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[720,0],retryOnFail:false,parameters:{method:'POST',url:process.env.EVOLUTION_API_URL+'/message/sendText/'+(process.env.EVOLUTION_INSTANCE_NAME||'rodobach'),sendHeaders:true,headerParameters:{parameters:[{name:'apikey',value:process.env.EVOLUTION_API_KEY}]},sendBody:true,contentType:'json',specifyBody:'json',jsonBody:'={{ JSON.stringify({ number: $json.number, text: $json.text }) }}',options:{timeout:30000}}},
   {id:'record',name:'Registrar envio do dia',type:'n8n-nodes-base.code',typeVersion:2,position:[960,0],parameters:{jsCode:"const day=$('Montar resumo').first().json.day; $getWorkflowStaticData('global').lastSentDay=day; return [{json:{day,success:true}}];"}},
  ];
  const connections={};nodes.slice(0,-1).forEach((n,i)=>{connections[n.name]={main:[[{node:nodes[i+1].name,type:'main',index:0}]]};});
  const payload={name,nodes,connections,settings:{timezone:'America/Sao_Paulo',executionOrder:'v1'}};
  const created=await api('/workflows','POST',payload);
  writeFileSync('.manifestos-morning-workflow.json',JSON.stringify({id:created.id,name,recipient:number,recipients:['5548999503759','5548996466096'],cron:'0 16 * * 1-5',timezone:'America/Sao_Paulo'},null,2));
  await api('/workflows/'+created.id+'/activate','POST');
  const verified=await api('/workflows/'+created.id);
  console.log(JSON.stringify({id:verified.id,active:verified.active,timezone:verified.settings.timezone,cron:verified.nodes.find(n=>n.id==='schedule').parameters.rule.interval[0].expression,url:config.n8n.apiUrl+'/workflow/'+verified.id}));
 }
}finally{await clientPool.end();}
