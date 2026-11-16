import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyMaintenanceHistory,authorizeMaintenanceRetry} from '../src/services/maintenanceRecovery.js';
const attempt={id:78,evento:'envio',origem:'plano',status:'inconclusivo',automacao_id:53,numero:'group@g.us',mensagem:'alert',ocorrido_em:'2026-01-01T00:00:00Z'};
test('provider history requires complete scoped results and detects existing messages',async t=>{
 const oldUrl=process.env.EVOLUTION_API_URL,oldKey=process.env.EVOLUTION_API_KEY;
 process.env.EVOLUTION_API_URL='https://example.invalid';process.env.EVOLUTION_API_KEY='test';
 t.after(()=>{if(oldUrl===undefined)delete process.env.EVOLUTION_API_URL;else process.env.EVOLUTION_API_URL=oldUrl;if(oldKey===undefined)delete process.env.EVOLUTION_API_KEY;else process.env.EVOLUTION_API_KEY=oldKey;});
 const response=messages=>async()=>({ok:true,json:async()=>({messages})});
 assert.deepEqual(await verifyMaintenanceHistory(attempt,response({records:[],total:0,pages:0})),{found:false,checked:0});
 await assert.rejects(verifyMaintenanceHistory(attempt,response({records:[],total:10,pages:1})),/incompleto/);
 await assert.rejects(verifyMaintenanceHistory(attempt,response({records:[{key:{remoteJid:'other',fromMe:true}}],total:1,pages:1})),/destinatário/);
 const result=await verifyMaintenanceHistory(attempt,response({records:[{key:{remoteJid:attempt.numero,fromMe:true,id:'id'},message:{conversation:'alert'},messageTimestamp:Date.parse(attempt.ocorrido_em)/1000}],total:1,pages:1}));
 assert.equal(result.found,true);
});
test('recovery preserves original outcome and only releases verified ambiguous attempts',async()=>{
 const calls=[];
 const db={connect:async()=>({release(){},query:async(sql,args)=>{calls.push({sql,args});return {rows:sql.includes('pg_try')?[{acquired:true}]:sql.includes('SELECT *')?[attempt]:[]};}})};
 await assert.rejects(authorizeMaintenanceRetry(db,78,{actor:'tester',reason:'review',verify:async()=>({found:true})}),/encontrada/);
 assert.equal(calls.some(c=>c.sql.startsWith('UPDATE')),false);
 const result=await authorizeMaintenanceRetry(db,78,{actor:'tester',reason:'review',verify:async()=>({found:false,checked:12})});
 assert.equal(result.planId,53);
 const update=calls.find(c=>c.sql.startsWith('UPDATE'));
 assert.doesNotMatch(update.sql,/SET status|erro=/);
 assert.equal(JSON.parse(update.args[1]).responsavel,'tester');
});
