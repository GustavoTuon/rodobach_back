import { Router } from "express";
import { clientPool } from "../db/clientPool.js";

export const consultaCteRouter = Router();

consultaCteRouter.get("/cte/ncm-rateio", async (req, res, next) => {
  try {
    const tipo = req.query.tipo === "cte" ? "cte" : "nf";
    const numero = String(req.query.numero || "").replace(/\D/g, "");
    const serie = String(req.query.serie || "").trim();
    const fornecedor = String(req.query.fornecedor || "").trim();
    if (!numero) {
      return res.status(400).json({ error: "Informe o numero para consulta." });
    }
    if (tipo === "nf" && !serie) {
      return res.status(400).json({ error: "Informe a serie da nota fiscal." });
    }

    const params = [numero, serie, `%${fornecedor}%`];
    const filtroCte =
      tipo === "cte"
        ? `con.codigocon::text = LTRIM($1, '0')
         AND ($2::text = '' OR TRIM(LEADING '0' FROM con.seriecon) = TRIM(LEADING '0' FROM $2))`
        : `nf.notafiscalcnf::text = LTRIM($1, '0')
         AND TRIM(LEADING '0' FROM COALESCE(nf.serienotafiscalcnf, '')) = TRIM(LEADING '0' FROM $2)`;
    const incluirXml = tipo === "nf";

    const { rows } = await clientPool.query(
      `
      WITH resultados AS (
        SELECT
          con.empresacon AS empresa,
          con.seriecon AS serie_cte,
          con.codigocon AS numero_cte,
          nf.serienotafiscalcnf AS serie_nota,
          nf.notafiscalcnf AS numero_nota,
          nf.chavenfecnf AS chave_nfe,
          COALESCE(nf.valorcnf, nf.valorprodutoscnf, 0)::numeric AS valor_nota,
          COALESCE(nf.pesocnf, 0)::numeric AS peso_nota,
          NULLIF(TRIM(nf.ncmpredominantecnf), '') AS ncm_predominante,
          COALESCE(NULLIF(TRIM(emitente.fantasiacli), ''), NULLIF(TRIM(emitente.nomecli), ''), NULLIF(TRIM(cli.fantasiacli), ''), NULLIF(TRIM(cli.nomecli), ''), 'Nao identificado') AS fornecedor,
          nf.dataemissaocnf AS data_emissao,
          'CT-e vinculado'::text AS origem
        FROM logistica.conhecimentos con
        JOIN logistica.conhecimentosnotasfiscais nf
          ON nf.empresacnf = con.empresacon
         AND nf.seriecnf = con.seriecon
         AND nf.codigocnf = con.codigocon
        LEFT JOIN gerais.clientes cli
          ON cli.empresacli = con.empresacon AND cli.codigocli = con.clientecon
        LEFT JOIN gerais.clientes emitente
          ON regexp_replace(COALESCE(emitente.cnpjcpfcli::text, ''), '[^0-9]', '', 'g') = SUBSTRING(regexp_replace(COALESCE(nf.chavenfecnf, ''), '[^0-9]', '', 'g') FROM 7 FOR 14)
        WHERE ${filtroCte}
          AND ($3::text = '%%' OR CONCAT_WS(' ', emitente.nomecli, emitente.fantasiacli, emitente.cnpjcpfcli, cli.nomecli, cli.fantasiacli, cli.cnpjcpfcli) ILIKE $3)

        ${
          incluirXml
            ? `UNION ALL

        SELECT
          mer.empresamer AS empresa,
          mer.serieconhecimentomer AS serie_cte,
          mer.numeroconhecimentomer AS numero_cte,
          mer.seriemer AS serie_nota,
          mer.numeromer AS numero_nota,
          mer.chavemer AS chave_nfe,
          COALESCE(mer.valortotalmer, mer.totalprodutosmer, 0)::numeric AS valor_nota,
          COALESCE(mer.pesobrutomer, mer.pesoliquidomer, 0)::numeric AS peso_nota,
          NULLIF(TRIM(mer.ncmpredominantemer), '') AS ncm_predominante,
          COALESCE(NULLIF(TRIM(cli.fantasiacli), ''), NULLIF(TRIM(cli.nomecli), ''), 'Nao identificado') AS fornecedor,
          mer.dataemissaomer AS data_emissao,
          'XML da NF-e'::text AS origem
        FROM armazem.mercadorias mer
        LEFT JOIN gerais.clientes cli
          ON cli.empresacli = mer.empresamer AND cli.codigocli = mer.emitentemer
        WHERE mer.numeromer::text = LTRIM($1, '0')
          AND TRIM(LEADING '0' FROM COALESCE(mer.seriemer, '')) = TRIM(LEADING '0' FROM $2)
          AND ($3::text = '%%' OR CONCAT_WS(' ', cli.nomecli, cli.fantasiacli, cli.cnpjcpfcli) ILIKE $3)`
            : ""
        }
      ), unicos AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(chave_nfe), ''), empresa::text || '-' || serie_nota || '-' || numero_nota::text)) *
        FROM resultados
        ORDER BY COALESCE(NULLIF(TRIM(chave_nfe), ''), empresa::text || '-' || serie_nota || '-' || numero_nota::text),
                 (ncm_predominante IS NOT NULL) DESC, (valor_nota > 0) DESC, origem
      )
      SELECT * FROM unicos
      ORDER BY numero_nota, serie_nota
      LIMIT 200
    `,
      params,
    );

    res.json({
      tipo,
      numero,
      serie,
      fornecedor,
      resultados: rows.map((row) => ({
        empresa: row.empresa,
        numeroCte: row.numero_cte,
        serieCte: row.serie_cte,
        numeroNota: row.numero_nota,
        serieNota: row.serie_nota,
        chaveNfe: String(row.chave_nfe || "").trim(),
        valorNota: Number(row.valor_nota || 0),
        pesoNota: Number(row.peso_nota || 0),
        ncmPredominante: row.ncm_predominante || "",
        fornecedor: row.fornecedor,
        dataEmissao: row.data_emissao,
        origem: row.origem,
      })),
    });
  } catch (error) {
    next(error);
  }
});

consultaCteRouter.get("/cte/esaf", async (req, res, next) => {
  try {
    const nota = String(req.query.nota || "").replace(/\D/g, "");
    const serie = String(req.query.serie || "").trim();
    if (!/^\d{1,20}$/.test(nota) || !/^[a-zA-Z0-9.-]{1,10}$/.test(serie)) {
      return res
        .status(400)
        .json({ error: "Informe o numero e a serie da nota fiscal." });
    }

    const { rows } = await clientPool.query(
      `
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
    `,
      [nota, serie],
    );

    res.json({
      cliente: "IBRAP / ESAF - todas as unidades",
      fontesConsultadas: ["CT-e vinculado", "XML da NF-e"],
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
