const plate=value=>String(value||'').replace(/[^A-Z0-9]/gi,'').toUpperCase();
function date(value){
 const m=String(value||'').match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
 return m?new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}-03:00`):new Date(NaN);
}
export function parseElitePosition(html,expectedPlate,now=new Date()) {
 const tag=String(html).match(/<input\b[^>]*\bid=["']posicoes["'][^>]*>/i)?.[0];
 const value=tag?.match(/\bvalue=(['"])([\s\S]*?)\1/i)?.[2];
 if(!value)return null;
 const decoded=value.replace(/&quot;/g,'"').replace(/&#(?:0?39|x27);/gi,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
 let rows;try{rows=JSON.parse(decoded);}catch{return null;}
 if(!Array.isArray(rows))return null;
 const valid=rows.filter(r=>plate(r.veiculo_placa)===plate(expectedPlate)&&r.latitude!=null&&r.longitude!=null
  &&String(r.latitude).trim()!==''&&String(r.longitude).trim()!==''
  &&Number.isFinite(Number(r.latitude))&&Math.abs(Number(r.latitude))<=90
  &&Number.isFinite(Number(r.longitude))&&Math.abs(Number(r.longitude))<=180
  &&Number.isFinite(+date(r.data_computador_bordo))&&date(r.data_computador_bordo)<=now)
  .sort((a,b)=>date(b.data_computador_bordo)-date(a.data_computador_bordo));
 const latest=valid[0];if(!latest)return null;
 const city=String(latest.cidade_referencia||'').trim().match(/^(.*?)\s*[-/]\s*([A-Z]{2})$/i);
 return {latitude:Number(latest.latitude),longitude:Number(latest.longitude),municipio:city?.[1]?.trim()||latest.cidade_referencia||latest.descricao_sistema||'',
  uf:city?.[2]||'',dataHora:date(latest.data_computador_bordo).toISOString(),fonte:'Elite',descricao:latest.descricao_sistema||null};
}
