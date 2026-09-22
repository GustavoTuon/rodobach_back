import test from 'node:test';
import assert from 'node:assert/strict';
import {eliteDistanceFilters,parseEliteDistance} from '../src/services/eliteDistance.js';
const row={id:247450,placa:'IRF0D29',kmtotal:276.19073,ultima_data_computador_bordo:'2026-09-21 23:57:03',viagens:[{kmtotal:142.8235}]};
const parse=rows=>parseEliteDistance({data:rows},247450,'IRF0D29','2026-09-21',new Date('2026-09-22T20:00:00Z'));
test('daily total includes movement outside SM and does not sum nested trips',()=>{
 assert.equal(parse([row]).km,276.2);
 assert.equal(parse([row]).fonte,'Elite');
 assert.equal(parse([row]).fim,'2026-09-22T02:57:03.000Z');
 const filters=eliteDistanceFilters(247450,'2026-09-21');
 assert.equal(filters.viagem_rel_km,'');
 assert.equal(filters.dataComputadorBordoInicial,'21/09/2026 00:00');
 assert.equal(filters.dataComputadorBordoFinal,'21/09/2026 23:59');
});
test('missing, wrong-day and duplicate data are not zero kilometers',()=>{
 for(const rows of [[],[row,row],[{...row,placa:'OTHER'}],[{...row,kmtotal:null}],[{...row,kmtotal:''}],[{...row,kmtotal:-1}],[{...row,ultima_data_computador_bordo:'2026-09-20 23:00:00'}]])assert.equal(parse(rows),null);
 assert.equal(parse([{...row,kmtotal:0}]).km,0);
});
