import { Router } from "express";
import { clientPool } from "../db/clientPool.js";

export const localidadesRouter = Router();

function normalizeCity(row) {
  const uf = String(row.abreviaturaest || "").trim().toUpperCase();
  const nome = String(row.nomecid || "").trim();
  return {
    codigo: row.codigocid,
    nome,
    uf,
    estadoCodigo: row.estadocid ?? row.codigoest,
    ibge: row.ibgecid,
    label: [nome, uf].filter(Boolean).join(" - "),
    codigocid: row.codigocid,
    nomecid: row.nomecid,
    estadocid: row.estadocid,
    abreviaturaest: row.abreviaturaest,
    ibgecid: row.ibgecid,
    raw: {
      codigocid: row.codigocid,
      nomecid: row.nomecid,
      estadocid: row.estadocid,
      abreviaturaest: row.abreviaturaest,
      ibgecid: row.ibgecid,
    },
  };
}

localidadesRouter.get("/localidades/cidades", async (req, res, next) => {
  try {
    const search = String(req.query.search || req.query.q || "").trim();
    if (search.length < 2) return res.json([]);

    const { rows } = await clientPool.query(`
      SELECT
        c.codigocid,
        c.nomecid,
        c.estadocid,
        c.ibgecid,
        c.ativocid,
        e.codigoest,
        e.nomeest,
        e.abreviaturaest,
        e.ibgeest
      FROM localidades.cidades c
      LEFT JOIN localidades.estados e
        ON e.codigoest = c.estadocid
      WHERE COALESCE(c.ativocid::text, '') IN ('S', 's', '1', 'true', 'TRUE', 'A', 'a')
        AND c.nomecid ILIKE '%' || $1 || '%'
      ORDER BY c.nomecid
      LIMIT 30
    `, [search]);

    res.json(rows.map(normalizeCity));
  } catch (error) {
    next(error);
  }
});
