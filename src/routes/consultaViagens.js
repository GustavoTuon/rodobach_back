import {getTripManifestos} from '../services/tripManifestos.js';
import express from "express";
import { z } from "zod";
import { clientPool } from "../db/clientPool.js";
import { auditTripCtes } from "../services/tripCteAudit.js";
import { getTripIndicators } from "../services/tripIndicators.js";
export const consultaViagensRouter = express.Router();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v);
const querySchema = z.object({numero:z.string().regex(/^\d{1,9}$/).optional(),motorista:z.string().trim().max(120).optional(),placa:z.string().max(8).optional(),inicio:date.optional(),fim:date.optional(),page:z.coerce.number().int().min(1).max(10000).default(1)}).refine(v => !v.inicio || !v.fim || v.inicio <= v.fim);
const header = `SELECT v.empresacvg AS empresa, v.codigocvg AS numero, v.veiculocvg AS placa,
  v.datasaidacvg::text AS saida, v.datachegadacvg::text AS chegada, v.dataacertocvg::text AS acerto,
  v.horasaidacvg::text AS "horaSaida", v.horachegadacvg::text AS "horaChegada",
  v.kmsaidacvg AS "kmSaida", v.kmchegadacvg AS "kmChegada", v.kmdiferencacvg AS "kmPercorrido",
  v.kmpercorridovaziocvg AS "kmVazio", v.reboqueumcvg AS reboque,
  v.totalfretescvg AS fretes, v.totaldespesascvg AS despesas, v.totalabastecimentoscvg AS abastecimentos,
  v.totalpedagiocvg AS pedagios, v.totaldiariascvg AS diarias, v.valorcomissaomotoristacvg AS comissao,
  v.totalimpostoscvg AS impostos, v.totalviagemcvg AS "totalViagem", v.saldomotoristacvg AS "saldoMotorista",
  v.totallitroscvg AS litros, v.mediakmcvg AS media, v.totalpesotransportadocvg AS peso,
  v.quantidadeentregascvg AS entregas, v.observacaocvg AS observacao, v.obsprincipalcvg AS "observacaoPrincipal",
  COALESCE(m.nomemot, v.motoristacvg::text) AS motorista, COALESCE(s.nomescv, v.statuscvg::text) AS status
  FROM logistica.controleviagens v
  LEFT JOIN frotas.motoristas m ON m.empresamot=v.empresacvg AND m.codigomot=v.motoristacvg
  LEFT JOIN logistica.statuscontroleviagens s ON s.codigoscv=v.statuscvg`;
export function tripFilters(input) {
  const parsed=querySchema.safeParse(input);
  if(!parsed.success) return null;
  const q=parsed.data, params=[], clauses=[];
  const add=v=>{params.push(v);return `$${params.length}`;};
  if(q.numero) clauses.push(`v.codigocvg = ${add(Number(q.numero))}`);
  if(q.motorista) clauses.push(`EXISTS (SELECT 1 FROM frotas.motoristas mf WHERE mf.empresamot=v.empresacvg AND mf.codigomot=v.motoristacvg AND strpos(lower(mf.nomemot),lower(${add(q.motorista)}))>0)`);
  if(q.placa) clauses.push(`regexp_replace(upper(v.veiculocvg), '[^A-Z0-9]', '', 'g') LIKE ${add('%'+q.placa.toUpperCase().replace(/[^A-Z0-9]/g,'')+'%')}`);
  if(q.inicio) clauses.push(`v.datasaidacvg >= ${add(q.inicio)}::date`);
  if(q.fim) clauses.push(`v.datasaidacvg <= ${add(q.fim)}::date`);
  return {where:clauses.length?' WHERE '+clauses.join(' AND '):'',params,page:q.page};
}
consultaViagensRouter.get('/financeiro/consulta-viagens',async(req,res,next)=>{
  const filter=tripFilters(req.query);if(!filter)return res.status(400).json({error:'Filtros inválidos. Confira número e período.'});
  try {
    const {where,params,page}=filter;
    const [count,rows]=await Promise.all([
      clientPool.query(`SELECT count(*)::int AS total FROM logistica.controleviagens v${where}`,params),
      clientPool.query(`${header}${where} ORDER BY v.datasaidacvg DESC NULLS LAST,v.empresacvg,v.codigocvg DESC LIMIT 30 OFFSET $${params.length+1}`,[...params,(page-1)*30]),
    ]);
    res.json({itens:rows.rows,total:count.rows[0].total,page,pageSize:30});
  }catch(error){next(error);}
});
consultaViagensRouter.get('/financeiro/consulta-viagens/:empresa/:numero/indicadores',async(req,res,next)=>{
  const empresa=Number(req.params.empresa),numero=Number(req.params.numero);
  if(!Number.isSafeInteger(empresa)||empresa<1||!Number.isSafeInteger(numero)||numero<1)return res.status(400).json({error:'Viagem inválida.'});
  const period=z.object({mes:z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/).optional()}).safeParse(req.query);
  if(!period.success)return res.status(400).json({error:'Mês inválido. Selecione o mês do veículo.'});
  try {
    const {rows}=await clientPool.query(`${header} WHERE v.empresacvg=$1 AND v.codigocvg=$2`,[empresa,numero]);
    if(!rows[0])return res.status(404).json({error:'Viagem não encontrada.'});
    res.json(await getTripIndicators(rows[0],period.data));
  }catch(error){next(error);}
});
consultaViagensRouter.get('/financeiro/consulta-viagens/:empresa/:numero',async(req,res,next)=>{
  const empresa=Number(req.params.empresa),numero=Number(req.params.numero);
  if(!Number.isSafeInteger(empresa)||empresa<1||!Number.isSafeInteger(numero)||numero<1)return res.status(400).json({error:'Viagem inválida.'});
  try {
    const {rows}=await clientPool.query(`${header} WHERE v.empresacvg=$1 AND v.codigocvg=$2`,[empresa,numero]);
    if(!rows[0])return res.status(404).json({error:'Viagem não encontrada.'});
    const [fretes,despesas,abastecimentos]=await Promise.all([
      clientPool.query(`SELECT f.sequenciacvf AS sequencia,f.datacvf::text AS data,f.conhecimentocvf AS documento,f.serieconhecimentocvf AS serie,
        f.empresaconhecimentocvf AS "empresaDocumento", o.nomecid AS origem,d.nomecid AS destino,f.pesocvf AS peso,
        f.valorfretecvf AS valor, f.notasfiscaiscvf AS notas, f.observacaocvf AS observacao,
        COALESCE(c.nomecli,f.clientecvf::text) AS cliente
        FROM logistica.controleviagensfretes f
        LEFT JOIN localidades.cidades o ON o.codigocid=f.cidadeorigemcvf
        LEFT JOIN localidades.cidades d ON d.codigocid=f.cidadedestinocvf
        LEFT JOIN LATERAL (SELECT nomecli FROM gerais.clientes WHERE codigocli=f.clientecvf ORDER BY (empresacli=f.empresacvf) DESC,empresacli LIMIT 1) c ON true
        WHERE f.empresacvf=$1 AND f.codigocvf=$2 ORDER BY f.sequenciacvf`,[empresa,numero]),
      clientPool.query(`SELECT d.sequenciacvd AS sequencia,d.datacvd::text AS data,d.despesaviagemcvd AS tipo,d.valorcvd AS valor,
        d.documentocvd AS documento,d.notafiscalcvd AS nota,d.observacaocvd AS observacao,
        COALESCE(f.nome,d.fornecedorcvd::text) AS fornecedor
        FROM logistica.controleviagensdespesas d
        LEFT JOIN LATERAL (SELECT COALESCE(NULLIF(fantasiafor,''),nomefor) AS nome FROM gerais.fornecedores WHERE codigofor=d.fornecedorcvd ORDER BY (empresafor=d.empresacvd) DESC,empresafor LIMIT 1) f ON true
        WHERE d.empresacvd=$1 AND d.codigocvd=$2 ORDER BY d.sequenciacvd`,[empresa,numero]),
      clientPool.query(`SELECT a.empresaaba AS empresa,a.codigoaba AS codigo,a.dataaba::text AS data,a.litrosaba AS litros,a.valorlitroaba AS "valorLitro",a.totalaba AS valor,a.kilometragematualaba AS km,a.documentoaba AS documento
        FROM frotas.abastecimentos a WHERE (a.empresaviagemaba=$1 AND a.viagemaba=$2)
        OR EXISTS(SELECT 1 FROM logistica.controleviagensabastecimentos v WHERE v.empresacva=$1 AND v.codigocva=$2 AND v.empresaabastecimentocva=a.empresaaba AND v.abastecimentocva=a.codigoaba)
        ORDER BY a.dataaba,a.empresaaba,a.codigoaba`,[empresa,numero]),
    ]);
    let conferencia;
    try { conferencia = await auditTripCtes(rows[0]); }
    catch (error) {
      console.error('Falha na conferência de CT-es da viagem:', error.code || 'consulta');
      conferencia = {disponivel:false,mensagem:'Não foi possível conferir os CT-es. Tente carregar a viagem novamente.'};
    }
    let manifestos = [], manifestosDisponiveis = true;
    try { manifestos = await getTripManifestos(rows[0]); }
    catch (error) { manifestosDisponiveis = false; console.error('Falha ao consultar manifestos:', error.code || 'consulta'); }
    res.json({manifestos,manifestosDisponiveis,viagem:rows[0],fretes:fretes.rows,despesas:despesas.rows,abastecimentos:abastecimentos.rows,conferencia});
  }catch(error){next(error);}
});
