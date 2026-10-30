import http from 'node:http';
import {mkdir, appendFile} from 'node:fs/promises';
import {getVeiculosPool} from '../src/db/pool-veiculos.js';

// Local, read-only experiment. No alerts or commands are sent to the vehicle.
const plate = 'RAA8G58';
const pool = getVeiculosPool();
const logDir = new URL('../.local-logs/', import.meta.url);
await mkdir(logDir, {recursive:true});
const logFile = new URL(`bateria-${plate}-${new Date().toISOString().replace(/[:.]/g,'-')}.jsonl`, logDir);
let state = {plate, rows:[], checkedAt:null, error:null};
const seen = new Set();
let busy = false;
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    const {rows} = await pool.query(`SELECT m.id::text, m.data_hora, m.created_at AS recebido_em,
      m.bateria_carreta, m.evt4_ignicao_acionada AS ignicao, m.rpm, m.velocidade
      FROM rodobach.veiculos v
      JOIN LATERAL (SELECT id,data_hora,created_at,bateria_carreta,evt4_ignicao_acionada,rpm,velocidade
        FROM rodobach.mensagens_cb WHERE veiculo_id=v.veiculo_id AND bateria_carreta IS NOT NULL
        ORDER BY data_hora DESC,id DESC LIMIT 200) m ON TRUE
      WHERE v.placa=$1 ORDER BY m.data_hora DESC,m.id DESC LIMIT 200`, [plate]);
    const checkedAt = new Date().toISOString();
    const fresh = rows.filter(r=>!seen.has(r.id));
    if (fresh.length) {
      await appendFile(logFile, fresh.reverse().map(r=>JSON.stringify({plate,observado_em:checkedAt,...r})).join('\n')+'\n');
      rows.forEach(r=>seen.add(r.id));
    }
    state = {plate, rows, checkedAt, error:null};
  } catch { state = {...state,error:'Não foi possível consultar a telemetria. Tentando novamente em 15 segundos.'}; }
  finally {busy=false;}
}
const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bateria · RAA8G58</title>
<style>body{margin:0;background:#0b1120;color:#e5edf7;font:16px system-ui}main{max-width:1050px;margin:40px auto;padding:24px}h1{margin:8px 0}p{color:#aab9cd;line-height:1.6}.cards{display:flex;gap:16px;flex-wrap:wrap}.card{background:#162238;border:1px solid #30425f;border-radius:16px;padding:24px;flex:1;min-width:190px}.card strong{display:block;font-size:40px;margin-top:12px}small{color:#aab9cd}.notice{padding:14px;border-radius:8px;background:#24344e;margin:20px 0}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:13px;border-bottom:1px solid #30425f;font-size:14px}.table{overflow:auto}button{background:#4465e8;color:white;border:0;border-radius:8px;padding:12px;cursor:pointer}#status{color:#fcd680}header{display:flex;justify-content:space-between;gap:20px;align-items:center}</style>
<main><header><div><small>TESTE DE TELEMETRIA</small><h1>Bateria · RAA8G58</h1></div><button id="mark">Marcar: ligamos o caminhão</button></header>
<p>Acompanhamento automático a cada 15 segundos. O rastreador pode levar mais tempo para transmitir uma nova mensagem.</p>
<div class="cards"><div class="card">Última leitura de bateria<strong id="battery">—</strong><small id="batteryTime"></small></div><div class="card">Ignição na última mensagem<strong id="ignition">—</strong><small id="rpm"></small></div><div class="card">Idade da leitura da bateria<strong id="age">—</strong><small id="checked"></small></div></div>
<div class="notice">Campo recebido: bat / bateria_carreta. Unidade e origem elétrica ainda em validação. Ausência de leitura não significa bateria zerada.</div><p id="marker"></p><p id="status">Consultando…</p>
<h2>Histórico recebido</h2><div class="table"><table><thead><tr><th>Data/hora da leitura</th><th>Bateria</th><th>Ignição</th><th>RPM</th><th>Velocidade</th></tr></thead><tbody id="rows"></tbody></table></div></main>
<script>
const el=id=>document.getElementById(id), fmt=d=>new Date(d).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}), ign=v=>v===true?'Ligada':v===false?'Desligada':'Não informada';
el('mark').onclick=()=>{el('marker').textContent='Partida marcada neste navegador: '+fmt(new Date());};
async function update(){try{const r=await fetch('/data',{cache:'no-store'});if(!r.ok)throw Error();const s=await r.json(), latest=s.rows[0], b=s.rows.find(x=>x.bateria_carreta!=null);el('battery').textContent=b?Number(b.bateria_carreta).toLocaleString('pt-BR'):'Sem leitura';el('batteryTime').textContent=b?fmt(b.data_hora):'';el('ignition').textContent=latest?ign(latest.ignicao):'—';el('rpm').textContent=latest?'RPM: '+(latest.rpm??'não informado')+' · '+fmt(latest.data_hora):'';const age=b?Math.max(0,Math.floor((Date.now()-new Date(b.data_hora))/1000)):null;el('age').textContent=age==null?'—':age<60?age+' s':Math.floor(age/60)+' min';el('checked').textContent=s.checkedAt?'Consulta: '+fmt(s.checkedAt):'';el('status').textContent=s.error||(age>300?'Leitura com mais de 5 minutos. Aguardando nova transmissão.':'Acompanhando · sem alertas automáticos');el('rows').replaceChildren(...s.rows.map(x=>{const tr=document.createElement('tr');[fmt(x.data_hora),x.bateria_carreta==null?'Não informada':Number(x.bateria_carreta).toLocaleString('pt-BR'),ign(x.ignicao),x.rpm??'—',x.velocidade??'—'].forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.append(td)});return tr}));}catch{el('status').textContent='Monitor indisponível. Tentando novamente…';}finally{setTimeout(update,15000)}}update();
</script></html>`;
await refresh();
const timer=setInterval(refresh,15000);
const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.url==='/data'){res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(state));}
  else if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);}
  else {res.writeHead(404);res.end();}
});
server.listen(3334,'127.0.0.1',()=>console.log('Monitor RAA8G58: http://127.0.0.1:3334'));
async function stop(){clearInterval(timer);server.close();await pool.end();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
