import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('server trusts only the configured proxy hop count',()=>{
  const script="const {app}=await import('./src/server.js'); console.log(JSON.stringify({hops:app.get('trust proxy'),first:app.get('trust proxy fn')('127.0.0.1',0),second:app.get('trust proxy fn')('127.0.0.1',1)}));";
  for(const hops of ['0','1']){
    const result=spawnSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,TRUST_PROXY_HOPS:hops},encoding:'utf8',timeout:15000});
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()),{hops:Number(hops),first:hops==='1',second:false});
  }
  for(const hops of ['true','-1','1.5']){
    const result=spawnSync(process.execPath,['--input-type=module','-e',"await import('./src/config.js')"],{env:{...process.env,TRUST_PROXY_HOPS:hops},encoding:'utf8',timeout:15000});
    assert.notEqual(result.status,0);assert.match(result.stderr,/TRUST_PROXY_HOPS/);
  }
});
