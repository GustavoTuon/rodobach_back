import {fetchWithTimeout} from './http.js';

const cache = new Map();
const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
export function distanceMeters(a, b) {
  if ([a?.latitude,a?.longitude,b?.latitude,b?.longitude].some(v => v == null || v === '' || !Number.isFinite(Number(v)))) return Infinity;
  const rad = Math.PI / 180;
  const lat = (Number(b.latitude)-Number(a.latitude))*rad, lon = (Number(b.longitude)-Number(a.longitude))*rad;
  const h = Math.sin(lat/2)**2 + Math.cos(Number(a.latitude)*rad)*Math.cos(Number(b.latitude)*rad)*Math.sin(lon/2)**2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1,h)));
}
export function deliveryProgress(locations, events = [], since, position, now = new Date()) {
  const stops = locations.filter(l => ['ENTREGA','DESTINO'].includes(normalized(l.tipo_local)))
    .map((l,i) => ({ordem:i+1,descricao:l.descricao || 'Local não informado',tipo:normalized(l.tipo_local),
      latitude:l.latitude,longitude:l.longitude,raio:Math.min(2000,Math.max(100,Number(l.raio)||250)),previsao:l.previsao_chegada||null}));
  const start = new Date(since).getTime();
  const valid = events.filter(e => Number.isFinite(start) && new Date(e.dataHora).getTime() >= start && new Date(e.dataHora) <= now);
  const result = stops.map(stop => {
    const discharge = valid.filter(e => e.tipo === 'descarga' && stops.filter(s =>
      (e.ponto && normalized(e.ponto) === normalized(s.descricao)) || distanceMeters(e,s) <= s.raio
    ).length === 1 && ((e.ponto && normalized(e.ponto) === normalized(stop.descricao)) || distanceMeters(e,stop) <= stop.raio))
      .sort((a,b) => new Date(b.dataHora)-new Date(a.dataHora))[0];
    const age = now-new Date(position?.dataHora || position?.data_hora);
    const nearby = Number.isFinite(age) && age >= 0 && age <= 30*60000 && distanceMeters(position,stop) <= stop.raio;
    return {...stop,concluida:Boolean(discharge),concluidaEm:discharge?.dataHora||null,
      situacao:discharge?'Descarga confirmada por macro':nearby?'Próximo ao local · entrega não confirmada':'Sem confirmação de entrega'};
  });
  return {disponivel:true,paradas:result,proxima:result.find(s => !s.concluida)||null,
    concluidas:result.filter(s=>s.concluida).length,total:result.length,
    observacao:'Sequência do guia Elite. Previsões e proximidade não confirmam entrega.'};
}
export async function loadDeliveryGuide(id) {
  if (!/^\d+$/.test(String(id))) throw new Error('SM inválida');
  const hit = cache.get(String(id));
  if (hit && Date.now()-hit.at < 60000) return hit.locations;
  const response = await fetchWithTimeout(`https://elite.trafegus.com.br:2083/api/proxy-api/guia-viagem?cod_viagem=${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`Guia Elite: HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload?.data?.locais_viagem)) throw new Error('Guia Elite indisponível');
  const locations = payload.data.locais_viagem;
  if(cache.size>100)cache.clear();
  cache.set(String(id),{at:Date.now(),locations});
  return locations;
}
