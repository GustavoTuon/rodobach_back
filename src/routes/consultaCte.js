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
      WITH resultados AS (
        SELECT
          con.empresacon AS empresa,
          con.seriecon AS serie_cte,
          con.codigocon AS numero_cte,
          con.dataemissaocon AS data_emissao,
          TRIM(nf.chavenfecnf) AS chave_nfe,
          nf.notafiscalcnf AS numero_nota,
          nf.serienotafiscalcnf AS serie_nota,
          'CT-e vinculado'::text AS origem,
          FALSE AS possui_xml,
          con.clientecon AS emitente_codigo
        FROM logistica.conhecimentos con
        JOIN logistica.conhecimentosnotasfiscais nf
          ON nf.empresacnf = con.empresacon
         AND nf.seriecnf = con.seriecon
         AND nf.codigocnf = con.codigocon
        WHERE EXISTS (
            SELECT 1 FROM gerais.clientes cli
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

        UNION ALL

        SELECT
          mer.empresamer AS empresa,
          NULL::text AS serie_cte,
          NULL::integer AS numero_cte,
          mer.dataemissaomer AS data_emissao,
          TRIM(mer.chavemer) AS chave_nfe,
          mer.numeromer AS numero_nota,
          mer.seriemer AS serie_nota,
          'XML da NF-e'::text AS origem,
          NULLIF(TRIM(COALESCE(mer.arquivoxmlmer, '')), '') IS NOT NULL AS possui_xml,
          mer.emitentemer AS emitente_codigo
        FROM armazem.mercadorias mer
        WHERE EXISTS (
            SELECT 1 FROM gerais.clientes cli
            WHERE cli.codigocli = mer.emitentemer
              AND (
                COALESCE(cli.nomecli, '') ILIKE '%IBRAP%'
                OR COALESCE(cli.fantasiacli, '') ILIKE '%IBRAP%'
                OR COALESCE(cli.fantasiacli, '') ILIKE '%ESAF%'
              )
          )
          AND mer.numeromer::text = $1
          AND TRIM(LEADING '0' FROM COALESCE(mer.seriemer, '')) = TRIM(LEADING '0' FROM $2)
          AND NULLIF(TRIM(COALESCE(mer.chavemer, '')), '') IS NOT NULL
      ), unicos AS (
        SELECT DISTINCT ON (chave_nfe) *
        FROM resultados
        ORDER BY chave_nfe, possui_xml DESC, data_emissao DESC NULLS LAST
      )
      SELECT * FROM unicos
      ORDER BY data_emissao DESC NULLS LAST, chave_nfe
      LIMIT 50
    `, [nota, serie]);

    res.json({
      cliente: "IBRAP / ESAF - todas as unidades",
      nota,
      serie,
      resultados: rows.map((row) => ({
        empresa: row.empresa,
        serie: row.serie_cte,
        numeroCte: row.numero_cte,
        dataEmissao: row.data_emissao,
        chaveNfe: String(row.chave_nfe || "").trim(),
        numeroNota: row.numero_nota,
        serieNota: row.serie_nota,
        origem: row.origem,
        possuiXml: Boolean(row.possui_xml),
        emitenteCodigo: row.emitente_codigo,
      })),
    });
  } catch (error) {
    next(error);
  }
});
