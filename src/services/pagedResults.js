export async function collectPages(fetchPage, { pageSize = 100, maxRows = 1000 } = {}) {
  const rows = [];
  let total = 0;
  const seenPages = new Set();
  while (rows.length < maxRows) {
    const page = await fetchPage({ start: rows.length, length: Math.min(pageSize, maxRows - rows.length) });
    total = Math.max(total, Number(page.total) || 0);
    const items = Array.isArray(page.rows) ? page.rows.slice(0, maxRows - rows.length) : [];
    const signature = JSON.stringify(items);
    if (!items.length || seenPages.has(signature)) break;
    seenPages.add(signature);
    rows.push(...items);
    if (rows.length >= total) break;
  }
  return { rows, total, incompleto: rows.length < total };
}
