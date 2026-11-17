import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {syncMaintenanceErp} from '../src/services/maintenanceErpSync.js';

test('ERP network failure never opens an application transaction',async()=>{
  const error=Object.assign(new Error('unreachable'),{code:'EHOSTUNREACH'});
  let connects=0;
  const db={connect:async()=>{connects++;throw Error('must not connect');}};
  await assert.rejects(syncMaintenanceErp({db,readOnly:false,load:async()=>{throw error;}}),error);
  assert.equal(connects,0);
});

test('slow ERP fetch completes before borrowing a client or starting a transaction',async()=>{
  const events=[];
  let resolveLoad;
  const loaded=new Promise(resolve=>{resolveLoad=resolve;});
  const client=new EventEmitter();
  client.query=async sql=>{
    events.push(sql);
    return {rows:[{acquired:false}]};
  };
  client.release=()=>events.push('release');
  const task=syncMaintenanceErp({readOnly:false,load:()=>loaded,db:{connect:async()=>{events.push('connect');return client;}}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(events,[]);
  resolveLoad([]);
  assert.deepEqual(await task,{ignorado:true});
  assert.equal(events[0],'connect');assert.equal(events[1],'BEGIN');
  assert.deepEqual(events.slice(-2),['ROLLBACK','release']);
  assert.equal(client.listenerCount('error'),0);
});

test('client error during synchronization is handled and connection is discarded',async()=>{
  const client=new EventEmitter();
  const failure=Object.assign(new Error('connection terminated'),{code:'25P03'});
  let released;
  client.query=async()=>{client.emit('error',failure);throw failure;};
  client.release=error=>{released=error;};
  await assert.rejects(syncMaintenanceErp({readOnly:false,load:async()=>[],db:{connect:async()=>client}}),failure);
  assert.equal(released,failure);
  assert.equal(client.listenerCount('error'),0);
});
