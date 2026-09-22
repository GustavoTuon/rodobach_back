export const CARTEIRA_BUCKETS = ['aVencer', 'ate15', 'de16a30', 'de31a60', 'acima60', 'semVencimento'];

export function carteiraFilters(input = {}) {
  const integer = (value, name, fallback = null) => {
    if (value == null || value === '' || (name === 'empresa' && value === 'todas')) return fallback;
    if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 2147483647) {
      throw Object.assign(new Error(`${name} inválido.`), {status:400});
    }
    return Number(value);
  };
  const cliente = input.cliente || null;
  if (cliente && (typeof cliente !== 'string' || !/^(cnpj:\d{8}|cpf:\d{11}|cadastro:\d+:\d+|sem-cliente:\d+)$/.test(cliente))) {
    throw Object.assign(new Error('Cliente inválido.'), {status:400});
  }
  const faixa = input.faixa || 'todas';
  if (!['todas', 'vencido', ...CARTEIRA_BUCKETS].includes(faixa)) throw Object.assign(new Error('Faixa inválida.'), {status:400});
  return {empresa:integer(input.empresa, 'empresa'), cliente, faixa, pagina:integer(input.pagina, 'pagina', 1)};
}

export function summarizeCarteira(clients) {
  const sum = key => clients.reduce((total, row) => total + Math.round(Number(row[key] || 0) * 100), 0) / 100;
  return {
    total:sum('total'), vencido:sum('vencido'),
    ...Object.fromEntries(CARTEIRA_BUCKETS.map(key => [key, sum(key)])),
    clientes:clients.length, titulos:clients.reduce((sum, row) => sum + Number(row.titulos), 0),
  };
}
