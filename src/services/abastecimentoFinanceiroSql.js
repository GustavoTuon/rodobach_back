// Aliases aba (abastecimento) e pag (contas a pagar).
// O documento importado pode existir sem os campos de duplicata gerada.
export function abastecimentoFinanceiroMatchSql() {
  return `
    pag.empresapag = aba.empresaaba
    AND pag.fornecedorpag = aba.postocombustivelaba
    AND (
      (
        COALESCE(aba.duplicatageradaaba, aba.duplicataaba) IS NOT NULL
        AND pag.duplicatapag = COALESCE(aba.duplicatageradaaba, aba.duplicataaba)
        AND pag.seriepag = COALESCE(aba.seriegeradaaba, aba.serieaba, pag.seriepag)
      )
      OR (
        COALESCE(aba.duplicatageradaaba, aba.duplicataaba) IS NULL
        AND NULLIF(TRIM(aba.documentoaba::text), '') IS NOT NULL
        AND (
          pag.duplicatapag::text = TRIM(aba.documentoaba::text)
          OR NULLIF(TRIM(pag.documentopag::text), '') = TRIM(aba.documentoaba::text)
        )
        AND pag.dataemissaopag::date = aba.dataaba::date
        AND pag.seriepag = COALESCE(aba.serieaba, pag.seriepag)
      )
    )
  `;
}
