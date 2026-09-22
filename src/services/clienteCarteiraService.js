import {clientPool} from '../db/clientPool.js';
import {carteiraFilters, summarizeCarteira, CARTEIRA_BUCKETS} from './clienteCarteiraModel.js';

// Resolve o cadastro na empresa do título antes de consolidar a raiz do CNPJ.
// LATERAL LIMIT 1 impede que cadastros repetidos multipliquem saldos.
const identityJoin = `
LEFT JOIN LATERAL (
  SELECT COALESCE(NULLIF(TRIM(c.fantasiacli), ''), NULLIF(TRIM(c.nomecli), ''), 'Sem identificação') AS nome,
    c.cnpjcpfcli AS documento
  FROM gerais.clientes c WHERE c.codigocli = rec.clienterec
  ORDER BY (c.empresacli = rec.empresarec) DESC NULLS LAST, c.empresacli, c.cnpjcpfcli, c.nomecli
  LIMIT 1
) cli ON true
CROSS JOIN LATERAL (SELECT REGEXP_REPLACE(COALESCE(cli.documento, ''), '[^0-9]', '', 'g') AS digits) doc
CROSS JOIN LATERAL (SELECT CASE
  WHEN LENGTH(doc.digits) = 14 AND doc.digits <> REPEAT(LEFT(doc.digits, 1), 14) THEN 'cnpj:' || LEFT(doc.digits, 8)
  WHEN LENGTH(doc.digits) = 11 AND doc.digits <> REPEAT(LEFT(doc.digits, 1), 11) THEN 'cpf:' || doc.digits
  WHEN rec.clienterec IS NULL THEN 'sem-cliente:' || rec.empresarec::text
  ELSE 'cadastro:' || rec.empresarec::text || ':' || rec.clienterec::text END AS identidade) id`;

export const CARTEIRA_BASE_SQL = `WITH carteira AS (
  SELECT rec.empresarec AS empresa, rec.serierec AS serie, rec.duplicatarec AS numero, rec.parcelarec AS parcela,
    rec.clienterec AS codigo, COALESCE(cli.nome, 'Sem identificação') AS nome, cli.documento,
    id.identidade, rec.dataemissaorec::date AS emissao, rec.datavencimentorec::date AS vencimento,
    rec.valorduplicatarec AS original, rec.valorabertorec AS saldo,
    CURRENT_DATE - rec.datavencimentorec::date AS dias,
    CASE WHEN rec.datavencimentorec IS NULL THEN 'semVencimento'
      WHEN rec.datavencimentorec::date >= CURRENT_DATE THEN 'aVencer'
      WHEN CURRENT_DATE - rec.datavencimentorec::date <= 15 THEN 'ate15'
      WHEN CURRENT_DATE - rec.datavencimentorec::date <= 30 THEN 'de16a30'
      WHEN CURRENT_DATE - rec.datavencimentorec::date <= 60 THEN 'de31a60'
      ELSE 'acima60' END AS faixa
  FROM financeiro.receber rec
  ${identityJoin}
  WHERE rec.statusrec IN (1,2) AND rec.valorabertorec > 0
    AND ($1::int IS NULL OR rec.empresarec = $1)
)`;

export const CARTEIRA_SUMMARY_SQL = `${CARTEIRA_BASE_SQL}
SELECT identidade, (ARRAY_AGG(nome ORDER BY saldo DESC, empresa, serie, numero, parcela))[1] AS nome,
  COUNT(*)::int AS titulos, SUM(saldo) AS total,
  COALESCE(SUM(saldo) FILTER (WHERE dias > 0),0) AS vencido,
  ${CARTEIRA_BUCKETS.map(key => `COALESCE(SUM(saldo) FILTER (WHERE faixa = '${key}'),0) AS "${key}"`).join(',\n  ')},
  JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('empresa',empresa,'codigo',codigo,'nome',nome,'documento',documento)) AS filiais
FROM carteira GROUP BY identidade ORDER BY vencido DESC, total DESC, identidade`;

const faixaWhere = `($3::text = 'todas' OR faixa = $3 OR ($3 = 'vencido' AND dias > 0))`;
export const CARTEIRA_TITLES_SQL = `${CARTEIRA_BASE_SQL}
SELECT empresa, serie, numero, parcela, codigo, nome, documento, emissao::text, vencimento::text,
  original, saldo, GREATEST(dias,0) AS "diasAtraso", faixa
FROM carteira WHERE identidade = $2 AND ${faixaWhere}
ORDER BY vencimento ASC NULLS LAST, empresa, serie, numero, parcela
LIMIT 50 OFFSET $4`;

export async function getClienteCarteira(input = {}, pool = clientPool) {
  const filters = carteiraFilters(input);
  const db = await pool.connect();
  try {
    await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    // Dia de referência e vencimentos seguem o calendário comercial brasileiro.
    await db.query("SET LOCAL TIME ZONE 'America/Sao_Paulo'");
    const {rows:[reference]} = await db.query('SELECT CURRENT_DATE::text AS data, CURRENT_TIMESTAMP AS atualizado');
    const {rows} = await db.query(CARTEIRA_SUMMARY_SQL, [filters.empresa]);
    const clientes = rows.map(row => ({...row,
      total:Number(row.total), vencido:Number(row.vencido),
      ...Object.fromEntries(CARTEIRA_BUCKETS.map(key => [key, Number(row[key])])),
    }));
    const selected = filters.cliente ? clientes.find(c => c.identidade === filters.cliente) : null;
    let detalhe = null;
    if (filters.cliente) {
      if (!selected) throw Object.assign(new Error('Este cliente não possui títulos em aberto nesta empresa. Atualize a carteira.'), {status:404});
      const {rows:[count]} = await db.query(`${CARTEIRA_BASE_SQL}
        SELECT COUNT(*)::int AS quantidade, COALESCE(SUM(saldo),0) AS saldo
        FROM carteira WHERE identidade = $2 AND ${faixaWhere}`, [filters.empresa, filters.cliente, filters.faixa]);
      const {rows:titles} = await db.query(CARTEIRA_TITLES_SQL, [filters.empresa, filters.cliente, filters.faixa, (filters.pagina - 1) * 50]);
      const {rows:[receipt]} = await db.query(`SELECT MAX(rcb.datarecebimentorcb::date)::text AS data
        FROM financeiro.receberrecebimentos rcb
        JOIN financeiro.receber rec ON rec.empresarec=rcb.empresarcb AND rec.serierec=rcb.seriercb
          AND rec.duplicatarec=rcb.duplicatarcb AND rec.parcelarec=rcb.parcelarcb
        ${identityJoin}
        WHERE rec.statusrec IN (1,2) AND rcb.valorrecebidorcb > 0
          AND rcb.datarecebimentorcb::date <= CURRENT_DATE
          AND ($1::int IS NULL OR rec.empresarec=$1) AND id.identidade=$2`, [filters.empresa, filters.cliente]);
      detalhe = {cliente:selected, ultimoRecebimento:receipt.data, faixa:filters.faixa,
        pagina:filters.pagina, porPagina:50, quantidade:count.quantidade, saldo:Number(count.saldo),
        titulos:titles.map(row => ({...row, original:row.original == null ? null : Number(row.original), saldo:Number(row.saldo)})),
      };
    }
    await db.query('COMMIT');
    return {dataReferencia:reference.data, atualizadoEm:reference.atualizado, empresa:filters.empresa,
      resumo:summarizeCarteira(clientes), clientes, detalhe,
      metodologia:'Saldo atual de todos os títulos com saldo positivo e status 1 ou 2, sem corte de emissão ou vencimento. Valores já baixados reduzem o saldo. Vencimentos de hoje estão em a vencer; títulos sem data ficam separados. Não inclui juros ou multas calculados fora do saldo do ERP. Filiais consolidadas pela raiz do CNPJ; cadastros não identificados são preservados.',
    };
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { db.release(); }
}
