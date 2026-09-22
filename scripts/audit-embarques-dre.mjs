import { clientPool } from '../src/db/clientPool.js';
try {
  const columns=await clientPool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='logistica' AND table_name='conhecimentos' AND (column_name ILIKE '%orcamento%' OR column_name ILIKE '%substitu%')`);
  console.log('Campos de vínculo:',columns.rows);
  const links=await clientPool.query(`SELECT COUNT(*) AS vinculos,
    COUNT(*) FILTER (WHERE v.codigoorcamento IS NOT NULL) AS com_orcamento,
    COUNT(*) FILTER (WHERE v.codigoconhecimento IS NOT NULL) AS com_conhecimento,
    COUNT(*) FILTER (WHERE v.codigoorcamento IS NOT NULL AND v.codigoconhecimento IS NOT NULL) AS ambos
    FROM financeiro.receberconhecimentosvinculados v
    WHERE EXISTS (SELECT 1 FROM financeiro.receber r WHERE r.empresarec=v.empresa AND r.serierec=v.serie AND r.duplicatarec=v.duplicata AND r.statusrec IN (1,2) AND r.dataemissaorec::date BETWEEN '2026-08-01' AND '2026-08-31')`);
  console.log('Vínculos de títulos ativos em agosto/2026:',links.rows);
} finally { await clientPool.end(); }
