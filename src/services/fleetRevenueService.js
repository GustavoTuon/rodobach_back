import {clientPool} from '../db/clientPool.js';
import {buildFleetRevenue,revenuePeriod} from './fleetRevenueTargets.js';
import {baseCostCte} from './custosVeiculosService.js';
import {applyProfitTargets} from './fleetProfitModel.js';
const cache=new Map(),pending=new Map();
export async function loadFleetRevenue(month,now=new Date(),options={}) {
  const margin=Number(options.margin ?? 15),reserve=Number(options.reserve ?? 0);
  if(!Number.isFinite(margin)||margin<0||margin>40||!Number.isFinite(reserve)||reserve<0||reserve>100000){const error=new Error('Margem deve ficar entre 0 e 40%; reserva entre R$ 0 e R$ 100.000.');error.status=400;throw error;}
  const period=revenuePeriod(month,now),key=`${period.month}:${period.today}:${margin}:${reserve}`;
  if(cache.has(key) && Date.now()-cache.get(key).time<60000)return cache.get(key).data;
  if(pending.has(key))return pending.get(key);
  const task=(async()=>{
    const client=await clientPool.connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const {rows:vehicles}=await client.query(`SELECT DISTINCT ON (upper(trim(v.placavei)))
        upper(trim(v.placavei)) AS plate,trim(v.nomevei) AS name,
        COALESCE(NULLIF(trim(v.modelovei),''),NULLIF(trim(v.marcamodelorenavamvei),''),trim(v.nomevei)) AS model,
        v.dataaquisicaovei::date::text AS acquired,trim(m.nomemot) AS driver
        FROM frotas.veiculos v LEFT JOIN frotas.motoristas m ON m.empresamot=v.empresavei AND m.codigomot=v.motoristavei
        WHERE v.tipopropriedadevei='P' AND v.situacaovei::text='1'
          AND v.tipoveiculoctevei::text='0' AND v.tiporodadoctevei::text IN ('1','2','3')
          AND (v.datavendavei IS NULL OR v.datavendavei::date>$1::date)
          AND NULLIF(trim(v.placavei),'') IS NOT NULL
        ORDER BY upper(trim(v.placavei)),v.empresavei`,[period.today]);
      const {rows:links}=await client.query(`SELECT DISTINCT upper(trim(c.placa_principal)) AS principal,upper(trim(t.plate)) AS trailer
        FROM frotas.veiculosreboquesmotoristas c
        CROSS JOIN LATERAL unnest(ARRAY[c.placa_reboque1::text,c.placa_reboque2::text,c.placa_reboque3::text]) AS t(plate)
        WHERE upper(trim(c.placa_principal))=ANY($1::text[])
          AND NULLIF(trim(t.plate),'') IS NOT NULL
          AND EXISTS(SELECT 1 FROM frotas.veiculos v WHERE upper(trim(v.placavei))=upper(trim(t.plate)) AND v.tipopropriedadevei='P')`,[vehicles.map(row=>row.plate)]);
      for(const vehicle of vehicles){
        vehicle.trailers=links.filter(link=>link.principal===vehicle.plate).map(link=>link.trailer);
        for(const trailer of vehicle.trailers)if(links.some(link=>link.trailer===trailer&&link.principal!==vehicle.plate))throw new Error('Implemento vinculado a mais de um veículo. Revise o cadastro antes de calcular metas.');
        vehicle.costPlates=[vehicle.plate,...vehicle.trailers];
      }
      const {rows:daily}=await client.query(`SELECT upper(trim(con.veiculocon)) AS plate,
        con.dataemissaocon::date::text AS day,SUM(con.valorfretecon)::numeric AS revenue
        FROM logistica.conhecimentos con
        WHERE con.statuscon=2 AND con.dataemissaocon >= $1::date
          AND con.dataemissaocon < $2::date + INTERVAL '1 day'
          AND upper(trim(con.veiculocon))=ANY($3::text[])
        GROUP BY 1,2 ORDER BY 1,2`,[`${period.year}-01-01`,period.cutoff || `${period.month}-01`,vehicles.map(row=>row.plate)]);
      const {rows:costs}=await client.query(`${baseCostCte()}
        SELECT upper(trim(placa)) AS plate,to_char(vencimento,'YYYY-MM') AS month,
          conta_nome AS account,sum(valor)::numeric AS cost
        FROM custos_status WHERE upper(trim(placa))=ANY($3::text[])
        GROUP BY 1,2,3`,[`${period.year}-01-01`,`${period.month}-01`,vehicles.flatMap(row=>row.costPlates)]);
      await client.query('COMMIT');
      const data={...applyProfitTargets(buildFleetRevenue(vehicles,daily,period),costs,margin,reserve),updatedAt:new Date().toISOString()};
      cache.clear();cache.set(key,{data,time:Date.now()});return data;
    } catch(error) {await client.query('ROLLBACK').catch(()=>{});throw error;} finally {client.release();}
  })();
  pending.set(key,task);
  try{return await task;}finally{pending.delete(key);}
}
