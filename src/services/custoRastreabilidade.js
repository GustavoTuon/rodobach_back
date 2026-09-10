import {clientPool} from '../db/clientPool.js';
export async function getCustoRastreabilidade(id) {
  if(typeof id!=='string'||id.length>300) throw Object.assign(new Error('Identificador inválido.'),{status:400});
  const [source,empresa,serie,codigo,fornecedor,...rest]=id.split(':');
  const result={id,origem:source,referencia:'',documentos:[],itens:[],aviso:'Não há detalhamento de produtos disponível para esta origem.'};
  async function items(table,suffix,product,key,label) {
    const {rows}=await clientPool.query(`SELECT i.${product}::text codigo, COALESCE(p.nomepro,'Item '||i.${product}::text) descricao,
      i.quantidade${suffix} quantidade,i.valorunitario${suffix} unitario,i.totalitem${suffix} total,i.veiculo${suffix} placa
      FROM ${table} i LEFT JOIN LATERAL (SELECT nomepro FROM estoque.produtos p WHERE p.codigopro=i.${product}
        ORDER BY (p.empresapro=i.empresa${suffix}) DESC NULLS LAST,p.empresapro LIMIT 1) p ON TRUE
      WHERE i.empresa${suffix}::text=$1 AND i.serie${suffix}::text=$2 AND i.codigo${suffix}::text=$3 AND i.fornecedor${suffix}::text=$4 ORDER BY i.sequencia${suffix}`,key);
    result.itens.push(...rows.map(r=>({...r,documento:label})));
  }
  let notes=[];
  if(source==='pagar') {
    // pagar ID: empresa, série, duplicata, parcela, fornecedor, centro, conta.
    const parcela=fornecedor, supplier=rest[0];
    if(!supplier) throw Object.assign(new Error('Identificador incompleto.'),{status:400});
    const {rows}=await clientPool.query(`SELECT documentopag documento,valorduplicatapag valor_parcela,valorabertopag aberto,observacaopag historico
      FROM financeiro.pagar WHERE empresapag::text=$1 AND seriepag::text=$2 AND duplicatapag::text=$3 AND parcelapag::text=$4 AND fornecedorpag::text=$5`,[empresa,serie,codigo,parcela,supplier]);
    if(!rows.length)throw Object.assign(new Error('Lançamento não encontrado.'),{status:404});
    result.financeiro=rows[0];result.referencia=`Duplicata ${serie}/${codigo} · parcela ${parcela}`;
    result.rateios=(await clientPool.query(`SELECT centrocustoprt centro,contafinanceiraprt conta,valorrateioprt valor FROM financeiro.pagarrateios
      WHERE empresaprt::text=$1 AND serieprt::text=$2 AND duplicataprt::text=$3 AND parcelaprt::text=$4 AND fornecedorprt::text=$5`,[empresa,serie,codigo,parcela,supplier])).rows;
    const linked=(await clientPool.query(`SELECT serienotafiscalnfn serie,codigonotafiscalnfn::text codigo FROM compras.notasfiscaisentradafaturanotasfiscais
      WHERE empresanfn::text=$1 AND serienfn::text=$2 AND codigonfn::text=$3 AND fornecedornfn::text=$4`,[empresa,serie,codigo,supplier])).rows;
    notes=linked.map(n=>({key:[empresa,n.serie,n.codigo,supplier],vinculo:'Vínculo pela fatura no ERP'}));
    if(!notes.length)notes=[{key:[empresa,serie,codigo,supplier],vinculo:'Correspondência de empresa, série, número e fornecedor; vínculo financeiro não confirmado'}];
    result.aviso='O campo documento pode estar vazio mesmo com duplicata cadastrada. Os itens abaixo são da nota completa e podem incluir outros veículos e parcelas. Não foram atribuídos automaticamente ao rateio selecionado.';
  } else if(source==='nf-entrada') {
    notes=[{key:[empresa,serie,codigo,fornecedor],vinculo:'Nota de origem do lançamento'}];
  } else if(source==='os-produto'||source==='os-servico') {
    const key=[empresa,serie,codigo,fornecedor];
    result.referencia=`OS ${serie}/${codigo}`;
    await items('frotas.ordensservicosexternaprodutos','oep','produtooep',key,result.referencia);
    await items('frotas.ordensservicosexternaservicos','oes','servicooes',key,result.referencia);
    result.aviso='Produtos e serviços da ordem completa. Confira a placa de cada item; a linha selecionada pode representar apenas um deles.';
  }
  for(const note of notes) {
    const {rows}=await clientPool.query(`SELECT codigonfe numero,serienfe serie,totalnfe total,observacaonfe observacao FROM compras.notasfiscaisentrada
      WHERE empresanfe::text=$1 AND serienfe::text=$2 AND codigonfe::text=$3 AND fornecedornfe::text=$4`,note.key);
    if(!rows.length)continue;
    result.documentos.push({...rows[0],vinculo:note.vinculo});
    await items('compras.notasfiscaisentradaprodutos','nep','produtonep',note.key,`NF ${rows[0].serie}/${rows[0].numero}`);
  }
  if(source==='nf-entrada')result.aviso='Itens da nota de origem completa. O total da nota pode incluir descontos, impostos e itens de outros veículos.';
  return result;
}
