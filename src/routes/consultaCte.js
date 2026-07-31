import { Router } from "express";
import { clientPool } from "../db/clientPool.js";

export const consultaCteRouter = Router();

consultaCteRouter.get("/cte/esaf", async (req, res, next) => {
  try {
    const nota = String(req.query.nota || "").replace(/\D/g, "");
    const serie = String(req.query.serie || "").trim();
    if (!/^\d{1,20}$/.test(nota) || !/^[a-zA-Z0-9.-]{1,10}$/.test(serie)) {
      return res.status(400).json({ error: "Informe o numero e a serie da nota fiscal." });
    }

    const { rows } = await clientPool.query(`
      SELECT DISTINCT
        con.empresacon AS empresa,
        con.seriecon AS serie,
        con.codigocon AS numero_cte,
        con.dataemissaocon AS data_emissao,
        nf.chavenfecnf AS chave_nfe,
        nf.notafiscalcnf AS numero_nota,
        nf.serienotafiscalcnf AS serie_nota
      FROM logistica.conhecimentos con
      LEFT JOIN logistica.conhecimentosnotasfiscais nf
        ON nf.empresacnf = con.empresacon
       AND nf.seriecnf = con.seriecon
       AND nf.codigocnf = con.codigocon
      WHERE EXISTS (
          SELECT 1
          FROM gerais.clientes cli
          WHERE cli.codigocli = con.clientecon
            AND (
              COALESCE(cli.nomecli, '') ILIKE '%IBRAP%'
              OR COALESCE(cli.fantasiacli, '') ILIKE '%IBRAP%'
              OR COALESCE(cli.fantasiacli, '') ILIKE '%ESAF%'
            )
        )
        AND nf.notafiscalcnf::text = $1
        AND TRIM(LEADING '0' FROM COALESCE(nf.serienotafiscalcnf, '')) = TRIM(LEADING '0' FROM $2)
        AND NULLIF(TRIM(COALESCE(nf.chavenfecnf, '')), '') IS NOT NULL
      ORDER BY con.dataemissaocon DESC, con.codigocon DESC
      LIMIT 20
    `, [nota, serie]);

    res.json({
      cliente: "IBRAP / ESAF - todas as unidades",
      nota,
      serie,
      resultados: rows.map((row) => ({
        empresa: row.empresa,
        serie: row.serie,
        numeroCte: row.numero_cte,
        dataEmissao: row.data_emissao,
        chaveNfe: String(row.chave_nfe || "").trim(),
        numeroNota: row.numero_nota,
        serieNota: row.serie_nota,
      })),
    });
  } catch (error) {
    next(error);
  }
});
