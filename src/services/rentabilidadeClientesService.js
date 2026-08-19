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

function monthLabel(value) {
  if (!value) return "-";
  const [year, month] = String(value).split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  if (Number.isNaN(date.getTime())) return value;
  const label = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(date).replace(".", "");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}/${String(year).slice(2)}`;
}

function resolvePeriod({ startDate, endDate, dataInicial, dataFinal } = {}) {
  return {
    startDate: startDate || dataInicial || daysAgoIso(29),
    endDate: endDate || dataFinal || todayIso(),
  };
}

function margemStatus(lucro, receita) {
  const l = num(lucro);
  const r = num(receita);
  const margem = r > 0 ? (l / r) * 100 : (l < 0 ? -100 : 0);
  if (l < 0) return { id: "prejuizo", label: "Prejuizo", margem };
  if (margem >= 30) return { id: "lucrativo", label: "Lucrativo", margem };
  if (margem >= 10) return { id: "atencao", label: "Atencao", margem };
  return { id: "margem-baixa", label: "Margem baixa", margem };
}

function normalizeStatus(value) {
  const v = String(value || "todos").trim().toLowerCase();
  if (["lucrativo", "atencao", "atenção", "margem-baixa", "margem_baixa", "prejuizo", "prejuízo"].includes(v)) {
    return v.replace("atenção", "atencao").replace("margem_baixa", "margem-baixa").replace("prejuízo", "prejuizo");
  }
  return "todos";
}

function deriveMensalRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const iso = dateOnly(row.data);
    if (!iso) continue;
    const mesKey = `${iso.slice(0, 7)}-01`;
    if (!map.has(mesKey)) map.set(mesKey, { mes: mesKey, receita: 0, custo: 0, quantidade: 0 });
    const bucket = map.get(mesKey);
    bucket.receita += num(row.receita);
    bucket.custo += num(row.custo_total);
    bucket.quantidade += 1;
  }
  return { rows: Array.from(map.values()).sort((a, b) => a.mes.localeCompare(b.mes)) };
}

function deriveOptionsRow(rows) {
  const clientesSet = new Set();
  const placasSet = new Set();
  const origensSet = new Set();
  const destinosSet = new Set();
  const materiaisSet = new Set();
  for (const row of rows) {
    if (row.cliente_nome) clientesSet.add(row.cliente_nome);
    const placa = String(row.placa || "").trim();
    if (placa) placasSet.add(placa);
    const origem = String(row.origem || "").trim();
    if (origem) origensSet.add(origem);
    const destino = String(row.destino || "").trim();
    if (destino) destinosSet.add(destino);
    const material = String(row.material || "").trim();
    if (material) materiaisSet.add(material);
  }
  const sortSlice = (set) => Array.from(set).sort((a, b) => a.localeCompare(b)).slice(0, 300);
  return {
    rows: [{
      clientes: sortSlice(clientesSet),
      placas: sortSlice(placasSet),
      origens: sortSlice(origensSet),
      destinos: sortSlice(destinosSet),
      materiais: sortSlice(materiaisSet),
    }],
  };
}

function logRentabilidade(label, { sql, params, rows, totals } = {}) {
  if (process.env.DEBUG_SQL !== "1") return;
  console.log("[rentabilidade-clientes]", label, {
    params,
    rows,
    totals,
    sql: String(sql || "").replace(/\s+/g, " ").trim().slice(0, 1200),
  });
}

export const BASE_SQL = `
  WITH params AS (
    SELECT
      $1::date AS data_inicio,
      $2::date AS data_fim,
      NULLIF(TRIM($3::text), '') AS cliente,
      NULLIF(UPPER(TRIM($4::text)), '') AS placa,
      NULLIF(TRIM($5::text), '') AS origem,
      NULLIF(TRIM($6::text), '') AS destino,
      NULLIF(TRIM($7::text), '') AS material
  ),
  cvf_conhecimento AS (
    SELECT
      cvf.empresaconhecimentocvf AS empresa_con,
      cvf.serieconhecimentocvf AS serie_con,
      cvf.conhecimentocvf AS codigo_con,
      MIN(cvf.codigocvf) AS viagem,
      MAX(cvf.datacvf)::date AS data_frete,
      MAX(cvf.cidadeorigemcvf) AS cidade_origem,
      MAX(cvf.cidadedestinocvf) AS cidade_destino,
      MAX(NULLIF(TRIM(cvf.veiculocvf::text), '')) AS veiculo_cvf,
      COALESCE(SUM(cvf.valorfretecvf), 0)::numeric AS receita_frete,
      COALESCE(SUM(cvf.valortotalcvf), 0)::numeric AS receita_total_frete,
      COALESCE(SUM(cvf.valorfretemotoristacvf), 0)::numeric AS custo_motorista_frete,
      COALESCE(SUM(cvf.valorfretepesomotoristacvf), 0)::numeric AS custo_motorista_peso,
      COALESCE(SUM(cvf.valorcomissaocvf), 0)::numeric AS custo_comissao_frete
    FROM logistica.controleviagensfretes cvf
    WHERE cvf.conhecimentocvf IS NOT NULL
    GROUP BY cvf.empresaconhecimentocvf, cvf.serieconhecimentocvf, cvf.conhecimentocvf
  ),
  carta_counts AS (
    SELECT empresacfc, seriecfc, codigocfc, COUNT(*)::numeric AS qtd_conhecimentos
    FROM logistica.cartasfretesconhecimentos
    GROUP BY empresacfc, seriecfc, codigocfc
  ),
  carta_custos AS (
    SELECT
      cfc.empresacfc AS empresa_con,
      cfc.serieconhecimentocfc AS serie_con,
      cfc.conhecimentocfc AS codigo_con,
      COALESCE(SUM(
        (
          COALESCE(cfr.valorliquidocfr, cfr.valorfretecfr, 0)
          + COALESCE(cfr.valorpedagiocfr, 0)
          + COALESCE(cfr.valordiariacfr, 0)
          + COALESCE(cfr.valorcombustivelcfr, 0)
          + COALESCE(cfr.totaldespesasacessoriascfr, 0)
        ) / NULLIF(cc.qtd_conhecimentos, 0)
      ), 0)::numeric AS custo_carta_frete,
      STRING_AGG(DISTINCT (cfr.seriecfr || '-' || cfr.codigocfr::text), ', ') AS cartas_frete
    FROM logistica.cartasfretesconhecimentos cfc
    JOIN logistica.cartasfretes cfr
      ON cfr.empresacfr = cfc.empresacfc
     AND cfr.seriecfr = cfc.seriecfc
     AND cfr.codigocfr = cfc.codigocfc
    JOIN carta_counts cc
      ON cc.empresacfc = cfc.empresacfc
     AND cc.seriecfc = cfc.seriecfc
     AND cc.codigocfc = cfc.codigocfc
    GROUP BY cfc.empresacfc, cfc.serieconhecimentocfc, cfc.conhecimentocfc
  ),
  conhecimentos_base AS (
    SELECT
      ('cte:' || con.empresacon || ':' || con.seriecon || ':' || con.codigocon) AS id,
      con.empresacon,
      con.seriecon,
      con.codigocon,
      COALESCE(con.numeroctecon, con.codigocon) AS numero_cte,
      con.dataemissaocon::date AS data,
      COALESCE(con.viagemcon, cvf.viagem, con.numeroviagemcon, con.cargacontroleviagemcon) AS viagem,
      COALESCE(NULLIF(TRIM(con.veiculocon::text), ''), cvf.veiculo_cvf) AS placa,
      vei.tipopropriedadevei AS tipo_propriedade,
      CASE WHEN vei.tipopropriedadevei::text = 'P' THEN 'Frota' ELSE 'Terceiro' END AS tipo_veiculo,
      con.motoristacon AS motorista_codigo,
      COALESCE(mot.nomemot, NULLIF(TRIM(con.motoristacon::text), '')) AS motorista,
      con.representantecon AS comercial_codigo,
      COALESCE(NULLIF(TRIM(comercial.nome), ''), NULLIF(TRIM(con.representantecon::text), '')) AS comercial,
      COALESCE(cvf.cidade_origem, con.cidadecoletacon) AS cidade_origem_codigo,
      COALESCE(cvf.cidade_destino, con.cidadeentregacon) AS cidade_destino_codigo,
      COALESCE(
        NULLIF(CONCAT_WS('/', NULLIF(origem.nomecid, ''), NULLIF(TRIM(origem_uf.abreviaturaest), '')), ''),
        con.cidadecoletacon::text
      ) AS origem,
      COALESCE(
        NULLIF(CONCAT_WS('/', NULLIF(destino.nomecid, ''), NULLIF(TRIM(destino_uf.abreviaturaest), '')), ''),
        con.cidadeentregacon::text
      ) AS destino,
      COALESCE(NULLIF(con.naturezacargacon::text, ''), NULLIF(con.tipocargacon::text, ''), 'Nao informado') AS material,
      CASE
        WHEN con.tomadorservicoctecon = 4 AND con.tomadorservicooutroscon IS NOT NULL THEN con.tomadorservicooutroscon
        WHEN con.tomadorservicoctecon = 3 AND con.destinatariocon IS NOT NULL THEN con.destinatariocon
        WHEN con.tomadorservicoctecon = 2 AND con.recebedorcon IS NOT NULL THEN con.recebedorcon
        WHEN con.tomadorservicoctecon = 1 AND con.expedidorcon IS NOT NULL THEN con.expedidorcon
        ELSE con.clientecon
      END AS cliente_codigo,
      con.clientecon,
      con.destinatariocon,
      con.expedidorcon,
      con.recebedorcon,
      con.tomadorservicoctecon,
      COALESCE(NULLIF(cli.fantasiacli, ''), NULLIF(cli.nomecli, ''), 'Sem identificacao') AS cliente_nome,
      cli.cnpjcpfcli AS cliente_documento,
      COALESCE(NULLIF(dest_cli.fantasiacli, ''), NULLIF(dest_cli.nomecli, ''), '') AS destinatario_nome,
      COALESCE(NULLIF(exp_cli.fantasiacli, ''), NULLIF(exp_cli.nomecli, ''), '') AS expedidor_nome,
      COALESCE(NULLIF(rec_cli.fantasiacli, ''), NULLIF(rec_cli.nomecli, ''), '') AS recebedor_nome,
      -- Receita operacional: prioriza total do CT-e; cai para valor do frete do CT-e; por ultimo, valor do frete da viagem.
      COALESCE(NULLIF(con.totalcon, 0), NULLIF(con.valorfretecon, 0), NULLIF(cvf.receita_total_frete, 0), cvf.receita_frete, 0)::numeric AS receita,
      COALESCE(NULLIF(cvf.custo_motorista_frete, 0), NULLIF(cvf.custo_motorista_peso, 0), NULLIF(cvf.custo_comissao_frete, 0), NULLIF(con.viagemvalorfretemotoristacon, 0), 0)::numeric AS custo_motorista_direto,
      COALESCE(carta.custo_carta_frete, 0)::numeric AS custo_carta_frete,
      carta.cartas_frete
    FROM logistica.conhecimentos con
    LEFT JOIN cvf_conhecimento cvf
      ON cvf.empresa_con = con.empresacon
     AND cvf.serie_con = con.seriecon
     AND cvf.codigo_con = con.codigocon
    LEFT JOIN carta_custos carta
      ON carta.empresa_con = con.empresacon
     AND carta.serie_con = con.seriecon
     AND carta.codigo_con = con.codigocon
    LEFT JOIN localidades.cidades origem ON origem.codigocid = COALESCE(cvf.cidade_origem, con.cidadecoletacon)
    LEFT JOIN localidades.cidades destino ON destino.codigocid = COALESCE(cvf.cidade_destino, con.cidadeentregacon)
    LEFT JOIN localidades.estados origem_uf ON origem_uf.codigoest = origem.estadocid
    LEFT JOIN localidades.estados destino_uf ON destino_uf.codigoest = destino.estadocid
    LEFT JOIN LATERAL (
      SELECT NULLIF(TRIM(m.nomemot), '') AS nomemot
      FROM frotas.motoristas m
      WHERE m.codigomot = con.motoristacon
      ORDER BY (m.empresamot = con.empresacon) DESC, m.empresamot
      LIMIT 1
    ) mot ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(TRIM(p.nomepes), ''), NULLIF(TRIM(p.fantasiapes), ''), r.codigorep::text) AS nome
      FROM logistica.representantes r
      LEFT JOIN gerais.pessoas p ON p.codigorepresentantepes = r.codigorep
      WHERE r.codigorep = con.representantecon
      ORDER BY (NULLIF(TRIM(p.nomepes), '') IS NOT NULL) DESC
      LIMIT 1
    ) comercial ON true
    LEFT JOIN LATERAL (
      SELECT v.tipopropriedadevei
      FROM frotas.veiculos v
      WHERE UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(COALESCE(NULLIF(con.veiculocon::text, ''), cvf.veiculo_cvf)))
        AND COALESCE(v.situacaovei::text, '') <> 'I'
      ORDER BY (v.empresavei = con.empresacon) DESC, v.empresavei
      LIMIT 1
    ) vei ON true
    LEFT JOIN LATERAL (
      SELECT nomecli, fantasiacli, cnpjcpfcli
      FROM gerais.clientes
      WHERE codigocli = CASE
        WHEN con.tomadorservicoctecon = 4 AND con.tomadorservicooutroscon IS NOT NULL THEN con.tomadorservicooutroscon
        WHEN con.tomadorservicoctecon = 3 AND con.destinatariocon IS NOT NULL THEN con.destinatariocon
        WHEN con.tomadorservicoctecon = 2 AND con.recebedorcon IS NOT NULL THEN con.recebedorcon
        WHEN con.tomadorservicoctecon = 1 AND con.expedidorcon IS NOT NULL THEN con.expedidorcon
        ELSE con.clientecon
      END
      ORDER BY (empresacli = con.empresacon) DESC, empresacli
      LIMIT 1
    ) cli ON true
    LEFT JOIN LATERAL (SELECT nomecli, fantasiacli FROM gerais.clientes WHERE codigocli = con.destinatariocon LIMIT 1) dest_cli ON true
    LEFT JOIN LATERAL (SELECT nomecli, fantasiacli FROM gerais.clientes WHERE codigocli = con.expedidorcon LIMIT 1) exp_cli ON true
    LEFT JOIN LATERAL (SELECT nomecli, fantasiacli FROM gerais.clientes WHERE codigocli = con.recebedorcon LIMIT 1) rec_cli ON true
    CROSS JOIN params p
    WHERE (con.statuscon = 2 OR UPPER(TRIM(con.seriecon)) IN ('O', 'OC') OR NULLIF(TRIM(con.chaveorcamentocon), '') IS NOT NULL)
      AND con.dataemissaocon::date >= p.data_inicio
      AND con.dataemissaocon::date <= p.data_fim
      AND (p.cliente IS NULL OR CONCAT_WS(' ', con.clientecon::text, con.destinatariocon::text, cli.nomecli, cli.fantasiacli, cli.cnpjcpfcli) ILIKE '%' || p.cliente || '%')
      AND (p.placa IS NULL OR UPPER(TRIM(COALESCE(con.veiculocon, cvf.veiculo_cvf)::text)) ILIKE '%' || p.placa || '%')
      AND (p.origem IS NULL OR COALESCE(origem.nomecid, con.cidadecoletacon::text) ILIKE '%' || p.origem || '%')
      AND (p.destino IS NULL OR COALESCE(destino.nomecid, con.cidadeentregacon::text) ILIKE '%' || p.destino || '%')
      AND (p.material IS NULL OR CONCAT_WS(' ', con.naturezacargacon::text, con.tipocargacon::text, con.observacaonfcon) ILIKE '%' || p.material || '%')
  ),
  trip_totals AS (
    SELECT
      viagem,
      COALESCE(SUM(receita), 0)::numeric AS receita_viagem,
      COUNT(*)::numeric AS qtd_ctes
    FROM conhecimentos_base
    WHERE viagem IS NOT NULL
    GROUP BY viagem
  ),
  despesas_viagem AS (
    SELECT codigocvd AS viagem, COALESCE(SUM(valorcvd), 0)::numeric AS despesas
    FROM logistica.controleviagensdespesas
    GROUP BY codigocvd
  ),
  abastecimentos_viagem AS (
    SELECT
      cva.codigocva AS viagem,
      COALESCE(SUM(aba.totalaba), 0)::numeric AS abastecimentos
    FROM logistica.controleviagensabastecimentos cva
    JOIN frotas.abastecimentos aba
      ON aba.empresaaba = cva.empresaabastecimentocva
     AND aba.codigoaba = cva.abastecimentocva
    GROUP BY cva.codigocva
  ),
  custos_viagem AS (
    SELECT
      cvg.codigocvg AS viagem,
      COALESCE(NULLIF(ab.abastecimentos, 0), cvg.totalabastecimentoscvg, 0)::numeric AS abastecimentos,
      COALESCE(NULLIF(dv.despesas, 0), cvg.totaldespesascvg, 0)::numeric AS despesas,
      COALESCE(cvg.totalpedagiocvg, 0)::numeric AS pedagio,
      COALESCE(cvg.totaldiariascvg, 0)::numeric AS diarias,
      COALESCE(cvg.totaldespesasextrascvg, 0)::numeric AS outros,
      COALESCE(cvg.valorcomissaomotoristacvg, cvg.totaldespesasvalorcomissaocvg, 0)::numeric AS motorista_viagem,
      cvg.observacaocvg,
      cvg.obsprincipalcvg
    FROM logistica.controleviagens cvg
    LEFT JOIN despesas_viagem dv ON dv.viagem = cvg.codigocvg
    LEFT JOIN abastecimentos_viagem ab ON ab.viagem = cvg.codigocvg
  ),
  plate_month_totals AS (
    SELECT
      UPPER(TRIM(placa::text)) AS placa,
      DATE_TRUNC('month', data)::date AS mes,
      COALESCE(SUM(receita), 0)::numeric AS receita_mes,
      COUNT(*)::numeric AS qtd_ctes_mes
    FROM conhecimentos_base
    WHERE NULLIF(TRIM(placa::text), '') IS NOT NULL
    GROUP BY UPPER(TRIM(placa::text)), DATE_TRUNC('month', data)::date
  ),
  custos_manutencao AS (
    SELECT
      UPPER(TRIM(COALESCE(vei_doc.placavei, vei_cc.placavei, pag.veiculopag)::text)) AS placa,
      DATE_TRUNC('month', pag.datavencimentopag::date)::date AS mes,
      COALESCE(SUM(prt.valorrateioprt), 0)::numeric AS manutencao
    FROM financeiro.pagarrateios prt
    JOIN financeiro.pagar pag
      ON pag.empresapag = prt.empresaprt
     AND pag.seriepag = prt.serieprt
     AND pag.duplicatapag = prt.duplicataprt
     AND pag.parcelapag = prt.parcelaprt
     AND pag.fornecedorpag = prt.fornecedorprt
    LEFT JOIN LATERAL (
      SELECT nomecfi
      FROM financeiro.contasfinanceiras c
      WHERE c.codigocfi = prt.contafinanceiraprt
      ORDER BY (c.empresacfi = pag.empresapag) DESC, c.empresacfi
      LIMIT 1
    ) cfi ON true
    LEFT JOIN LATERAL (
      SELECT placavei
      FROM frotas.veiculos v
      WHERE NULLIF(TRIM(pag.veiculopag::text), '') IS NOT NULL
        AND UPPER(TRIM(v.placavei::text)) = UPPER(TRIM(pag.veiculopag::text))
      ORDER BY (v.empresavei = pag.empresapag) DESC, v.empresavei
      LIMIT 1
    ) vei_doc ON true
    LEFT JOIN LATERAL (
      SELECT placavei
      FROM frotas.veiculos v
      WHERE v.centrocustovei = prt.centrocustoprt
        AND NULLIF(TRIM(v.placavei::text), '') IS NOT NULL
      ORDER BY (v.empresavei = pag.empresapag) DESC, v.empresavei
      LIMIT 1
    ) vei_cc ON true
    CROSS JOIN params p
    WHERE pag.datavencimentopag::date >= p.data_inicio
      AND pag.datavencimentopag::date <= p.data_fim
      AND COALESCE(prt.valorrateioprt, 0) <> 0
      AND (COALESCE(cfi.nomecfi, '') ILIKE '%manuten%' OR COALESCE(cfi.nomecfi, '') ILIKE '%oficina%' OR COALESCE(cfi.nomecfi, '') ILIKE '%reparo%' OR COALESCE(cfi.nomecfi, '') ILIKE '%pneu%')
      AND NULLIF(TRIM(COALESCE(vei_doc.placavei, vei_cc.placavei, pag.veiculopag)::text), '') IS NOT NULL
    GROUP BY UPPER(TRIM(COALESCE(vei_doc.placavei, vei_cc.placavei, pag.veiculopag)::text)), DATE_TRUNC('month', pag.datavencimentopag::date)::date
  ),
  conhecimento_custos AS (
    SELECT
      cb.*,
      COALESCE(cv.abastecimentos, 0) * CASE WHEN tt.receita_viagem > 0 THEN cb.receita / tt.receita_viagem ELSE 1 / NULLIF(tt.qtd_ctes, 0) END AS custo_abastecimentos,
      COALESCE(cv.despesas, 0) * CASE WHEN tt.receita_viagem > 0 THEN cb.receita / tt.receita_viagem ELSE 1 / NULLIF(tt.qtd_ctes, 0) END AS custo_despesas,
      COALESCE(cv.pedagio, 0) * CASE WHEN tt.receita_viagem > 0 THEN cb.receita / tt.receita_viagem ELSE 1 / NULLIF(tt.qtd_ctes, 0) END AS custo_pedagio,
      COALESCE(cv.diarias, 0) * CASE WHEN tt.receita_viagem > 0 THEN cb.receita / tt.receita_viagem ELSE 1 / NULLIF(tt.qtd_ctes, 0) END AS custo_diarias,
      COALESCE(cv.outros, 0) * CASE WHEN tt.receita_viagem > 0 THEN cb.receita / tt.receita_viagem ELSE 1 / NULLIF(tt.qtd_ctes, 0) END AS custo_outros_viagem,
      CASE
        WHEN COALESCE(cb.custo_motorista_direto, 0) > 0 THEN cb.custo_motorista_direto
        WHEN COALESCE(cb.custo_carta_frete, 0) > 0 THEN cb.custo_carta_frete
        ELSE COALESCE(cv.motorista_viagem, 0) * CASE WHEN tt.receita_viagem > 0 THEN cb.receita / tt.receita_viagem ELSE 1 / NULLIF(tt.qtd_ctes, 0) END
      END AS custo_motorista,
      COALESCE(cm.manutencao, 0) * CASE WHEN pmt.receita_mes > 0 THEN cb.receita / pmt.receita_mes ELSE 1 / NULLIF(pmt.qtd_ctes_mes, 0) END AS custo_manutencao,
      CASE
        WHEN cb.viagem IS NULL AND COALESCE(cm.manutencao, 0) > 0 THEN 'Sem viagem vinculada ao CT-e; custos de viagem nao puderam ser rateados. Manutencao rateada por placa/mes via financeiro.pagar + centro de custo.'
        WHEN cb.viagem IS NULL THEN 'Sem viagem vinculada ao CT-e; custos de viagem nao puderam ser rateados.'
        WHEN COALESCE(cm.manutencao, 0) > 0 THEN 'Manutencao rateada por placa/mes via financeiro.pagar + centro de custo.'
        ELSE ''
      END AS observacao_custo
    FROM conhecimentos_base cb
    LEFT JOIN trip_totals tt ON tt.viagem = cb.viagem
    LEFT JOIN custos_viagem cv ON cv.viagem = cb.viagem
    LEFT JOIN plate_month_totals pmt
      ON pmt.placa = UPPER(TRIM(cb.placa::text))
     AND pmt.mes = DATE_TRUNC('month', cb.data)::date
    LEFT JOIN custos_manutencao cm
      ON cm.placa = UPPER(TRIM(cb.placa::text))
     AND cm.mes = DATE_TRUNC('month', cb.data)::date
  ),
  final AS (
    SELECT
      *,
      COALESCE(custo_motorista, 0)
      + COALESCE(custo_abastecimentos, 0)
      + COALESCE(custo_despesas, 0)
      + COALESCE(custo_pedagio, 0)
      + COALESCE(custo_diarias, 0)
      + COALESCE(custo_manutencao, 0)
      + COALESCE(custo_outros_viagem, 0) AS custo_total
    FROM conhecimento_custos
  )
`;

export async function getRentabilidadeClientes(filters = {}) {
  const period = resolvePeriod(filters);
  const params = [
    period.startDate,
    period.endDate,
    filters.cliente || null,
    filters.placa || null,
    filters.origem || null,
    filters.destino || null,
    filters.material || filters.produto || null,
  ];

  const detailQuery = `
    ${BASE_SQL}
    SELECT
      id, empresacon, seriecon, codigocon, numero_cte, data, viagem, placa, tipo_propriedade, tipo_veiculo, motorista_codigo, motorista,
      comercial_codigo, comercial,
      cidade_origem_codigo, cidade_destino_codigo, origem, destino, material,
      cliente_codigo, cliente_nome, cliente_documento, clientecon, destinatariocon, destinatario_nome,
      expedidorcon, expedidor_nome, recebedorcon, recebedor_nome, tomadorservicoctecon,
      receita, custo_motorista, custo_abastecimentos, custo_despesas, custo_pedagio, custo_diarias,
      custo_manutencao, custo_outros_viagem, custo_total, cartas_frete, observacao_custo
    FROM final
    ORDER BY data DESC, cliente_nome, codigocon DESC
    LIMIT 5000
  `;

  const mensalQuery = `
    ${BASE_SQL}
    SELECT
      DATE_TRUNC('month', data)::date AS mes,
      COALESCE(SUM(receita), 0) AS receita,
      COALESCE(SUM(custo_total), 0) AS custo,
      COUNT(*)::int AS quantidade
    FROM final
    GROUP BY mes
    ORDER BY mes
  `;

  const optionsQuery = `
    ${BASE_SQL}
    SELECT
      ARRAY(SELECT DISTINCT cliente_nome FROM final WHERE cliente_nome IS NOT NULL ORDER BY cliente_nome LIMIT 300) AS clientes,
      ARRAY(SELECT DISTINCT placa FROM final WHERE NULLIF(TRIM(placa::text), '') IS NOT NULL ORDER BY placa LIMIT 300) AS placas,
      ARRAY(SELECT DISTINCT origem FROM final WHERE NULLIF(TRIM(origem::text), '') IS NOT NULL ORDER BY origem LIMIT 300) AS origens,
      ARRAY(SELECT DISTINCT destino FROM final WHERE NULLIF(TRIM(destino::text), '') IS NOT NULL ORDER BY destino LIMIT 300) AS destinos,
      ARRAY(SELECT DISTINCT material FROM final WHERE NULLIF(TRIM(material::text), '') IS NOT NULL ORDER BY material LIMIT 300) AS materiais
  `;

  const detailRes = await clientPool.query(detailQuery, params);

  // mensal e filtros sao apenas agregacoes do mesmo resultado de "detail": derivar em JS
  // evita rodar a cadeia pesada de CTEs (BASE_SQL) mais duas vezes no banco (~3x mais rapido).
  // Fallback para consultas separadas apenas se o LIMIT 5000 do detail tiver sido atingido,
  // caso em que a derivacao local ficaria incompleta.
  const hitDetailLimit = detailRes.rowCount >= 5000;
  const [mensalRes, optionsRes] = hitDetailLimit
    ? await Promise.all([
        clientPool.query(mensalQuery, params),
        clientPool.query(optionsQuery, params),
      ])
    : [deriveMensalRows(detailRes.rows), deriveOptionsRow(detailRes.rows)];

  logRentabilidade("consultas-base", {
    sql: detailQuery,
    params,
    rows: {
      detalhes: detailRes.rowCount,
      mensal: mensalRes.rows.length,
      opcoes: optionsRes.rows.length,
      derivadoLocalmente: !hitDetailLimit,
    },
  });

  const viagens = detailRes.rows.map((row) => {
    const receita = num(row.receita);
    const custo = num(row.custo_total);
    const lucro = receita - custo;
    const status = margemStatus(lucro, receita);
    return {
      id: row.id,
      empresa: row.empresacon,
      serie: row.seriecon,
      codigo: row.codigocon,
      numero: row.numero_cte,
      data: dateOnly(row.data),
      viagem: row.viagem,
      placa: row.placa || "",
      tipoPropriedade: row.tipo_propriedade || null,
      tipoVeiculo: row.tipo_veiculo || "Terceiro",
      motorista: row.motorista || "",
      comercialCodigo: row.comercial_codigo || null,
      comercial: row.comercial || "Nao informado",
      origem: row.origem || "",
      destino: row.destino || "",
      material: row.material || "",
      clienteCodigo: row.cliente_codigo,
      cliente: row.cliente_nome || "Sem identificacao",
      documento: row.cliente_documento || "",
      receita: r2(receita),
      custo: r2(custo),
      lucro: r2(lucro),
      margem: r2(status.margem),
      status: status.id,
      statusLabel: status.label,
      custos: {
        motorista: r2(row.custo_motorista),
        abastecimentos: r2(row.custo_abastecimentos),
        despesas: r2(row.custo_despesas),
        pedagio: r2(row.custo_pedagio),
        diarias: r2(row.custo_diarias),
        manutencao: r2(row.custo_manutencao),
        outros: r2(row.custo_outros_viagem),
      },
      cartasFrete: row.cartas_frete || "",
      observacao: row.observacao_custo || "",
    };
  });

  const clientMap = new Map();
  for (const v of viagens) {
    const key = String(v.clienteCodigo || v.cliente || "sem");
    if (!clientMap.has(key)) {
      clientMap.set(key, {
        clienteCodigo: v.clienteCodigo,
        cliente: v.cliente,
        documento: v.documento,
        quantidadeViagens: 0,
        receitaTotal: 0,
        custoTotal: 0,
        lucro: 0,
        ultimaViagem: null,
        viagens: [],
      });
    }
    const item = clientMap.get(key);
    item.quantidadeViagens += 1;
    item.receitaTotal += v.receita;
    item.custoTotal += v.custo;
    item.lucro += v.lucro;
    if (!item.ultimaViagem || String(v.data) > String(item.ultimaViagem)) item.ultimaViagem = v.data;
    item.viagens.push(v);
  }

  const statusFilter = normalizeStatus(filters.statusMargem || filters.tipoCliente || filters.status);
  let clientes = Array.from(clientMap.values()).map((item) => {
    const status = margemStatus(item.lucro, item.receitaTotal);
    return {
      ...item,
      receitaTotal: r2(item.receitaTotal),
      custoTotal: r2(item.custoTotal),
      lucro: r2(item.lucro),
      margem: r2(status.margem),
      ticketMedio: r2(item.quantidadeViagens > 0 ? item.receitaTotal / item.quantidadeViagens : 0),
      status: status.id,
      statusLabel: status.label,
      viagens: item.viagens.sort((a, b) => String(b.data).localeCompare(String(a.data))),
    };
  });

  if (statusFilter !== "todos") {
    clientes = clientes.filter((item) => item.status === statusFilter);
  }

  clientes.sort((a, b) => b.lucro - a.lucro);

  const receitaTotal = r2(clientes.reduce((sum, item) => sum + item.receitaTotal, 0));
  const custoTotal = r2(clientes.reduce((sum, item) => sum + item.custoTotal, 0));
  const lucroTotal = r2(receitaTotal - custoTotal);
  const margemMedia = r2(receitaTotal > 0 ? (lucroTotal / receitaTotal) * 100 : 0);
  const qtdViagens = clientes.reduce((sum, item) => sum + item.quantidadeViagens, 0);
  const ticketMedioCliente = r2(clientes.length > 0 ? receitaTotal / clientes.length : 0);
  const clienteMaisLucrativo = clientes.length ? [...clientes].sort((a, b) => b.lucro - a.lucro)[0] : null;
  const clienteMaiorPrejuizo = clientes.filter((item) => item.lucro < 0).sort((a, b) => a.lucro - b.lucro)[0] || null;

  const mensal = mensalRes.rows.map((row) => {
    const receita = num(row.receita);
    const custo = num(row.custo);
    const lucro = receita - custo;
    return {
      mes: dateOnly(row.mes),
      label: monthLabel(dateOnly(row.mes)),
      receita: r2(receita),
      custo: r2(custo),
      lucro: r2(lucro),
      margem: r2(receita > 0 ? (lucro / receita) * 100 : 0),
      quantidade: num(row.quantidade),
    };
  });

  return {
    periodo: period,
    resumo: {
      receitaTotal,
      custoTotal,
      lucroTotal,
      margemMedia,
      quantidadeViagens: qtdViagens,
      quantidadeConhecimentos: viagens.length,
      ticketMedioCliente,
      clienteMaisLucrativo: clienteMaisLucrativo ? { cliente: clienteMaisLucrativo.cliente, valor: clienteMaisLucrativo.lucro } : null,
      clienteMaiorPrejuizo: clienteMaiorPrejuizo ? { cliente: clienteMaiorPrejuizo.cliente, valor: clienteMaiorPrejuizo.lucro } : null,
    },
    clientes,
    mensal,
    rankings: {
      lucro: [...clientes].sort((a, b) => b.lucro - a.lucro).slice(0, 10),
      prejuizo: clientes.filter((item) => item.lucro < 0).sort((a, b) => a.lucro - b.lucro).slice(0, 10),
      margem: [...clientes].filter((item) => item.receitaTotal > 0).sort((a, b) => b.margem - a.margem).slice(0, 10),
    },
    filtros: optionsRes.rows[0] || { clientes: [], placas: [], origens: [], destinos: [], materiais: [] },
    fontes: {
      receita: "logistica.conhecimentos.totalcon/valorfretecon, com fallback de logistica.controleviagensfretes.",
      custos: "logistica.controleviagens, logistica.controleviagensdespesas, logistica.controleviagensabastecimentos, logistica.cartasfretes e financeiro.pagar para manutencao por placa/mes.",
      observacao: "financeiro.receber nao entra no calculo para evitar duplicidade com CT-e/conhecimento.",
    },
    audit: {
      tablesFound: [
        "logistica.conhecimentos",
        "logistica.controleviagens",
        "logistica.controleviagensfretes",
        "logistica.controleviagensdespesas",
        "logistica.controleviagensabastecimentos",
        "logistica.cartasfretes",
        "logistica.cartasfretesconhecimentos",
        "frotas.abastecimentos",
        "frotas.veiculos",
        "frotas.motoristas",
        "financeiro.pagar",
        "financeiro.pagarrateios",
        "financeiro.contasfinanceiras",
        "gerais.clientes",
        "localidades.cidades",
      ],
      fieldsUsed: {
        receita: ["conhecimentos.totalcon", "conhecimentos.valorfretecon", "controleviagensfretes.valortotalcvf"],
        clienteTomador: ["tomadorservicoctecon", "tomadorservicooutroscon", "destinatariocon", "recebedorcon", "expedidorcon", "clientecon"],
        custosOperacionais: ["cartasfretes.valorliquidocfr", "controleviagens.totalabastecimentoscvg", "controleviagensdespesas.valorcvd", "pagarrateios.valorrateioprt"],
      },
      pending: [
        "Manutencao de financeiro.pagar e rateada por placa/mes quando nao existe vinculo direto com CT-e.",
        "Tabelas logistica.abastecimentos/logistica.despesas nao existem neste banco; foram usadas frotas.abastecimentos e logistica.controleviagensdespesas.",
      ],
    },
  };
}
