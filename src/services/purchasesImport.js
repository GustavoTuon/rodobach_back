import { randomUUID } from "node:crypto";
import { pool } from "../db/pool.js";
import { clientPool } from "../db/clientPool.js";
import { tableName } from "../config.js";

export function groupErpQuotes(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `cotacoescompras:${row.empresacot}:${row.solicitacaocompracot || `avulsa-${row.codigocot}`}`;
    if (!groups.has(key))
      groups.set(key, {
        key,
        empresa: row.empresacot,
        solicitacao: row.solicitacaocompracot,
        ofertas: [],
      });
    groups.get(key).ofertas.push(row);
  }
  return [...groups.values()];
}
export async function importErpQuotes(actor = "importacao-erp") {
  const { rows } =
    await clientPool.query(`SELECT c.*,c.datacot::text AS data,c.datavalidadecot::text AS validade,
 p.nomepro produto,p.empresapro::text produto_empresa,COALESCE(u.abreviaturauni,'Não informada') unidade,
 f.nomefor fornecedor,f.empresafor::text fornecedor_empresa,f.emailfor email,f.telefone1for telefone,f.cnpjcpffor documento,
 s.dataslt::text data_solicitacao,s.observacaoslt observacao_solicitacao,
 (SELECT sum(v.quantidade) FROM compras.solicitacoesprodutosservicoscotacoes v WHERE v.empresa=c.empresacot AND v.solicitacao=c.solicitacaocompracot AND v.produtoservico=c.produtocot AND v.tipoprodutoservico='PRODUTO') quantidade_solicitada
 FROM compras.cotacoescompras c
 LEFT JOIN LATERAL (SELECT * FROM estoque.produtos WHERE codigopro=c.produtocot ORDER BY (empresapro=c.empresacot) DESC,empresapro LIMIT 1) p ON true
 LEFT JOIN LATERAL (SELECT * FROM gerais.fornecedores WHERE codigofor=c.fornecedorcot ORDER BY (empresafor=c.empresacot) DESC,empresafor LIMIT 1) f ON true
 LEFT JOIN LATERAL (SELECT abreviaturauni FROM estoque.unidades WHERE codigouni=p.unidadepro ORDER BY (empresauni=p.empresapro) DESC,empresauni LIMIT 1) u ON true
 LEFT JOIN compras.solicitacoescompra s ON s.empresaslt=c.empresacot AND s.codigoslt=c.solicitacaocompracot
 ORDER BY c.empresacot,c.solicitacaocompracot,c.datacot,c.codigocot`);
  const groups = groupErpQuotes(rows),
    client = await pool.connect();
  const result = {
    cotacoes: groups.length,
    ofertas: rows.length,
    novas: 0,
    atualizadas: 0,
    fornecedores: 0,
  };
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(630063)");
    const suppliers = new Map();
    for (const r of rows) {
      if (!r.fornecedorcot || !r.fornecedor_empresa) continue;
      const key = `${r.fornecedor_empresa}:${r.fornecedorcot}`;
      if (suppliers.has(key)) continue;
      const { rows: s } = await client.query(
        `INSERT INTO ${tableName("compras_fornecedores")} (id,nome,empresa_erp,codigo_erp,email,telefone,documento) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (empresa_erp,codigo_erp) DO UPDATE SET nome=EXCLUDED.nome RETURNING id`,
        [
          randomUUID(),
          r.fornecedor || `Fornecedor ${r.fornecedorcot}`,
          r.fornecedor_empresa,
          String(r.fornecedorcot),
          r.email || "",
          r.telefone || "",
          r.documento || "",
        ],
      );
      suppliers.set(key, s[0].id);
    }
    result.fornecedores = suppliers.size;
    for (const g of groups) {
      const existing = await client.query(
        `SELECT id FROM ${tableName("compras_cotacoes")} WHERE origem_chave=$1`,
        [g.key],
      );
      const products = new Map();
      for (const r of g.ofertas) {
        const key = String(r.produtocot);
        if (!products.has(key))
          products.set(key, {
            id: `erp-${key}`,
            empresa: String(g.empresa),
            codigo: key,
            nome: r.produto || `Produto ${key}`,
            quantidade:
              r.quantidade_solicitada == null
                ? null
                : Number(r.quantidade_solicitada),
            unidade: r.unidade,
            fornecedores: [],
          });
        const supplier = suppliers.get(
          `${r.fornecedor_empresa}:${r.fornecedorcot}`,
        );
        if (supplier && !products.get(key).fornecedores.includes(supplier))
          products.get(key).fornecedores.push(supplier);
      }
      const dates = g.ofertas
        .map((r) => r.data)
        .filter(Boolean)
        .sort();
      const data = g.ofertas[0].data_solicitacao || dates[0];
      if (!data) throw new Error(`Cotação ${g.key} sem data de origem.`);
      const metadata = {
        ...g,
        fornecedores: new Set(g.ofertas.map((r) => r.fornecedorcot)).size,
        ultima_data: dates.at(-1),
        fonte: "compras.cotacoescompras",
      };
      await client.query(
        `INSERT INTO ${tableName("compras_cotacoes")} (id,titulo,prazo,observacoes,itens,status,criado_por,criado_em,origem_chave,origem_dados,importado_em) VALUES ($1,$2,$3,$4,$5,'encerrada',$6,$7,$8,$9,now()) ON CONFLICT (origem_chave) DO UPDATE SET titulo=EXCLUDED.titulo,observacoes=EXCLUDED.observacoes,itens=EXCLUDED.itens,origem_dados=EXCLUDED.origem_dados,importado_em=now()`,
        [
          randomUUID(),
          `Solicitação ${g.solicitacao || g.ofertas[0].codigocot} · Empresa ${g.empresa}`,
          `${dates.at(-1) || data}T23:59:59-03:00`,
          g.ofertas[0].observacao_solicitacao || "",
          JSON.stringify([...products.values()]),
          String(actor),
          `${data}T12:00:00-03:00`,
          g.key,
          JSON.stringify(metadata),
        ],
      );
      if (existing.rows.length) result.atualizadas++;
      else result.novas++;
    }
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
