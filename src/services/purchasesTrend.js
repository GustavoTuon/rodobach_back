import { clientPool } from "../db/clientPool.js";

// Company and unit are part of the comparison identity. Do not convert packs.
export async function purchaseTrend(product, cutoff, db = clientPool) {
  const { rows } = await db.query(`
    WITH bounds AS (
      SELECT ($3::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date cutoff,
        date_trunc('month', $3::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date - interval '11 months' first_month
    ), months AS (
      SELECT generate_series(first_month, date_trunc('month', cutoff), interval '1 month')::date AS month_key FROM bounds
    ), offers AS (
      SELECT date_trunc('month', c.datacot)::date AS month_key,
        min(c.valortotalcot::numeric / c.quantidadecotadacot) minimum,
        max(c.valortotalcot::numeric / c.quantidadecotadacot) maximum,
        count(*) offers
      FROM compras.cotacoescompras c CROSS JOIN bounds b
      WHERE c.empresacot::text = $1 AND c.produtocot::text = $2
        AND c.datacot >= b.first_month AND c.datacot::date <= b.cutoff
        AND c.quantidadecotadacot > 0 AND c.valortotalcot > 0
        AND c.reprovadacot IS NOT TRUE
        AND EXISTS (
          SELECT 1 FROM estoque.produtos p JOIN estoque.unidades u
            ON u.empresauni=p.empresapro AND u.codigouni=p.unidadepro
          WHERE p.empresapro=c.empresacot AND p.codigopro=c.produtocot
            AND upper(trim(u.abreviaturauni))=upper(trim($4))
        )
      GROUP BY 1
    ), purchases AS (
      SELECT DISTINCT ON (date_trunc('month', COALESCE(n.dataentradanfe,n.dataemissaonfe)))
        date_trunc('month', COALESCE(n.dataentradanfe,n.dataemissaonfe))::date AS month_key,
        i.valorunitarionep purchase
      FROM compras.notasfiscaisentradaprodutos i
      JOIN compras.notasfiscaisentrada n ON n.empresanfe=i.empresanep AND n.serienfe=i.serienep
        AND n.codigonfe=i.codigonep AND n.fornecedornfe=i.fornecedornep
      JOIN estoque.unidades u ON u.empresauni=i.empresanep AND u.codigouni=i.unidadenep
      CROSS JOIN bounds b
      WHERE i.empresanep::text=$1 AND i.produtonep::text=$2
        AND COALESCE(n.dataentradanfe,n.dataemissaonfe) >= b.first_month
        AND COALESCE(n.dataentradanfe,n.dataemissaonfe)::date <= b.cutoff
        AND i.quantidadenep>0 AND i.valorunitarionep>0
        AND upper(trim(u.abreviaturauni))=upper(trim($4))
      ORDER BY date_trunc('month', COALESCE(n.dataentradanfe,n.dataemissaonfe)),
        COALESCE(n.dataentradanfe,n.dataemissaonfe) DESC,n.codigonfe DESC,i.sequencianep DESC
    )
    SELECT to_char(m.month_key,'YYYY-MM') AS "month",o.minimum,o.maximum,p.purchase,COALESCE(o.offers,0)::int offers
    FROM months m LEFT JOIN offers o USING(month_key) LEFT JOIN purchases p USING(month_key) ORDER BY m.month_key`,
  [String(product.empresa), String(product.codigo), cutoff, product.unidade || ""]);
  return rows.map(row => ({...row,
    minimum: row.minimum == null ? null : Number(row.minimum),
    maximum: row.maximum == null ? null : Number(row.maximum),
    purchase: row.purchase == null ? null : Number(row.purchase),
  }));
}
