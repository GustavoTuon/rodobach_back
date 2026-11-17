export function extraCatalogName(value) {
  if (typeof value !== 'string') throw Object.assign(new Error('Informe a descrição do item.'), {status:400});
  const description=value.trim().replace(/\s+/g,' ');
  if (!description || description.length>200) throw Object.assign(new Error('A descrição deve ter de 1 a 200 caracteres.'), {status:400});
  const key=description.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR');
  return {description,key};
}
