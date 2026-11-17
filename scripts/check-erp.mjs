import net from 'node:net';
import {config} from '../src/config.js';
import {clientPool} from '../src/db/clientPool.js';

// Run inside the deployed backend container. No writes and no credentials printed.
async function check(label, run) {
  const started = Date.now();
  try {
    await run();
    console.log(JSON.stringify({check:label,ok:true,ms:Date.now()-started}));
    return true;
  } catch(error) {
    console.log(JSON.stringify({check:label,ok:false,code:error.code||'CONNECTION_FAILED',ms:Date.now()-started}));
    process.exitCode=1;
    return false;
  }
}
try {
  const reachable=await check('ERP TCP',()=>new Promise((resolve,reject)=>{
    const socket=net.createConnection({host:config.clientDb.host,port:config.clientDb.port});
    const finish=error=>{socket.destroy();error?reject(error):resolve();};
    socket.setTimeout(5000,()=>finish(Object.assign(new Error('timeout'),{code:'ETIMEDOUT'})));
    socket.once('connect',()=>finish());
    socket.once('error',finish);
  }));
  if(reachable){
    const connected=await check('ERP PostgreSQL',()=>clientPool.query('SELECT 1'));
    if(connected){
      await check('ERP veiculos',()=>clientPool.query('SELECT placavei FROM frotas.veiculos LIMIT 1'));
      await check('ERP engates',()=>clientPool.query('SELECT placa_principal FROM frotas.veiculosreboquesmotoristas LIMIT 1'));
    }
  }
} finally {await clientPool.end();}
