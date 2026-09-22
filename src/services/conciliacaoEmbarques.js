import { clientPool } from '../db/clientPool.js';
import { getDreEmpresarial } from './dreEmpresarialService.js';
import { documentosContabilizados } from './documentosEmbarques.js';

const key=(e,s,c)=>JSON.stringify([String(e),String(s||'').trim(),String(c)]);
const region=uf=>Object.entries({Norte:['AC','AP','AM','PA','RO','RR','TO'],Nordeste:['AL','BA','CE','MA','PB','PE','PI','RN','SE'],'Centro-Oeste':['DF','GO','MT','MS'],Sudeste:['ES','MG','RJ','SP'],Sul:['PR','RS','SC']}).find(([,ufs])=>ufs.includes(String(uf||'').trim()))?.[0] || 'Não informada';
export function resolveDataEmbarque(documents, operationalDates = []) {
  const originals = documents.filter(d=>Number(d.status)!==3 && Number(d.tipo)===0 && d.chave && d.data_documento);
  const normalDocuments = documents.filter(d=>Number(d.status)!==3 && Number(d.tipo)===0 && d.data_documento);
  const dates = (originals.length ? originals : normalDocuments).map(d=>d.data_documento).sort();
  if (dates.length) return {data:dates[0],criterio:originals.length?'Emissão do primeiro CT-e original':'Emissão do primeiro documento original'};
  const departures = operationalDates.filter(d=>d.id.startsWith('V:'));
  return {data:(departures.length?departures:operationalDates).map(d=>d.date).filter(Boolean).sort()[0] || null,criterio:'Data operacional (sem documento original)'};
}
export function components(documents){
  const parent=new Map();
  const root=k=>{if(!parent.has(k))parent.set(k,k);if(parent.get(k)!==k)parent.set(k,root(parent.get(k)));return parent.get(k);};
  const join=(a,b)=>parent.set(root(a),root(b));
  const fiscal=new Map();
  for(const d of documents){d.id=key(d.empresa,d.serie,d.codigo);root(d.id);if(d.chave){if(fiscal.has(d.chave))join(d.id,fiscal.get(d.chave));else fiscal.set(d.chave,d.id);}}
  for(const d of documents)for(const [s,c] of [[d.serie_orc,d.codigo_orc],[d.serie_cte,d.codigo_cte]])if(s&&c){const other=key(d.empresa,s,c);if(parent.has(other))join(d.id,other);}
  return {root,join};
}

export async function conciliarEmbarques(periodos,regioes,vendedor){
  const dre=[];for(const p of periodos)dre.push(await getDreEmpresarial({...p,tipo:'todos',status:'todos'}));
  const {rows:docs}=await clientPool.query(`SELECT con.empresacon AS empresa, con.seriecon AS serie, con.codigocon AS codigo,
    NULLIF(TRIM(con.chavectecon),'') AS chave, con.serieorcamentovinculadocon AS serie_orc, con.codigoorcamentovinculadocon AS codigo_orc,
    con.seriecteorcamentocon AS serie_cte, con.codigocteorcamentocon AS codigo_cte,
    con.serieconhecimentoreferenciadocon AS serie_ref, con.codigoconhecimentoreferenciadocon AS codigo_ref,
    con.dataemissaocon::date::text AS data_documento,
    NULLIF(TRIM(con.chaveorcamentocon),'') AS chave_orcamento,
    UPPER(NULLIF(TRIM(con.veiculocon::text), '')) AS placa,
    origem.nomecid AS origem, cid.nomecid AS destino,
    COALESCE(con.empresaviagemcon,con.empresacon) AS empresa_viagem, con.viagemcon AS viagem,
    CASE WHEN con.tomadorservicoctecon=4 THEN COALESCE(con.tomadorservicooutroscon,con.clientecon)
      WHEN con.tomadorservicoctecon=3 THEN COALESCE(con.destinatariocon,con.clientecon)
      WHEN con.tomadorservicoctecon=2 THEN COALESCE(con.recebedorcon,con.clientecon)
      WHEN con.tomadorservicoctecon=1 THEN COALESCE(con.expedidorcon,con.clientecon) ELSE con.clientecon END AS cliente,
    con.statuscon AS status, con.tipoctecon AS tipo, uf.abreviaturaest AS uf,
    COALESCE(p.nomepes,'Não informado') AS vendedor
    FROM logistica.conhecimentos con
    LEFT JOIN localidades.cidades cid ON cid.codigocid=con.cidadeentregacon
    LEFT JOIN localidades.cidades origem ON origem.codigocid=con.cidadecoletacon
    LEFT JOIN localidades.estados uf ON uf.codigoest=cid.estadocid
    LEFT JOIN LATERAL (SELECT nomepes FROM gerais.pessoas WHERE codigorepresentantepes=con.representantecon ORDER BY nomepes LIMIT 1) p ON true`);
  const graph=components(docs), byId=new Map(docs.map(d=>[d.id,d]));
  const {rows:links}=await clientPool.query(`SELECT v.empresa, v.serie, v.duplicata::text AS duplicata, NULL::text AS parcela,
    v.serieconhecimento AS serie_doc,v.codigoconhecimento AS codigo_doc,v.serieorcamento AS serie_orc,v.codigoorcamento AS codigo_orc
    FROM financeiro.receberconhecimentosvinculados v
    UNION ALL SELECT empresarcc,seriercc,duplicatarcc::text,parcelarcc::text,NULL,conhecimentorcc,NULL,NULL FROM financeiro.receberconhecimentos`);
  const index=new Map();
  for(const l of links){const k=key(l.empresa,l.serie,l.duplicata);if(!index.has(k))index.set(k,[]);index.get(k).push(l);
    const a=key(l.empresa,l.serie_doc,l.codigo_doc),b=key(l.empresa,l.serie_orc,l.codigo_orc);
    if(byId.has(a)&&byId.has(b))graph.join(a,b);
  }
  const countedDocuments=documentosContabilizados(docs,d=>graph.root(d.id));
  const {rows:clients}=await clientPool.query('SELECT DISTINCT ON (codigocli) codigocli,COALESCE(NULLIF(fantasiacli,\'\'),nomecli) AS nome FROM gerais.clientes ORDER BY codigocli,empresacli');
  const clientNames=new Map(clients.map(c=>[String(c.codigocli),c.nome]));
  const documentDetail=d=>({id:d.id,empresa:d.empresa,serie:d.serie,codigo:d.codigo,clienteCodigo:String(d.cliente??'sem-cliente'),cliente:clientNames.get(String(d.cliente))||String(d.cliente??'Sem cliente'),placa:d.placa,origem:d.origem,destino:d.destino,data:d.data_documento,tipo:Number(d.tipo),referencia:d.codigo_ref?`${d.serie_ref}/${d.codigo_ref}`:null});
  const byCode=new Map();for(const d of docs){const k=key(d.empresa,'',d.codigo);if(!byCode.has(k))byCode.set(k,[]);byCode.get(k).push(d);}
  const representatives=new Map();for(const d of docs){const k=graph.root(d.id),old=representatives.get(k);if(!old||(d.chave&&!old.chave))representatives.set(k,d);}
  const result=new Map(), diagnostics=[];
  const suffix=['Atual','Anterior','Retrasado'];
  for(let i=0;i<3;i++){
    const revenue=dre[i].rows.filter(r=>r.categoriaDre==='RECEITA BRUTA');
    let unidentified=0,ambiguous=0;const counted=new Set();
    for(const r of revenue){
      const source=r.detailKey;const resolved=new Map();let uncertain=false;
      const resolve=(s,c)=>{if(c==null)return;const matches=s?[byId.get(key(source.empresa,s,c))].filter(Boolean):(byCode.get(key(source.empresa,'',c))||[]);const roots=[...new Set(matches.map(d=>graph.root(d.id)))];if(roots.length>1){uncertain=true;return;}for(const d of matches)resolved.set(graph.root(d.id),representatives.get(graph.root(d.id)));};
      for(const l of index.get(key(source.empresa,source.serie,source.documento))||[]){if(l.parcela!=null&&String(l.parcela)!==String(source.parcela))continue;resolve(l.serie_doc,l.codigo_doc);resolve(l.serie_orc,l.codigo_orc);}
      if(!resolved.size)for(const match of (r.historico||'').matchAll(/([A-Za-z0-9]+)\/([0-9]+)-[A-Za-z0-9]+/g))resolve(match[1],match[2]);
      // A title spanning different freights has no reliable per-freight price.
      // Keep its entire financial value once and flag mixed attribution.
      const destinations=[...new Set([...resolved.values()].map(d=>region(d.uf)))];
      const sellers=[...new Set([...resolved.values()].map(d=>d.vendedor))];
      const reg=destinations.length===1?destinations[0]:destinations.length?'Múltiplas regiões':'Não informada';
      const seller=sellers.length===1?sellers[0]:sellers.length?'Múltiplos vendedores':'Não informado';
      if(regioes.length&&!regioes.includes(reg))continue;if(vendedor&&vendedor!==seller)continue;
      const cid=String(r.clienteCodigo??'sem-cliente');if(!result.has(cid))result.set(cid,{clienteCodigo:cid,cliente:r.pessoaNome||'Sem cliente',regions:new Set(),sellers:new Set(),counts:[new Set(),new Set(),new Set()],values:[0,0,0],unidentified:[0,0,0]});
      const row=result.get(cid);row.regions.add(reg);row.sellers.add(seller);row.values[i]+=r.valor;
      if(!resolved.size||uncertain){unidentified+=r.valor;row.unidentified[i]+=r.valor;}
      if(destinations.length>1||sellers.length>1)ambiguous+=r.valor;
      // Financial titles affect revenue only. Documents are counted independently by their own issue date.
    }
    diagnostics.push({periodo:periodos[i],receitaDre:dre[i].summary.receitaBruta,receitaSemFrete:Math.round(unidentified*100)/100,receitaMultiplasAtribuicoes:Math.round(ambiguous*100)/100,embarquesUnicos:counted.size,fretesSemTitulo:dre[i].cteAudit});
  }
  for(let i=0;i<3;i++){
    const details=[];
    for(const entry of countedDocuments){
      const d=entry.documento;
      if(d.data_documento<periodos[i].startDate||d.data_documento>periodos[i].endDate)continue;
      const reg=region(d.uf),seller=d.vendedor;
      if(regioes.length&&!regioes.includes(reg))continue;
      if(vendedor&&vendedor!==seller)continue;
      const cid=String(d.cliente??'sem-cliente');
      if(!result.has(cid))result.set(cid,{clienteCodigo:cid,cliente:clientNames.get(cid)||'Sem cliente',regions:new Set(),sellers:new Set(),counts:[new Set(),new Set(),new Set()],values:[0,0,0],unidentified:[0,0,0]});
      const row=result.get(cid);row.regions.add(reg);row.sellers.add(seller);row.counts[i].add(entry.id);
      details.push({...documentDetail(d),categoria:entry.categoria,vinculados:entry.vinculados.map(documentDetail)});
    }
    diagnostics[i].documentos=details;
    diagnostics[i].documentosUnicos=details.length;
    diagnostics[i].ctes=details.filter(d=>d.categoria==='CT-e').length;
    diagnostics[i].orcamentos=details.filter(d=>d.categoria!=='CT-e').length;
    // Preserve quantity field names for existing API consumers.
    diagnostics[i].embarquesUnicos=details.length;
  }
  const rows=[...result.values()].map(r=>{const out={clienteCodigo:r.clienteCodigo,cliente:r.cliente,regiao:[...r.regions].join(', '),vendedor:[...r.sellers].join(', ')};suffix.forEach((s,i)=>{out['embarques'+s]=r.counts[i].size;out['faturamento'+s]=Math.round(r.values[i]*100)/100;out['semFrete'+s]=Math.round(r.unidentified[i]*100)/100;});out.diferenca=out.embarquesAtual-out.embarquesAnterior;out.variacaoPct=out.embarquesAnterior?Math.round(out.diferenca/out.embarquesAnterior*10000)/100:null;return out;});
  const resumo={};for(const s of suffix){resumo['embarques'+s]=diagnostics[suffix.indexOf(s)].embarquesUnicos;resumo['faturamento'+s]=Math.round(rows.reduce((n,r)=>n+r['faturamento'+s],0)*100)/100;}resumo.diferenca=resumo.embarquesAtual-resumo.embarquesAnterior;
  return {rows:rows.sort((a,b)=>a.diferenca-b.diferenca),resumo,conciliacao:diagnostics,filtros:{vendedores:[...new Set(docs.map(d=>d.vendedor))].sort()}};
}
