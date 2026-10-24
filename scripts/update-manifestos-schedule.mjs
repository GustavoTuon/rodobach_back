import {manifestosMessageCode} from './manifestos-message-code.js';
import {config} from '../src/config.js';
import {clientPool} from '../src/db/clientPool.js';
import {readFileSync,writeFileSync} from 'node:fs';

const metadataFile=new URL('../.manifestos-morning-workflow.json',import.meta.url);
const metadata=JSON.parse(readFileSync(metadataFile,'utf8'));
async function api(path,method='GET',body){
  const response=await fetch(config.n8n.apiUrl+'/api/v1'+path,{method,headers:{'X-N8N-API-KEY':config.n8n.apiKey,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`n8n ${method} failed: ${response.status}`);
  return response.json();
}
try {
  let workflow=await api('/workflows/'+metadata.id);
  const trigger=workflow.nodes.find(n=>n.id==='schedule');
  const formatter=workflow.nodes.find(n=>n.id==='format');
  const query=workflow.nodes.find(n=>n.id==='query');
  if(!trigger||!formatter||!query||trigger.type!=='n8n-nodes-base.scheduleTrigger')throw new Error('Unexpected workflow structure');
  trigger.parameters.rule.interval=[{field:'cronExpression',expression:'0 16 * * 1-5'}];
  const oldName=trigger.name;
  trigger.name='Segunda a sexta 16h Brasilia';
  workflow.connections[trigger.name]=workflow.connections[oldName];
  if(oldName!==trigger.name)delete workflow.connections[oldName];
  formatter.parameters.jsCode=manifestosMessageCode;
  const name='Rodobach - Manifestos em aberto - segunda a sexta 16h';
  if(process.argv.includes('--apply')){
    await api('/workflows/'+metadata.id,'PUT',{name,nodes:workflow.nodes,connections:workflow.connections,settings:{...workflow.settings,timezone:'America/Sao_Paulo'}});
    // Republish the modified schedule, keeping the daily-send guard intact.
    await api('/workflows/'+metadata.id+'/deactivate','POST');
    await api('/workflows/'+metadata.id+'/activate','POST');
    workflow=await api('/workflows/'+metadata.id);
    if(!workflow.active||workflow.nodes.find(n=>n.id==='schedule').parameters.rule.interval[0].expression!=='0 16 * * 1-5')throw new Error('Schedule verification failed');
    writeFileSync(metadataFile,JSON.stringify({...metadata,name,cron:'0 16 * * 1-5',timezone:'America/Sao_Paulo'},null,2));
  }
  const {rows}=await clientPool.query(query.parameters.query);
  const dayParts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const part=type=>dayParts.find(p=>p.type===type).value;
  const iso=`${part('year')}-${part('month')}-${part('day')}`;
  const now={setZone:()=>({toFormat:format=>format==='yyyy-MM-dd'?iso:`${part('day')}/${part('month')}/${part('year')}`})};
  const run=new Function('$input','$now','$getWorkflowStaticData',formatter.parameters.jsCode);
  const preview=run({all:()=>rows.map(json=>({json}))},now,()=>({}));
  if(run({all:()=>[]},now,()=>({})).length)throw new Error('Empty guard failed');
  if(run({all:()=>rows.map(json=>({json}))},now,()=>({lastSentDay:iso})).length)throw new Error('Daily guard failed');
  console.log(JSON.stringify({applied:process.argv.includes('--apply'),id:workflow.id,active:workflow.active,timezone:workflow.settings.timezone,cron:workflow.nodes.find(n=>n.id==='schedule').parameters.rule.interval,openCount:rows[0]?.total||0,lastSentDay:workflow.staticData?.global?.lastSentDay||null,recipient:metadata.recipient,preview:preview[0]?.json.text||null}));
} finally {await clientPool.end();}
