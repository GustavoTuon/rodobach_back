export function parseVolumes(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!['string','number'].includes(typeof value) || !/^\d+$/.test(String(value)) || Number(value) > 2147483647) {
    throw Object.assign(new Error('Volumes devem ser uma quantidade inteira, maior ou igual a zero.'),{status:400});
  }
  return Number(value);
}
export function validateCargaVolumes(input) {
  const total=parseVolumes(input.volumes);
  const stops=Array.isArray(input.paradas)?input.paradas:[];
  for(const tipo of ['entrega','coleta']) {
    const sum=stops.filter(stop=>(stop.tipo||'entrega')===tipo).reduce((value,stop)=>value+(parseVolumes(stop.volumes)??0),0);
    if(total!==null && sum>total) throw Object.assign(new Error(`A soma dos volumes das paradas de ${tipo} não pode ultrapassar o total da carga.`),{status:400});
  }
  return total;
}
