const plate = value => String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();

export function eliteDistanceFilters(vehicleId, day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d+$/.test(String(vehicleId))) throw new Error('Filtro Elite inválido');
  const date = day.split('-').reverse().join('/');
  return {veiculo_rel_km:String(vehicleId),terminal_rel_km:'',proprietario_rel_km:'',viagem_rel_km:'',agrupar_viagem_rel_km:'N',num_pedido_manifesto_rel_km:'',frota_rel_km:'',data_val_ini:`${date} 00:00`,data_val_fim:`${date} 23:59`,dataComputadorBordoInicial:`${date} 00:00`,dataComputadorBordoFinal:`${date} 23:59`,use_dados_hodometro:'N'};
}

export function parseEliteDistance(payload, vehicleId, placa, day, now = new Date()) {
  const rows = (Array.isArray(payload?.data) ? payload.data : []).filter(row => String(row.id) === String(vehicleId) && plate(row.placa) === plate(placa));
  // Multiple terminals must not be summed: they can measure the same movement.
  if (rows.length !== 1) return null;
  const row = rows[0], raw = row.kmtotal;
  if (raw == null || String(raw).trim() === '' || !Number.isFinite(Number(raw)) || Number(raw) < 0) return null;
  const last = String(row.ultima_data_computador_bordo || '');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(last) || last.slice(0,10) !== day) return null;
  const fim = new Date(last.replace(' ','T') + '-03:00');
  if (!Number.isFinite(+fim) || fim > now) return null;
  return {dia:day,km:Math.round(Number(raw)*10)/10,fonte:'Elite',metodo:'relatorio_quilometros',fim:fim.toISOString()};
}
