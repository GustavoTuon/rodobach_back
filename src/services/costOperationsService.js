import {clientPool} from '../db/clientPool.js';
import {pool} from '../db/pool.js';
import {tableName} from '../config.js';
import {getFuelAnalysis} from './fuelAnalysisService.js';
import {previousFuelPeriod} from './fuelComparison.js';

// Read-only operational sources. Never add these values to financial postings.
export async function getCostOperations(period, filters = {}) {
  const prior=previousFuelPeriod(period);
  const owner=['frota','todos','terceiro'].includes(filters.proprietario)?filters.proprietario:'frota';
  const ownerSql=owner==='todos'?'':owner==='frota'?"AND v.tipopropriedadevei='P'":"AND COALESCE(v.tipopropriedadevei,'T')<>'P'";
  const tasks=await Promise.allSettled([
    getFuelAnalysis({startDate:prior.startDate,endDate:period.endDate,proprietario:owner,combustivel:'todos'}),
    clientPool.query(`SELECT json_build_array(o.empresaose,o.serieose,o.codigoose,o.fornecedorose)::text id,
      to_char(COALESCE(o.dataentradaose,o.dataemissaoose),'YYYY-MM-DD') AS data,
      UPPER(TRIM(o.veiculoose)) placa,o.codigoose documento,o.totalose valor,
      o.kilometragematualveiculoose km,o.totalservicosose "laborValue",
      o.totalprodutosterceiroose "partsValue",o.totalprodutosproprioose "ownPartsValue",
      o.fornecedorose::text "supplierCode",v.centrocustovei::text "centerCode",
      (o.horainicioose IS NOT NULL AND o.horaterminoose IS NOT NULL) "hasTimes",
      COALESCE(items.services,'') services
      FROM frotas.ordensservicosexterna o
      LEFT JOIN LATERAL (SELECT v.* FROM frotas.veiculos v WHERE UPPER(TRIM(v.placavei))=UPPER(TRIM(o.veiculoose))
        ORDER BY (v.empresavei=o.empresaose) DESC,v.empresavei LIMIT 1) v ON true
      LEFT JOIN LATERAL (SELECT string_agg(DISTINCT s.nomesrv,' / ') services
        FROM frotas.ordensservicosexternaservicos i LEFT JOIN estoque.servicos s ON s.empresasrv=i.empresaoes AND s.codigosrv=i.servicooes
        WHERE (i.empresaoes,i.serieoes,i.codigooes,i.fornecedoroes)=(o.empresaose,o.serieose,o.codigoose,o.fornecedorose)
        AND i.quantidadeoes>0) items ON true
      WHERE COALESCE(o.dataentradaose,o.dataemissaoose) BETWEEN $1::date AND $2::date ${ownerSql}
      ORDER BY data DESC,id`,[prior.startDate,period.endDate]),
    pool.query(`SELECT placa,tipo_controle AS control FROM ${tableName('automacao_mensagem_manutencao')} WHERE ativo=true`),
  ]);
  const [fuel,maintenance,plans]=tasks;
  return {
    period,prior,generatedAt:new Date().toISOString(),
    fuel:{available:fuel.status==='fulfilled',rows:fuel.status==='fulfilled'?fuel.value.lancamentos:[],
      message:fuel.status==='rejected'?'Não foi possível consultar os abastecimentos. Tente atualizar.':null},
    maintenance:{available:maintenance.status==='fulfilled',rows:maintenance.status==='fulfilled'?maintenance.value.rows.map(row=>({...row,valor:Number(row.valor),km:Number(row.km),laborValue:Number(row.laborValue),partsValue:Number(row.partsValue),ownPartsValue:Number(row.ownPartsValue)})):[],
      message:maintenance.status==='rejected'?'Não foi possível consultar as ordens de serviço. Tente atualizar.':null},
    plans:{available:plans.status==='fulfilled',rows:plans.status==='fulfilled'?plans.value.rows:[]},
  };
}
