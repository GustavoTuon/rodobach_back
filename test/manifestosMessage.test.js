import test from 'node:test';
import assert from 'node:assert/strict';
import {manifestosMessageCode} from '../scripts/manifestos-message-code.js';
const format=new Function('$input','$now','$getWorkflowStaticData',manifestosMessageCode);
const now={setZone:()=>({toFormat:pattern=>pattern==='yyyy-MM-dd'?'2026-10-26':'26/10/2026'})};
const row={numero:1836,placa:'ABC1234',autorizado:'16/10/2026',empresa:2,serie:1,total:1};
const input=rows=>({all:()=>rows.map(json=>({json}))});
test('manifestos gera mensagem aprovada para os dois contatos e preserva quebra de linha',()=>{
  const messages=format(input([row]),now,()=>({}));
  assert.deepEqual(messages.map(item=>item.json.number),['5548999503759','5548996466096']);
  assert.equal(messages[0].json.text,messages[1].json.text);
  assert.match(messages[0].json.text,/^Boa tarde!\n\*Rodobach \| Manifestos em aberto\*\n26\/10\/2026\n\n1 manifesto\(s\) em aberto no ERP\./);
  assert.match(messages[0].json.text,/Autorização: 16\/10\/2026/);
  assert.ok(!messages[0].json.text.includes('\\n'));
});
test('manifestos não envia lista vazia nem repete envio no dia; distingue número repetido',()=>{
  assert.deepEqual(format(input([]),now,()=>({})),[]);
  assert.deepEqual(format(input([row]),now,()=>({lastSentDay:'2026-10-26'})),[]);
  const messages=format(input([{...row,total:2},{...row,empresa:3,total:2}]),now,()=>({}));
  assert.match(messages[0].json.text,/empresa 2/);assert.match(messages[0].json.text,/empresa 3/);
});
