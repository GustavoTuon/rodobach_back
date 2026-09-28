import fs from 'node:fs';
import ExcelJS from 'exceljs';

const read=name=>JSON.parse(fs.readFileSync(`../.local-logs/${name}.json`,'utf8'));
const fuel=read('custo-vazio-telemetria');
const base=read('custo-vazio-rateios-base');
const odos=read('custo-vazio-odometros-rateio');
const arla=read('custo-vazio-arla-rateio');
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function classify(row){
 const n=norm(row.conta_nome);
 if(row.tipo_custo==='Abastecimento')return 'Excluído: combustível substituído';
 if(/financiamento|aquisicao de novos veiculos/.test(n))return 'Parcelas e aquisição';
 if(/adiantamento/.test(n))return 'Excluído: adiantamento a conciliar';
 if(/multa|icms|seguradora de riscos/.test(n))return 'Excluído: extraordinário ou carga';
 if(/pedagio/.test(n))return 'Pedágio histórico';
 if(/salario|despesas de viagens/.test(n))return 'Pessoal e viagens';
 if(/manutencao|borracharia|pneu|equipamento|lavacao/.test(n))return 'Manutenção, pneus e equipamentos';
 if(/seguro|ipva|licenciamento|rastreamento/.test(n))return 'Seguro, taxas e rastreamento';
 if(n==='despesas diversas')return 'Outros atribuídos';
 throw new Error(`Conta sem classificação: ${row.conta_nome}`);
}
const groups=['ARLA','Manutenção, pneus e equipamentos','Pessoal e viagens','Seguro, taxas e rastreamento','Outros atribuídos'];
const details=[],summary=[];
for(const s of fuel.summary.filter(s=>s.dieselPorKm!=null)){
 const linked=base.links.filter(l=>l.placa_principal===s.placa);
 const plates=[...new Set([s.placa,...linked.flatMap(l=>[l.placa_reboque1,l.placa_reboque2,l.placa_reboque3]).filter(Boolean)])];
 const a=odos.find(o=>o.placa===s.placa&&o.lado==='inicio');
 const b=odos.find(o=>o.placa===s.placa&&o.lado==='fim');
 const km=Number(b.odometro)-Number(a.odometro);
 if(!(km>0))throw new Error(`Sem km: ${s.placa}`);
 const costs=base.costs.filter(c=>plates.includes(c.placa));
 const sums={};
 for(const c of costs){const category=classify(c);sums[category]=(sums[category]||0)+c.valor;details.push({principal:s.placa,...c,category,km,porKm:c.valor/km});}
 const arlaRows=arla.filter(c=>plates.includes(c.placa));
 sums.ARLA=arlaRows.reduce((n,c)=>n+c.valor,0);
 for(const c of arlaRows)details.push({principal:s.placa,placa:c.placa,conta_nome:'ARLA operacional (por data de abastecimento)',category:'ARLA',valor:c.valor,registros:c.registros,km,porKm:c.valor/km});
 const allocated=groups.reduce((n,g)=>n+(sums[g]||0),0)/km;
 const toll=(sums['Pedágio histórico']||0)/km;
 const financing=(sums['Parcelas e aquisição']||0)/km;
 summary.push({placa:s.placa,implementos:plates.slice(1).join(', '),km,diesel:s.dieselPorKm,arla:sums.ARLA/km,manutencao:(sums[groups[1]]||0)/km,pessoal:(sums[groups[2]]||0)/km,fixos:(sums[groups[3]]||0)/km,outros:(sums[groups[4]]||0)/km,rateio:allocated,operacional:s.dieselPorKm+allocated,pedagio:toll,parcelas:financing,comParcelas:s.dieselPorKm+allocated+financing,comParcelasPedagio:s.dieselPorKm+allocated+financing+toll,sums,alerta:[s.placa==='RXO6C18'?'Telemetria provisória; odômetro com anomalias.':'',!arlaRows.length?'ARLA sem lançamento encontrado; não comprova ausência de consumo.':''].filter(Boolean).join(' ')});
}
const notes=[
 'Período: 01/08 a 24/09/2026; cinco veículos com referência de diesel aprovada pelo usuário.',
 'Diesel: mantida a estimativa anterior em dias completos entre SMs (vazio provável), calculada sem arredondamento intermediário.',
 'Rateio adicional = custos atribuídos à placa/conjunto no período divididos pelos km totais (carregado + vazio) do mesmo período. Não se dividem todos os custos apenas pelos km vazios.',
 'Km: diferença entre primeiro odômetro positivo de 01/08 e último de 24/09, horário de Brasília. Pontos próximos da meia-noite; pequena distância nas bordas pode faltar. Valores conferidos com hodômetros dos relatórios diários; RXO6C18 difere 30 km na abertura e permanece provisória. A soma das distâncias diárias tinha repetições/divergências e não foi usada.',
 'Custos financeiros: rateios de contas a pagar status 1 ou 2, por vencimento, incluindo pagos e abertos. É referência gerencial de despesas/desembolsos cadastrados, não apuração contábil por competência nem pagamentos efetivos.',
 'A conta inteira Combustíveis e Lubrificantes foi retirada para evitar duplicidade de diesel. ARLA foi reposto pelos abastecimentos operacionais por data. Lubrificantes nessa conta não foram individualizados e podem faltar.',
 'Manutenção inclui borracharia, equipamentos, lavação e pneus quando lançados nas contas examinadas. É gasto observado, não provisão de desgaste por vida útil. Equipamentos podem conter investimento; não foi efetuada depreciação.',
 'Pessoal e viagens inclui salários variáveis e despesas de viagens vinculados à placa; não comprova inclusão de toda a folha/encargos. Fixos incluem seguros dos veículos, IPVA/licenciamento e rastreamento registrados.',
 'SXY5D26 inclui o implemento SXY6D26 pelo vínculo atual do cadastro. Não há comprovação histórica de permanência desse vínculo durante todo o período. Nenhum implemento foi vinculado às outras quatro placas no cadastro consultado.',
 'Coluna operacional exclui pedágio, parcelas de financiamento/aquisição, multas, ICMS, seguradora de riscos e adiantamentos. Pedágio depende da rota; sua média histórica aparece separadamente.',
 'Parcelas e aquisição incluem Financiamento de Veículos e Aquisição de novos Veiculos do implemento. A soma com parcelas é cenário de desembolso, não custo econômico; principal e juros não foram separados. Não foi somada depreciação.',
 'Sem rateio adicional de despesas administrativas comuns sem vínculo com a placa. Ausência de lançamento não significa custo zero. Portanto, não se apresenta o resultado como custo completo auditado.',
 'Valores de vazio são estimativas: intervalos entre SMs podem conter carga não registrada; a referência de diesel inclui motor parado nos dias de movimento selecionados. RXO6C18 demanda conferência adicional.',
 'Nenhum dado de negócio foi alterado. Evidências de origem preservadas em .local-logs/custo-vazio-*.json.',
];
const book=new ExcelJS.Workbook();book.creator='Rodobach';
const sheet=book.addWorksheet('Custo por km');
const cols=[['Placa','placa'],['Implementos','implementos'],['Km do período','km'],['Diesel R$/km','diesel'],['ARLA R$/km','arla'],['Manutenção e equipamentos R$/km','manutencao'],['Pessoal e viagens R$/km','pessoal'],['Seguros e taxas R$/km','fixos'],['Outros R$/km','outros'],['Rateio adicional R$/km','rateio'],['Operacional sem pedágio R$/km','operacional'],['Parcelas e aquisição R$/km','parcelas'],['Com parcelas sem pedágio R$/km','comParcelas'],['Pedágio histórico R$/km','pedagio'],['Com parcelas e pedágio histórico R$/km','comParcelasPedagio'],['Ressalvas','alerta']];
sheet.columns=cols.map(([header,key])=>({header,key,width:key==='alerta'?70:Math.max(16,Math.min(header.length,32))}));
summary.forEach(r=>sheet.addRow(r));sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:'A1',to:'P6'};
for(let c=4;c<=15;c++)sheet.getColumn(c).numFmt='0.00';sheet.getColumn(3).numFmt='#,##0';
const detail=book.addWorksheet('Rateios por conta');detail.columns=[['Caminhão','principal'],['Placa de origem','placa'],['Conta','conta_nome'],['Tratamento','category'],['Valor no período R$','valor'],['Registros','registros'],['Km base','km'],['Equivalente R$/km','porKm']].map(([header,key])=>({header,key,width:key==='conta_nome'||key==='category'?45:22}));details.forEach(r=>detail.addRow(r));detail.getColumn(5).numFmt='0.00';detail.getColumn(8).numFmt='0.0000';detail.views=[{state:'frozen',ySplit:1}];
const method=book.addWorksheet('Método e ressalvas');method.columns=[{header:'Método e limites',key:'texto',width:140}];notes.forEach(texto=>method.addRow({texto}));method.eachRow(row=>{row.alignment={wrapText:true,vertical:'top'};row.height=55;});
for(const s of book.worksheets){s.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};s.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF183B56'}};}
await book.xlsx.writeFile('../CUSTO-VAZIO-RATEADO-2026-09-25.xlsx');
const csv=[cols.map(c=>c[0]),...summary.map(s=>cols.map(([,k])=>typeof s[k]==='number'?s[k].toFixed(k==='km'?0:4).replace('.',','):s[k]))];
fs.writeFileSync('../CUSTO-VAZIO-RATEADO-2026-09-25.csv','\uFEFF'+csv.map(row=>row.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(';')).join('\r\n'));
fs.writeFileSync('../.local-logs/custo-vazio-rateado-final.json',JSON.stringify({summary,details,notes},null,2));
fs.writeFileSync('../CUSTO-VAZIO-RATEADO-2026-09-25.md','# Custo estimado por km vazio com rateio\n\n'+notes.map(n=>'- '+n).join('\n')+'\n');
for(const s of summary)console.log(JSON.stringify({placa:s.placa,km:s.km,diesel:s.diesel,rateio:s.rateio,operacional:s.operacional,parcelas:s.parcelas,comParcelas:s.comParcelas,pedagio:s.pedagio}));
