import { clientPool } from "../db/clientPool.js";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function r2(value) {
  return Math.round((num(value) + Number.EPSILON) * 100) / 100;
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function normalizeTipo(value) {
  const v = String(value || "todos").trim().toLowerCase();
  if (["frota", "proprio", "proprio/frota", "próprio"].includes(v)) return "frota";
  if (["terceiro", "terceiros"].includes(v)) return "terceiro";
  return "todos";
}

function normalizeStatus(value) {
  const v = String(value || "todos").trim().toLowerCase();
  if (["lucro", "lucrativo"].includes(v)) return "lucro";
  if (["prejuizo", "prejuízo"].includes(v)) return "prejuizo";
  return "todos";
}

function resolvePeriod(filters = {}) {
  return {
    startDate: filters.startDate || filters.dataInicial || filters.dataInicio || daysAgoIso(29),
    endDate: filters.endDate || filters.dataFinal || filters.dataFim || todayIso(),
  };
}

function statusLucro(lucro) {
  return num(lucro) >= 0 ? "lucro" : "prejuizo";
}

function formatGrupoId(grupoId) {
  const value = String(grupoId || "");
  const parts = value.split(":");
  if (parts[0] === "C") return `CT-e ${parts.at(-1) || value}`;
  if (parts[0] === "M") return `MDF-e ${parts.at(-1) || value}`;
  if (parts[0] === "F") return `Fin. ${parts[2] || ""}-${parts[3] || ""}/${parts[4] || ""}`.trim();
  return value;
}

const BASE_QUERY = `
  WITH params AS (
    SELECT
      $1::date AS data_inicio,
      $2::date AS data_fim,
      NULLIF(TRIM($3::text), '') AS cliente,
      NULLIF(UPPER(TRIM($4::text)), '') AS placa,
      NULLIF(TRIM($5::text), '') AS origem,
      NULLIF(TRIM($6::text), '') AS destino,
      NULLIF(TRIM($7::text), '') AS material,
      $8::text AS tipo_veiculo
  ),
  receita_financeira AS (
    SELECT
      rec.empresarec AS empresa,
      rec.serierec AS serie,
      rec.duplicatarec AS duplicata,
      rec.parcelarec AS parcela,
      rec.clienterec AS cliente_codigo,
      rec.dataemissaorec::date AS data,
      UPPER(NULLIF(TRIM(rec.veiculorec::text), '')) AS placa_financeiro,
      COALESCE(NULLIF(rec.observacaorec, ''), '')::text AS historico,
      COALESCE(NULLIF(cli.fantasiacli, ''), NULLIF(cli.nomecli, ''), 'Cliente ' || rec.clienterec::text) AS cliente_nome,
      SUM(vlr.valorliquido)::numeric AS receita
    FROM financeiro.receber rec
    INNER JOIN financeiro.valorliquidorateiosreceber vlr
      ON rec.empresarec = vlr.empresa
     AND rec.serierec = vlr.serie
     AND rec.duplicatarec = vlr.duplicata
     AND rec.parcelarec = vlr.parcela
    CROSS JOIN params p
    LEFT JOIN LATERAL (
      SELECT nomecli, fantasiacli
      FROM gerais.clientes cli
      WHERE cli.codigocli = rec.clienterec
      ORDER BY (cli.empresacli = rec.empresarec) DESC, cli.empresacli
      LIMIT 1
    ) cli ON true
    WHERE rec.statusrec IN (1,2)
      AND rec.dataemissaorec::date BETWEEN p.data_inicio AND p.data_fim
    GROUP BY
      rec.empresarec,
      rec.serierec,
      rec.duplicatarec,
      rec.parcelarec,
      rec.clienterec,
      rec.dataemissaorec,
      rec.veiculorec,
      rec.observacaorec,
      cli.fantasiacli,
      cli.nomecli
  ),
  vinculos_cte AS (
    SELECT DISTINCT
      rf.empresa,
      rf.serie,
      rf.duplicata,
      rf.parcela,
      rcv.serieconhecimento AS serie_cte,
      rcv.codigoconhecimento AS cte_codigo
    FROM receita_financeira rf
    INNER JOIN financeiro.receberconhecimentosvinculados rcv
      ON rcv.empresa = rf.empresa
     AND rcv.serie = rf.serie
     AND rcv.duplicata = rf.duplicata
    UNION
    SELECT DISTINCT
      rf.empresa,
      rf.serie,
      rf.duplicata,
      rf.parcela,
      NULL::varchar AS serie_cte,
      rcc.conhecimentorcc AS cte_codigo
    FROM receita_financeira rf
    INNER JOIN financeiro.receberconhecimentos rcc
      ON rcc.empresarcc = rf.empresa
     AND rcc.seriercc = rf.serie
     AND rcc.duplicatarcc = rf.duplicata
     AND rcc.parcelarcc = rf.parcela
  ),
  receita_com_vinculos AS (
    SELECT
      rf.*,
      vc.serie_cte,
      vc.cte_codigo,
      COUNT(vc.cte_codigo) OVER (PARTITION BY rf.empresa, rf.serie, rf.duplicata, rf.parcela) AS qtd_ctes
    FROM receita_financeira rf
    LEFT JOIN vinculos_cte vc
      ON vc.empresa = rf.empresa
     AND vc.serie = rf.serie
     AND vc.duplicata = rf.duplicata
     AND vc.parcela = rf.parcela
  ),
  receita_documentos AS (
    SELECT
      rv.*,
      CASE WHEN rv.cte_codigo IS NULL THEN rv.receita ELSE rv.receita / GREATEST(rv.qtd_ctes, 1) END AS receita_rateada,
      con.empresacon,
      con.seriecon,
      con.codigocon,
      con.numeroctecon,
      con.dataemissaocon,
      COALESCE(con.viagemcon, con.cargacontroleviagemcon, con.numeroviagemcon) AS viagem_cte,
      UPPER(NULLIF(TRIM(con.veiculocon::text), '')) AS placa_cte,
      con.motoristacon,
      con.cidadecoletacon,
      con.cidadeentregacon,
      COALESCE(NULLIF(origem.nomecid, ''), con.cidadecoletacon::text, '') AS origem,
      COALESCE(NULLIF(destino.nomecid, ''), con.cidadeentregacon::text, '') AS destino
    FROM receita_com_vinculos rv
    LEFT JOIN logistica.conhecimentos con
      ON con.empresacon = rv.empresa
     AND con.codigocon = rv.cte_codigo
     AND (rv.serie_cte IS NULL OR con.seriecon = rv.serie_cte)
     AND con.statuscon = 2
    LEFT JOIN localidades.cidades origem ON origem.codigocid = con.cidadecoletacon
    LEFT JOIN localidades.cidades destino ON destino.codigocid = con.cidadeentregacon
  ),
  documento_enriquecido AS (
    SELECT
      rd.*,
      cvf.codigocvf AS viagem_frete,
      cvf.sequenciacvf AS frete_seq,
      cvf.empresamdfecvf,
      cvf.seriemdfecvf,
      cvf.mdfecvf,
      cvf.valorfretemotoristacvf,
      cvf.valorfretepesomotoristacvf,
      cvf.valorcomissaocvf,
      COALESCE(rd.viagem_cte, cvf.codigocvf, mdf.viagemmdf) AS viagem_resolvida,
      COALESCE(rd.placa_cte, UPPER(NULLIF(TRIM(cvf.veiculocvf::text), '')), UPPER(NULLIF(TRIM(mdf.veiculomdf::text), '')), rd.placa_financeiro) AS placa_resolvida,
      COALESCE(rd.origem, NULLIF(origem_cvf.nomecid, ''), '') AS origem_resolvida,
      COALESCE(rd.destino, NULLIF(destino_cvf.nomecid, ''), '') AS destino_resolvido
    FROM receita_documentos rd
    LEFT JOIN logistica.controleviagensfretes cvf
      ON cvf.empresaconhecimentocvf = rd.empresacon
     AND cvf.serieconhecimentocvf = rd.seriecon
     AND cvf.conhecimentocvf = rd.codigocon
    LEFT JOIN logistica.mdfe mdf
      ON mdf.empresamdf = cvf.empresamdfecvf
     AND mdf.seriemdf = cvf.seriemdfecvf
     AND mdf.codigomdf = cvf.mdfecvf
    LEFT JOIN localidades.cidades origem_cvf ON origem_cvf.codigocid = cvf.cidadeorigemcvf
    LEFT JOIN localidades.cidades destino_cvf ON destino_cvf.codigocid = cvf.cidadedestinocvf
  ),
  grupos AS (
    SELECT
      CASE
        WHEN viagem_resolvida IS NOT NULL THEN 'V:' || viagem_resolvida::text
        WHEN mdfecvf IS NOT NULL THEN 'M:' || COALESCE(empresamdfecvf::text, '') || ':' || COALESCE(seriemdfecvf, '') || ':' || mdfecvf::text
        WHEN codigocon IS NOT NULL THEN 'C:' || empresacon::text || ':' || COALESCE(seriecon, '') || ':' || codigocon::text
        ELSE 'F:' || empresa::text || ':' || serie || ':' || duplicata::text || ':' || parcela
      END AS grupo_id,
      MIN(data) AS data,
      MIN(viagem_resolvida) AS viagem,
      STRING_AGG(DISTINCT cliente_nome, ', ' ORDER BY cliente_nome) AS clientes,
      UPPER(NULLIF(TRIM(COALESCE(MAX(placa_resolvida), '')), '')) AS placa,
      STRING_AGG(DISTINCT NULLIF(origem_resolvida, ''), ', ' ORDER BY NULLIF(origem_resolvida, '')) AS origens,
      STRING_AGG(DISTINCT NULLIF(destino_resolvido, ''), ', ' ORDER BY NULLIF(destino_resolvido, '')) AS destinos,
      COUNT(DISTINCT (empresacon::text || ':' || COALESCE(seriecon, '') || ':' || codigocon::text)) FILTER (WHERE codigocon IS NOT NULL)::int AS documentos,
      COUNT(DISTINCT (empresamdfecvf::text || ':' || COALESCE(seriemdfecvf, '') || ':' || mdfecvf::text)) FILTER (WHERE mdfecvf IS NOT NULL)::int AS manifestos,
      COUNT(DISTINCT frete_seq) FILTER (WHERE frete_seq IS NOT NULL)::int AS fretes,
      COALESCE(SUM(receita_rateada), 0)::numeric AS receita,
      COALESCE(SUM(COALESCE(NULLIF(valorfretemotoristacvf, 0), NULLIF(valorfretepesomotoristacvf, 0), NULLIF(valorcomissaocvf, 0), 0)), 0)::numeric AS custo_motorista_fretes
    FROM documento_enriquecido
    GROUP BY 1
  ),
  viagens_info AS (
    SELECT
      g.grupo_id,
      cvg.empresacvg,
      cvg.codigocvg,
      COALESCE(cvg.datasaidacvg, cvg.dataacertocvg, cvg.datachegadacvg, g.data)::date AS data_viagem,
      cvg.motoristacvg AS motorista_codigo,
      COALESCE(mot.nomemot, cvg.motoristacvg::text) AS motorista,
      cvg.totalabastecimentoscvg,
      cvg.totaldespesascvg,
      cvg.totalpedagiocvg,
      cvg.totaldiariascvg,
      cvg.totaldespesasextrascvg,
      cvg.valorcomissaomotoristacvg,
      cvg.totaldespesasvalorcomissaocvg,
      cvg.totalviagemcvg,
      cvg.saldomotoristacvg,
      COALESCE(g.placa, UPPER(NULLIF(TRIM(cvg.veiculocvg::text), ''))) AS placa
    FROM grupos g
    LEFT JOIN logistica.controleviagens cvg ON cvg.codigocvg = g.viagem
    LEFT JOIN frotas.motoristas mot
      ON mot.codigomot = cvg.motoristacvg
     AND mot.empresamot = cvg.empresacvg
  ),
  despesas_viagem AS (
    SELECT codigocvd AS viagem, COALESCE(SUM(valorcvd), 0)::numeric AS despesas
    FROM logistica.controleviagensdespesas
    WHERE codigocvd IN (SELECT viagem FROM grupos WHERE viagem IS NOT NULL)
    GROUP BY codigocvd
  ),
  abastecimentos_viagem AS (
    SELECT cva.codigocva AS viagem, COALESCE(SUM(aba.totalaba), 0)::numeric AS abastecimentos
    FROM logistica.controleviagensabastecimentos cva
    JOIN frotas.abastecimentos aba
      ON aba.empresaaba = cva.empresaabastecimentocva
     AND aba.codigoaba = cva.abastecimentocva
    WHERE cva.codigocva IN (SELECT viagem FROM grupos WHERE viagem IS NOT NULL)
    GROUP BY cva.codigocva
  ),
  final AS (
    SELECT
      g.grupo_id,
      COALESCE(vi.data_viagem, g.data)::date AS data,
      g.data::date AS data_faturamento,
      g.viagem,
      g.clientes,
      COALESCE(vi.placa, g.placa) AS placa,
      vi.motorista,
      g.origens,
      g.destinos,
      g.documentos,
      g.manifestos,
      g.fretes,
      g.receita,
      COALESCE(NULLIF(vi.totalabastecimentoscvg, 0), av.abastecimentos, 0)::numeric AS custo_abastecimentos,
      COALESCE(NULLIF(vi.totaldespesascvg, 0), dv.despesas, 0)::numeric AS custo_despesas,
      COALESCE(vi.totalpedagiocvg, 0)::numeric AS custo_pedagio,
      COALESCE(vi.totaldiariascvg, 0)::numeric AS custo_diarias,
      COALESCE(vi.totaldespesasextrascvg, 0)::numeric AS custo_outros,
      COALESCE(NULLIF(vi.valorcomissaomotoristacvg, 0), NULLIF(vi.totaldespesasvalorcomissaocvg, 0), NULLIF(g.custo_motorista_fretes, 0), 0)::numeric AS custo_motorista,
      COALESCE(vi.totalviagemcvg, 0)::numeric AS total_acerto,
      COALESCE(vi.saldomotoristacvg, 0)::numeric AS saldo_motorista,
      vei.tipopropriedadevei AS tipo_propriedade,
      CASE
        WHEN vei.tipopropriedadevei::text = 'P' THEN 'Frota'
        WHEN COALESCE(vi.placa, g.placa) IS NULL THEN 'Sem placa'
        ELSE 'Terceiro'
      END AS tipo_veiculo
    FROM grupos g
    LEFT JOIN viagens_info vi ON vi.grupo_id = g.grupo_id
    LEFT JOIN despesas_viagem dv ON dv.viagem = g.viagem
    LEFT JOIN abastecimentos_viagem av ON av.viagem = g.viagem
    LEFT JOIN LATERAL (
      SELECT v.tipopropriedadevei, v.nomevei
      FROM frotas.veiculos v
      WHERE UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(COALESCE(vi.placa, g.placa)::text))
        AND COALESCE(v.situacaovei::text, '') <> 'I'
      ORDER BY v.empresavei
      LIMIT 1
    ) vei ON true
  )
`;

export async function getLucroViagens(filters = {}) {
  const period = resolvePeriod(filters);
  const tipoVeiculo = normalizeTipo(filters.tipoVeiculo || filters.tipo || filters.proprietario);
  const status = normalizeStatus(filters.status);
  const params = [
    period.startDate,
    period.endDate,
    filters.cliente || null,
    filters.placa || null,
    filters.origem || null,
    filters.destino || null,
    filters.material || filters.produto || null,
    tipoVeiculo,
  ];

  const where = `
    WHERE ($3::text IS NULL OR clientes ILIKE '%' || $3::text || '%')
      AND ($4::text IS NULL OR placa ILIKE '%' || $4::text || '%')
      AND ($5::text IS NULL OR origens ILIKE '%' || $5::text || '%')
      AND ($6::text IS NULL OR destinos ILIKE '%' || $6::text || '%')
      AND ($8::text = 'todos' OR LOWER(tipo_veiculo) = $8::text)
  `;

  const rowsQuery = `
    ${BASE_QUERY}
    SELECT
      grupo_id,
      viagem,
      data,
      data_faturamento,
      clientes AS cliente,
      placa,
      motorista,
      tipo_veiculo,
      origens AS origem,
      destinos AS destino,
      fretes,
      documentos,
      manifestos,
      receita,
      custo_abastecimentos,
      custo_despesas,
      custo_pedagio,
      custo_diarias,
      custo_outros,
      custo_motorista,
      total_acerto,
      saldo_motorista
    FROM final
    ${where}
    ORDER BY data DESC, viagem DESC NULLS LAST, grupo_id DESC
    LIMIT 3000
  `;

  const rowsRes = await clientPool.query(rowsQuery, params);

  let viagens = rowsRes.rows.map((row) => {
    const receita = num(row.receita);
    const custos = {
      motorista: r2(row.custo_motorista),
      abastecimentos: r2(row.custo_abastecimentos),
      despesas: r2(row.custo_despesas),
      pedagio: r2(row.custo_pedagio),
      diarias: r2(row.custo_diarias),
      manutencao: 0,
      outros: r2(row.custo_outros),
    };
    const custo = Object.values(custos).reduce((sum, value) => sum + num(value), 0);
    const lucro = receita - custo;
    const viagemLabel = row.viagem || formatGrupoId(row.grupo_id);
    return {
      id: String(row.grupo_id),
      viagem: viagemLabel,
      data: dateOnly(row.data),
      dataFaturamento: dateOnly(row.data_faturamento),
      cliente: row.cliente || "Sem cliente vinculado",
      placa: row.placa || "",
      motorista: row.motorista || "",
      tipoVeiculo: row.tipo_veiculo || "Sem placa",
      origem: row.origem || "",
      destino: row.destino || "",
      documentos: num(row.documentos),
      manifestos: num(row.manifestos),
      fretes: num(row.fretes),
      receita: r2(receita),
      custo: r2(custo),
      lucro: r2(lucro),
      margem: r2(receita > 0 ? (lucro / receita) * 100 : 0),
      status: statusLucro(lucro),
      custos,
      totalAcerto: r2(row.total_acerto),
      saldoMotorista: r2(row.saldo_motorista),
    };
  });

  if (status !== "todos") viagens = viagens.filter((row) => row.status === status);

  const receitaTotal = r2(viagens.reduce((sum, row) => sum + row.receita, 0));
  const custoTotal = r2(viagens.reduce((sum, row) => sum + row.custo, 0));
  const lucroTotal = r2(receitaTotal - custoTotal);
  const filtros = {
    clientes: [...new Set(rowsRes.rows.map((row) => row.cliente).filter(Boolean))].sort().slice(0, 300),
    placas: [...new Set(rowsRes.rows.map((row) => row.placa).filter(Boolean))].sort().slice(0, 300),
  };

  return {
    periodo: period,
    filtros,
    resumo: {
      faturamentoTotal: receitaTotal,
      custoTotal,
      lucroTotal,
      margemMedia: r2(receitaTotal > 0 ? (lucroTotal / receitaTotal) * 100 : 0),
      quantidadeViagens: viagens.length,
      quantidadeLucro: viagens.filter((row) => row.lucro >= 0).length,
      quantidadePrejuizo: viagens.filter((row) => row.lucro < 0).length,
    },
    viagens,
    audit: {
      tabelas: [
        "financeiro.receber",
        "financeiro.valorliquidorateiosreceber",
        "financeiro.receberconhecimentosvinculados",
        "financeiro.receberconhecimentos",
        "logistica.conhecimentos",
        "logistica.controleviagensfretes",
        "logistica.mdfe",
        "logistica.controleviagens",
      ],
      campos: {
        receita: "financeiro.valorliquidorateiosreceber.valorliquido, mesma base de receita bruta da DRE",
        documento: "CT-e via financeiro.receberconhecimentosvinculados/receberconhecimentos",
        manifesto: "MDF-e via logistica.controleviagensfretes.empresamdfecvf/seriemdfecvf/mdfecvf",
        viagem: "COALESCE(conhecimentos.viagemcon, conhecimentos.cargacontroleviagemcon, conhecimentos.numeroviagemcon, controleviagensfretes.codigocvf, mdfe.viagemmdf)",
        custos: "custos do acerto quando existe viagem vinculada; financeiro sem viagem fica com custo operacional zero",
      },
    },
  };
}
