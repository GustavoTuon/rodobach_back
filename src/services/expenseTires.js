import { getEstadoAtualPneusPorVeiculo } from './pneusService.js';

const clean = value => String(value ?? '').trim();
export async function expenseTires(plate, load = getEstadoAtualPneusPorVeiculo) {
  const {pneusNoVeiculo, posicoes} = await load(plate);
  return pneusNoVeiculo.filter(tire => !tire._semDadosCliente && clean(tire.codigopne) && clean(tire.empresapne)).map(tire => {
    const position = posicoes.find(item => clean(item.codigopop) === clean(tire.posicao) || clean(item.abreviacaopop) === clean(tire.posicao));
    return {code:clean(tire.codigopne),company:clean(tire.empresapne),plate,
      position:clean(tire.posicao),positionName:clean(position?.nomepop) || clean(tire.posicao),
      brand:clean(tire.marcapne),model:clean(tire.modelopne),size:clean(tire.tamanhopne)};
  }).sort((a,b)=>a.code.localeCompare(b.code,'pt-BR',{numeric:true}));
}

// Keep the original identity and position on edits, even after a tire has moved.
export async function resolveExpenseTire(body, before, load = expenseTires) {
  const previous = before?.pneu_vinculado;
  const sameContext = before?.placa === body.plate && before?.servico === body.service;
  if (body.tire && body.service !== 'Borracharia') throw Object.assign(new Error('Vincule o pneu somente em despesas de borracharia.'),{status:400});
  if (body.tire === null || body.service !== 'Borracharia') return null;
  if (body.tire === undefined) {
    return sameContext && previous && (body.tireFireNumber === undefined || body.tireFireNumber === previous.code) ? previous : null;
  }
  if (sameContext && previous?.code === body.tire.code && previous?.company === body.tire.company) return previous;
  const tires = await load(body.plate);
  const selected = tires.find(tire=>tire.code===body.tire.code && tire.company===body.tire.company);
  if (!selected) throw Object.assign(new Error('Este pneu não está vinculado à placa selecionada. Atualize os pneus e selecione novamente.'),{status:409});
  return selected;
}
