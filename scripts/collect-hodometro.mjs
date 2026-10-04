import {collectDailyOdometers} from '../src/services/dailyOdometer.js';
import {pool} from '../src/db/pool.js';
import {getVeiculosPool} from '../src/db/pool-veiculos.js';
const [start,end]=process.argv.slice(2);
const valid=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
if(!valid(start)||!valid(end)||end<start||Date.parse(end)-Date.parse(start)>366*86400000)throw Error('Uso: node scripts/collect-hodometro.mjs AAAA-MM-DD AAAA-MM-DD (até 366 dias)');
try {
  for(let day=start;day<=end;) {
    const next=new Date(Date.parse(day)+6*86400000).toISOString().slice(0,10),last=next>end?end:next;
    console.log(`${day} a ${last}: ${await collectDailyOdometers(day,last)} registros preservados`);
    day=new Date(Date.parse(last)+86400000).toISOString().slice(0,10);
  }
}finally{await pool.end();await getVeiculosPool().end();}
