import { z } from 'zod';
import { clientPool } from '../db/clientPool.js';

const date = z.iso.date();
const optionalDate = date.nullable();
const short = z.string().trim().max(200);
export const registroSchema = z.object({
 id: z.uuid(), version: z.number().int().nonnegative(),
 tipo: z.enum(['advertencia_verbal','advertencia_escrita','avaria','acidente','ferias','epi','uniforme','celular']),
 data: date, prazo: optionalDate,
 status: z.enum(['pendente','concluido','cancelado']),
 descricao: z.string().trim().min(1).max(5000), responsavel: short.min(1),
 detalhes: z.object({
  placa: short.optional(), valor: z.number().min(0).max(999999999).nullable().optional(),
  ciencia: optionalDate.optional(), inicio: optionalDate.optional(), fim: optionalDate.optional(), retorno: optionalDate.optional(),
  item: short.optional(), tamanho: short.optional(), quantidade: z.number().int().min(1).max(10000).optional(),
  ca: short.optional(), troca: optionalDate.optional(), devolucao: optionalDate.optional(),
  imei: z.string().regex(/^$|^\d{15}$/).optional(), imei2: z.string().regex(/^$|^\d{15}$/).optional(),
  condicao: short.optional(), cancelamento: z.string().trim().max(1000).optional(),
 }).strict(),
 anexos: z.array(z.object({nome: z.string().trim().min(1).max(180), data: z.string().max(1400000).regex(/^data:(application\/pdf|image\/(png|jpeg|webp));base64,[A-Za-z0-9+/]+={0,2}$/)}).strict()).max(3),
}).strict().superRefine((b,ctx)=>{
 const invalid = message => ctx.addIssue({code:'custom',message});
 const d=b.detalhes;
 if(b.prazo && b.prazo<b.data)invalid('O prazo deve ser igual ou posterior à data do registro.');
 if(b.status==='cancelado'&&!d.cancelamento)invalid('Informe o motivo do cancelamento.');
 if(b.tipo==='ferias'&&(!d.inicio||!d.fim||!d.retorno||d.fim<d.inicio||d.retorno<=d.fim))invalid('Informe início, fim e retorno das férias em ordem.');
 if(['epi','uniforme'].includes(b.tipo)&&(!d.item||!d.quantidade))invalid('Informe o item e a quantidade.');
 if(b.tipo==='celular'&&(!d.item||!d.imei))invalid('Informe o aparelho e o IMEI com 15 dígitos.');
 if(d.devolucao&&d.devolucao<b.data)invalid('A devolução não pode anteceder a entrega.');
 if(d.troca&&d.troca<b.data)invalid('A próxima troca não pode anteceder a entrega.');
 if(d.ciencia&&d.ciencia<b.data)invalid('A ciência não pode anteceder o registro.');
 for(const a of b.anexos){
  const buffer=Buffer.from(a.data.split(',')[1],'base64');
  const type=a.data.split(';')[0];
  const valid=type==='data:application/pdf'?buffer.subarray(0,5).toString()==='%PDF-':type==='data:image/png'?buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='data:image/jpeg'?buffer[0]===255&&buffer[1]===216&&buffer[2]===255:buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WEBP';
  if(!valid||buffer.length>1048576)invalid('Cada anexo deve ser PDF, PNG, JPG ou WebP válido de até 1 MB.');
 }
});

// The employee PK is global in this ERP. Company is metadata, never part of identity.
export async function erpColaboradores(codigo=null){
 const {rows}=await clientPool.query(`SELECT c.codigocol AS codigo,c.empresacol AS empresa,
 COALESCE(NULLIF(trim(p.nomepes),''),NULLIF(trim(f.nomefor),''),'Colaborador '||c.codigocol) AS nome,
 p.ativopes AS cadastro_situacao,
 (p.ativopes='S' AND (c.datademissaocol IS NULL OR c.datademissaocol>(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date)) AS ativo,
 to_char(c.dataadmissaocol,'YYYY-MM-DD') AS admissao,to_char(c.datademissaocol,'YYYY-MM-DD') AS demissao,
 COALESCE(trim(ca.nomecac),'') AS cargo
 FROM gerais.colaboradores c
 LEFT JOIN gerais.fornecedores f ON f.codigofor=c.codigocol
 LEFT JOIN LATERAL (SELECT nomepes,ativopes FROM gerais.pessoas WHERE codigocolaboradorpes=c.codigocol ORDER BY codigopes LIMIT 1) p ON true
 LEFT JOIN gerais.cargoscolaboradores ca ON ca.codigocac=c.cargocol
 WHERE ($1::integer IS NULL OR c.codigocol=$1) ORDER BY nome,c.codigocol`,[codigo]);
 return rows;
}
