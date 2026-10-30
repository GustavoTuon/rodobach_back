import fs from 'node:fs';
import { clientPool } from '../src/db/clientPool.js';
import { baseCostCte } from '../src/services/custosVeiculosService.js';
import { getTelemetriaResumoPorPlaca } from '../src/services/telemetriaResumoService.js';
import { carregarKmTelemetriaMensal } from '../src/services/kmAbastecimento.js';
import { getVeiculosPool } from '../src/db/pool-veiculos.js';
const dir = '../analise-controladoria-2026-10-26';
fs.mkdirSync(dir,{recursive:true});
const out=fs.existsSync(`${dir}/evidencias.json`)?JSON.parse(fs.readFileSync(`${dir}/evidencias.json`,'utf8')):{consultadoEm:new Date().toISOString(),queries:[],errors:[]};
async function q(name,sql,params=[]) {
  if(out[name]) return out[name];
  out.queries.push({name,sql,params});
  try {const r=await clientPool.query(sql,params);out[name]=r.rows;console.log(name+': '+r.rows.length+' linhas');return r.rows;}
  catch(e){out.errors.push({name,code:e.code});console.log(name+': falha '+e.code+' '+e.message);return [];}
  finally {fs.writeFileSync(`${dir}/evidencias.json`,JSON.stringify(out,null,2));}
}
try {
await q('readOnly','SHOW transaction_read_only');
await q('schema',`SELECT table_schema,table_name,column_name,data_type FROM information_schema.columns WHERE (table_schema='logistica' AND table_name IN ('conhecimentos','controleviagens')) OR (table_schema='frotas' AND table_name IN ('abastecimentos','veiculos')) ORDER BY table_schema,table_name,ordinal_position`);
const dates=['2026-04-01','2026-09-30'];
await q('veiculos',`SELECT empresavei,placavei,nomevei,tipopropriedadevei,situacaovei,tipovei,tipoveiculoctevei,modelovei,anomodelovei,capacidadepesomaximavei,reboquevei,centrocustovei,dataaquisicaovei,datavendavei FROM frotas.veiculos WHERE tipopropriedadevei='P' ORDER BY placavei LIMIT 500`);
await q('receitas',`SELECT to_char(con.dataemissaocon,'YYYY-MM') mes,upper(trim(con.veiculocon)) placa, con.statuscon,con.tipoctecon, v.tipopropriedadevei propriedade,COUNT(*) n,COUNT(DISTINCT con.dataemissaocon::date) dias_emissao,MIN(con.dataemissaocon)::date primeira,MAX(con.dataemissaocon)::date ultima,SUM(COALESCE(NULLIF(con.totalcon,0),con.valorfretecon,0)) bruto,SUM(con.valoricmscon) icms,SUM(con.valorpiscon) pis,SUM(con.valorcofinscon) cofins,SUM(con.valordescontocon) desconto,COUNT(*) FILTER(WHERE con.totalcon IS NULL AND con.valorfretecon IS NULL) sem_valor FROM logistica.conhecimentos con LEFT JOIN LATERAL (SELECT tipopropriedadevei FROM frotas.veiculos v WHERE upper(trim(v.placavei))=upper(trim(con.veiculocon)) ORDER BY (v.empresavei=con.empresacon) DESC,v.empresavei LIMIT 1) v ON true WHERE con.dataemissaocon::date BETWEEN $1 AND $2 GROUP BY 1,2,3,4,5 ORDER BY 1,2`,dates);
await q('cteDuplicados',`SELECT empresacon,seriecon,codigocon,COUNT(*) n FROM logistica.conhecimentos WHERE dataemissaocon::date BETWEEN $1 AND $2 GROUP BY 1,2,3 HAVING COUNT(*)>1 LIMIT 100`,dates);
const base=baseCostCte();
for(const basis of ['vencimento','emissao']) {
 const sql=basis==='vencimento'?base:base.replaceAll('pag.datavencimentopag::date >=','pag.dataemissaopag::date >=').replaceAll('pag.datavencimentopag::date <=','pag.dataemissaopag::date <=');
 await q('custos_'+basis,`${sql} SELECT to_char(${basis==='vencimento'?'vencimento':'data'},'YYYY-MM') mes,placa_resolvida placa,proprietario,conta_codigo,conta_nome,tipo_custo,COUNT(*) n,SUM(valor) valor,SUM(valor_aberto) aberto, SUM(valor) FILTER(WHERE date_trunc('month',data)<>date_trunc('month',vencimento)) fora_mes,COUNT(*)-COUNT(DISTINCT id) repeticoes FROM custos_status GROUP BY 1,2,3,4,5,6 ORDER BY 1,2,4`,dates);
}
await q('controlesFinanceiros',`SELECT to_char(p.dataemissaopag,'YYYY-MM') mes,p.statuspag,COUNT(*) titulos,SUM(p.valorduplicatapag) valor_titulos,SUM(r.total) valor_rateios,COUNT(*) FILTER(WHERE r.n=0) sem_rateio,SUM(p.valorduplicatapag) FILTER(WHERE r.n=0) valor_sem_rateio,COUNT(*) FILTER(WHERE abs(r.total-p.valorduplicatapag)>0.02) divergentes,SUM(r.total-p.valorduplicatapag) FILTER(WHERE abs(r.total-p.valorduplicatapag)>0.02) diferenca FROM financeiro.pagar p LEFT JOIN LATERAL(SELECT COUNT(*) n,SUM(valorrateioprt) total FROM financeiro.pagarrateios r WHERE (r.empresaprt,r.serieprt,r.duplicataprt,r.parcelaprt,r.fornecedorprt)=(p.empresapag,p.seriepag,p.duplicatapag,p.parcelapag,p.fornecedorpag)) r ON true WHERE p.dataemissaopag::date BETWEEN $1 AND $2 GROUP BY 1,2 ORDER BY 1,2`,dates);
await q('viagens',`SELECT empresacvg,codigocvg,veiculocvg,datasaidacvg,datachegadacvg,kmsaidacvg,kmchegadacvg,kmpercorridovaziocvg,kmdiferencacvg,statuscvg,reboqueumcvg,reboquedoiscvg,reboquetrescvg,totalfretescvg,totalpesotransportadocvg FROM logistica.controleviagens WHERE datasaidacvg::date BETWEEN $1 AND $2 ORDER BY datasaidacvg LIMIT 10000`,dates);
await q('abastecimentos',`SELECT to_char(a.dataaba,'YYYY-MM') mes,upper(trim(a.veiculoaba)) placa,a.statusaba,a.combustivelaba,p.nomepro,COUNT(*) n,MIN(a.dataaba)::date primeira,MAX(a.dataaba)::date ultima,SUM(a.litrosaba) litros,SUM(a.totalaba) valor,COUNT(*) FILTER(WHERE a.litrosaba<=0 OR a.totalaba<0) invalidos FROM frotas.abastecimentos a LEFT JOIN LATERAL(SELECT nomepro FROM estoque.produtos p WHERE p.codigopro=a.combustivelaba ORDER BY (p.empresapro=a.empresaaba) DESC,p.empresapro LIMIT 1) p ON true WHERE a.dataaba::date BETWEEN $1 AND $2 GROUP BY 1,2,3,4,5 ORDER BY 1,2`,dates);
await q('reboquesHistoricos',`SELECT upper(trim(veiculocon)) cavalo,upper(trim(reboqueumcon)) reboque,COUNT(*) documentos,MIN(dataemissaocon)::date inicio,MAX(dataemissaocon)::date fim FROM logistica.conhecimentos WHERE dataemissaocon::date BETWEEN $1 AND $2 AND statuscon=2 AND NULLIF(trim(reboqueumcon),'') IS NOT NULL GROUP BY 1,2`,dates);
await q('maioresDespesas',`${base.replaceAll('pag.datavencimentopag::date >=','pag.dataemissaopag::date >=').replaceAll('pag.datavencimentopag::date <=','pag.dataemissaopag::date <=')} SELECT id,data,placa_resolvida placa,conta_nome,valor FROM custos_status WHERE proprietario='frota' AND data>='2026-07-01' AND tipo_custo<>'Abastecimento' ORDER BY abs(valor) DESC LIMIT 70`,dates);
await q('centrosAmbiguos',`SELECT centrocustovei::text centro,COUNT(*) n,array_agg(placavei::text) placas FROM frotas.veiculos WHERE COALESCE(situacaovei::text,'')<>'I' AND centrocustovei IS NOT NULL GROUP BY 1 HAVING COUNT(*)>1`);
await q('receitaControle',`SELECT to_char(dataemissaocon,'YYYY-MM') mes,COUNT(*) n,SUM(COALESCE(NULLIF(totalcon,0),valorfretecon,0)) bruto,COUNT(*) FILTER(WHERE NULLIF(trim(veiculocon),'') IS NULL) sem_placa,SUM(COALESCE(NULLIF(totalcon,0),valorfretecon,0)) FILTER(WHERE NULLIF(trim(veiculocon),'') IS NULL) valor_sem_placa FROM logistica.conhecimentos WHERE dataemissaocon::date BETWEEN $1 AND $2 AND statuscon=2 GROUP BY 1 ORDER BY 1`,dates);
if(!out.telemetria) {
 out.telemetria=await getTelemetriaResumoPorPlaca({startDate:'2026-07-01',endDate:'2026-09-30'});
 fs.writeFileSync(`${dir}/evidencias.json`,JSON.stringify(out,null,2));
 console.log('telemetria: '+out.telemetria.byPlate.length+' placas');
}
if(!out.kmMensal) {
 try {out.kmMensal=await carregarKmTelemetriaMensal(out.veiculos.map(v=>v.placavei),{startDate:'2026-04-01',endDate:'2026-09-30'});console.log('kmMensal: consultado');}
 catch(e){out.errors.push({name:'kmMensal',code:e.code||'indisponivel'});console.log('kmMensal: indisponivel');}
 fs.writeFileSync(`${dir}/evidencias.json`,JSON.stringify(out,null,2));
}
await q('dieselDetalhe',`SELECT a.empresaaba,a.codigoaba,a.dataaba::date AS data,upper(trim(a.veiculoaba)) placa,a.postocombustivelaba posto,a.litrosaba litros,a.totalaba AS valor,a.kilometragematualaba odometro,a.kilometrageminicialaba odometro_anterior FROM frotas.abastecimentos a WHERE a.dataaba::date BETWEEN $1 AND $2 AND EXISTS(SELECT 1 FROM estoque.produtos p WHERE p.codigopro=a.combustivelaba AND p.nomepro ILIKE '%DIESEL%') ORDER BY a.dataaba,a.empresaaba,a.codigoaba LIMIT 5000`,['2026-07-01','2026-09-30']);
await q('vinculosConflitantes',`SELECT COUNT(*) n,SUM(r.valorrateioprt) valor FROM financeiro.pagar p JOIN financeiro.pagarrateios r ON (r.empresaprt,r.serieprt,r.duplicataprt,r.parcelaprt,r.fornecedorprt)=(p.empresapag,p.seriepag,p.duplicatapag,p.parcelapag,p.fornecedorpag) WHERE p.dataemissaopag::date BETWEEN $1 AND $2 AND p.statuspag IN(1,2) AND NULLIF(trim(p.veiculopag::text),'') IS NOT NULL AND EXISTS(SELECT 1 FROM frotas.veiculos v WHERE v.centrocustovei=r.centrocustoprt AND v.empresavei=p.empresapag AND upper(trim(v.placavei))<>upper(trim(p.veiculopag::text)))`,dates);
await q('manutencaoMaiores',`${base.replaceAll('pag.datavencimentopag::date >=','pag.dataemissaopag::date >=').replaceAll('pag.datavencimentopag::date <=','pag.dataemissaopag::date <=')} SELECT id,data,placa_resolvida placa,conta_nome,valor FROM custos_status WHERE proprietario='frota' AND data>='2026-07-01' AND conta_nome ILIKE ANY(ARRAY['%manuten%','%equipamento%','%borracharia%','%pneu%','%multa%']) ORDER BY abs(valor) DESC LIMIT 40`,dates);
await q('operacionalNaoConciliado',`${baseCostCte({includeOperational:true})} SELECT origem,COUNT(*) n,COUNT(*)-COUNT(DISTINCT id) repeticoes,SUM(valor) valor FROM custos_status WHERE proprietario='frota' AND origem<>'financeiro.pagar' GROUP BY 1`,['2026-07-01','2026-09-30']);
if(!out.odometrosCobertura){try {
 out.odometrosCobertura=(await getVeiculosPool().query(`SELECT to_char(m.data_hora AT TIME ZONE 'America/Sao_Paulo','YYYY-MM') mes,upper(trim(v.placa)) placa,COUNT(*) pontos,MIN(m.data_hora) primeira,MAX(m.data_hora) ultima,MIN(m.odometro) minimo,MAX(m.odometro) maximo FROM rodobach.veiculos v JOIN rodobach.mensagens_cb m ON m.veiculo_id=v.veiculo_id WHERE m.data_hora>='2026-04-01T00:00:00-03:00' AND m.data_hora<'2026-10-01T00:00:00-03:00' AND m.odometro>0 GROUP BY 1,2 ORDER BY 1,2`)).rows;
 }catch(e){out.errors.push({name:'odometrosCobertura',code:e.code});}
 fs.writeFileSync(`${dir}/evidencias.json`,JSON.stringify(out,null,2));}
if(!out.odometrosAnomalias){try{
 const sql=`WITH p AS(SELECT upper(trim(v.placa)) placa,m.data_hora,m.odometro,lag(m.data_hora) OVER w anterior_data,lag(m.odometro) OVER w anterior_km FROM rodobach.veiculos v JOIN rodobach.mensagens_cb m ON m.veiculo_id=v.veiculo_id WHERE m.data_hora>='2026-07-01T00:00:00-03:00' AND m.data_hora<'2026-10-01T00:00:00-03:00' AND m.odometro>0 WINDOW w AS(PARTITION BY v.placa ORDER BY m.data_hora,m.odometro)) SELECT placa,COUNT(*) pontos,COUNT(*) FILTER(WHERE odometro<anterior_km) regressoes,COUNT(*) FILTER(WHERE extract(epoch FROM data_hora-anterior_data)>86400) lacunas_24h,COUNT(*) FILTER(WHERE odometro-anterior_km>extract(epoch FROM data_hora-anterior_data)/3600*120+2) saltos FROM p GROUP BY 1 ORDER BY 1`;
 out.queries.push({name:'odometrosAnomalias',sql,params:[],banco:'veiculos'});
 out.odometrosAnomalias=(await getVeiculosPool().query(sql)).rows;
 }catch(e){out.errors.push({name:'odometrosAnomalias',code:e.code});}
 fs.writeFileSync(`${dir}/evidencias.json`,JSON.stringify(out,null,2));}
} finally {await clientPool.end();try{await getVeiculosPool().end();}catch{}}
