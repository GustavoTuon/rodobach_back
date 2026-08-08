import { tableName } from "../config.js";
import { clientPool } from "../db/clientPool.js";
import { pool } from "../db/pool.js";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return Math.round(num(value) * 100) / 100;
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function todayISO() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}

function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}

function clean(value) {
  return String(value || "").trim();
}

function normalizeText(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeKey(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function resolvePeriod(filters = {}) {
  return {
    startDate: dateOnly(filters.startDate || filters.dataInicio) || daysAgoISO(6),
    endDate: dateOnly(filters.endDate || filters.dataFim) || todayISO(),
  };
}

function mapAcordo(row) {
  return {
    id: row.id,
    ativo: Boolean(row.ativo),
    postoCodigo: row.posto_codigo,
    postoNome: row.posto_nome,
    cidade: row.cidade,
    uf: row.uf,
    grupoClienteCodigo: row.grupo_cliente_codigo,
    grupoCliente: row.grupo_cliente,
    produtoCodigo: row.produto_codigo,
    produtoNome: row.produto_nome,
    valorMaximo: num(row.valor_maximo),
    tolerancia: num(row.tolerancia),
    vigenciaInicio: dateOnly(row.vigencia_inicio),
    vigenciaFim: dateOnly(row.vigencia_fim),
    contatoNome: row.contato_nome,
    contatoTelefone: row.contato_telefone,
    linkWhatsapp: row.link_whatsapp,
    observacoes: row.observacoes,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
    origemImportacao: row.origem_importacao,
  };
}

function agreementMatchesFuel(acordo, row) {
  const agreementStation = normalizeKey(acordo.postoCodigo);
  const agreementStationName = normalizeKey(acordo.postoNome);
  const rowStationCode = normalizeKey(row.posto);
  const rowStationName = normalizeKey(row.posto_nome);
  const stationMatches = agreementStation === rowStationCode
    || (agreementStation && rowStationName.includes(agreementStation))
    || (agreementStationName && rowStationName.includes(agreementStationName))
    || (agreementStationName && agreementStationName.includes(rowStationName));
  if (!stationMatches) return false;
  if (acordo.grupoClienteCodigo && String(acordo.grupoClienteCodigo) !== String(row.grupo_cliente_codigo || "")) return false;
  if (!acordo.produtoCodigo && !acordo.produtoNome) return true;
  if (acordo.produtoCodigo && clean(acordo.produtoCodigo) === clean(row.produto_codigo)) return true;

  const agreementProduct = normalizeText(acordo.produtoNome);
  const fuelProduct = normalizeText(row.produto_nome);
  if (!agreementProduct) return true;
  return fuelProduct.includes(agreementProduct) || agreementProduct.includes(fuelProduct);
}

function compareAgreement(a, b) {
  const aGroup = a.grupoClienteCodigo ? 1 : 0;
  const bGroup = b.grupoClienteCodigo ? 1 : 0;
  if (aGroup !== bGroup) return bGroup - aGroup;
  const aSpecific = a.produtoCodigo || a.produtoNome ? 1 : 0;
  const bSpecific = b.produtoCodigo || b.produtoNome ? 1 : 0;
  if (aSpecific !== bSpecific) return bSpecific - aSpecific;
  return String(b.vigenciaInicio || "").localeCompare(String(a.vigenciaInicio || ""));
}

export async function listAbastecimentoAcordos(filters = {}) {
  const where = [];
  const params = [];

  if (filters.search) {
    params.push(`%${clean(filters.search)}%`);
    where.push(`(
      posto_codigo ILIKE $${params.length}
      OR posto_nome ILIKE $${params.length}
      OR grupo_cliente ILIKE $${params.length}
      OR produto_nome ILIKE $${params.length}
    )`);
  }

  if (filters.ativo === "true" || filters.ativo === true) where.push("ativo = TRUE");
  if (filters.ativo === "false" || filters.ativo === false) where.push("ativo = FALSE");

  const sql = `
    SELECT *
    FROM ${tableName("abastecimento_acordos")}
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ativo DESC, posto_nome NULLS LAST, posto_codigo, grupo_cliente, produto_nome NULLS LAST, vigencia_inicio DESC, id DESC
  `;
  const { rows } = await pool.query(sql, params);
  return { acordos: rows.map(mapAcordo) };
}

export async function saveAbastecimentoAcordo(payload = {}) {
  const postoCodigo = clean(payload.postoCodigo || payload.posto_codigo);
  const valorMaximo = num(payload.valorMaximo ?? payload.valor_maximo);
  if (!postoCodigo) {
    const error = new Error("Informe o codigo do posto.");
    error.status = 400;
    throw error;
  }
  if (valorMaximo <= 0) {
    const error = new Error("Informe um valor combinado maior que zero.");
    error.status = 400;
    throw error;
  }

  const values = [
    payload.ativo !== undefined ? Boolean(payload.ativo) : true,
    postoCodigo,
    clean(payload.postoNome || payload.posto_nome) || null,
    clean(payload.cidade) || null,
    clean(payload.uf).toUpperCase() || null,
    payload.grupoClienteCodigo || payload.grupo_cliente_codigo || null,
    clean(payload.grupoCliente || payload.grupo_cliente) || "Geral",
    clean(payload.produtoCodigo || payload.produto_codigo) || null,
    clean(payload.produtoNome || payload.produto_nome) || null,
    valorMaximo,
    num(payload.tolerancia),
    dateOnly(payload.vigenciaInicio || payload.vigencia_inicio) || todayISO(),
    dateOnly(payload.vigenciaFim || payload.vigencia_fim),
    clean(payload.contatoNome || payload.contato_nome) || null,
    clean(payload.contatoTelefone || payload.contato_telefone) || null,
    clean(payload.linkWhatsapp || payload.link_whatsapp) || null,
    clean(payload.observacoes) || null,
  ];

  if (payload.id) {
    const { rows } = await pool.query(`
      UPDATE ${tableName("abastecimento_acordos")}
      SET ativo = $1, posto_codigo = $2, posto_nome = $3, cidade = $4, uf = $5,
          grupo_cliente_codigo = $6, grupo_cliente = $7, produto_codigo = $8, produto_nome = $9,
          valor_maximo = $10, tolerancia = $11, vigencia_inicio = $12, vigencia_fim = $13,
          contato_nome = $14, contato_telefone = $15, link_whatsapp = $16,
          observacoes = $17, atualizado_em = NOW()
      WHERE id = $18
      RETURNING *
    `, [...values, payload.id]);
    if (!rows.length) {
      const error = new Error("Acordo nao encontrado.");
      error.status = 404;
      throw error;
    }
    return { acordo: mapAcordo(rows[0]) };
  }

  const { rows } = await pool.query(`
    INSERT INTO ${tableName("abastecimento_acordos")} (
      ativo, posto_codigo, posto_nome, cidade, uf, grupo_cliente_codigo, grupo_cliente, produto_codigo, produto_nome,
      valor_maximo, tolerancia, vigencia_inicio, vigencia_fim, contato_nome, contato_telefone,
      link_whatsapp, observacoes
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    RETURNING *
  `, values);
  return { acordo: mapAcordo(rows[0]) };
}

export async function deleteAbastecimentoAcordo(id) {
  const { rowCount } = await pool.query(`DELETE FROM ${tableName("abastecimento_acordos")} WHERE id = $1`, [id]);
  return rowCount > 0;
}

export async function listGruposClientes() {
  const { rows } = await clientPool.query(`
    SELECT
      grp.codigogrc AS codigo,
      grp.nomegrc AS nome,
      COUNT(cli.codigocli)::int AS clientes
    FROM gerais.gruposclientes grp
    LEFT JOIN gerais.clientes cli ON cli.grupoclientecli = grp.codigogrc
    WHERE COALESCE(grp.ativogrc, 'S') = 'S'
    GROUP BY grp.codigogrc, grp.nomegrc
    ORDER BY grp.nomegrc
  `);

  return {
    grupos: rows.map((row) => ({
      codigo: row.codigo,
      nome: row.nome,
      clientes: num(row.clientes),
    })),
  };
}

export async function listPostosAbastecimento(q = "") {
  const params = [];
  const where = [];
  if (q) {
    params.push(`%${clean(q)}%`);
    where.push(`(a.postocombustivelaba::text ILIKE $1 OR posto.nome_posto ILIKE $1 OR produto.nome_combustivel ILIKE $1)`);
  }

  const { rows } = await clientPool.query(`
    SELECT
      a.postocombustivelaba::text AS posto_codigo,
      COALESCE(posto.nome_posto, 'Posto ' || a.postocombustivelaba::text) AS posto_nome,
      posto.cidade,
      posto.uf,
      a.combustivelaba::text AS produto_codigo,
      produto.nome_combustivel AS produto_nome,
      MAX(a.dataaba)::date AS ultima_data,
      COUNT(*)::int AS abastecimentos
    FROM frotas.abastecimentos a
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(NULLIF(f.fantasiafor, ''), NULLIF(f.nomefor, ''), 'Posto ' || f.codigofor::text) AS nome_posto,
        cid.nomecid AS cidade,
        est.abreviaturaest AS uf
      FROM gerais.fornecedores f
      LEFT JOIN localidades.cep z ON z.codigocep::text = regexp_replace(COALESCE(f.cepfor::text, ''), '\\D', '', 'g')
      LEFT JOIN localidades.cidades cid ON cid.codigocid = z.cidadecep
      LEFT JOIN localidades.estados est ON est.codigoest = cid.estadocid
      WHERE f.codigofor = a.postocombustivelaba
      ORDER BY (f.empresafor = a.empresaaba) DESC, f.empresafor
      LIMIT 1
    ) posto ON true
    LEFT JOIN LATERAL (
      SELECT p.nomepro AS nome_combustivel
      FROM estoque.produtos p
      WHERE p.codigopro = a.combustivelaba
      ORDER BY (p.empresapro = a.empresaaba) DESC, p.empresapro
      LIMIT 1
    ) produto ON true
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    GROUP BY a.postocombustivelaba, posto.nome_posto, posto.cidade, posto.uf, a.combustivelaba, produto.nome_combustivel
    ORDER BY ultima_data DESC NULLS LAST, abastecimentos DESC
    LIMIT 80
  `, params);

  return {
    postos: rows.map((row) => ({
      postoCodigo: row.posto_codigo,
      postoNome: row.posto_nome,
      cidade: row.cidade || "",
      uf: row.uf || "",
      produtoCodigo: row.produto_codigo,
      produtoNome: row.produto_nome || "",
      ultimaData: dateOnly(row.ultima_data),
      abastecimentos: num(row.abastecimentos),
    })),
  };
}

export async function getDivergenciasAbastecimento(filters = {}) {
  const period = resolvePeriod(filters);
  const agreementsResult = await pool.query(`
    SELECT *
    FROM ${tableName("abastecimento_acordos")}
    WHERE ativo = TRUE
      AND vigencia_inicio <= $2::date
      AND (vigencia_fim IS NULL OR vigencia_fim >= $1::date)
    ORDER BY posto_codigo, produto_codigo NULLS LAST, produto_nome NULLS LAST, vigencia_inicio DESC
  `, [period.startDate, period.endDate]);
  const acordos = agreementsResult.rows.map(mapAcordo);

  const params = [period.startDate, period.endDate];
  const where = ["a.dataaba::date BETWEEN $1::date AND $2::date"];
  if (filters.fornecedor || filters.postoCodigo) {
    params.push(clean(filters.fornecedor || filters.postoCodigo));
    where.push(`a.postocombustivelaba::text = $${params.length}`);
  }
  if (filters.placa) {
    params.push(clean(filters.placa).toUpperCase());
    where.push(`UPPER(TRIM(a.veiculoaba::text)) = $${params.length}`);
  }

  const { rows } = await clientPool.query(`
    SELECT
      a.empresaaba AS empresa,
      a.codigoaba AS codigo,
      a.dataaba::date AS data,
      UPPER(TRIM(a.veiculoaba::text)) AS placa,
      a.postocombustivelaba::text AS posto,
      COALESCE(posto.nome_posto, 'Posto ' || a.postocombustivelaba::text) AS posto_nome,
      posto.cidade AS posto_cidade,
      posto.uf AS posto_uf,
      a.combustivelaba::text AS produto_codigo,
      produto.nome_combustivel AS produto_nome,
      a.litrosaba AS litros,
      a.valorlitroaba AS valor_litro_tabela,
      a.totalaba / NULLIF(a.litrosaba, 0) AS valor_litro,
      a.totalaba AS total,
      a.financeiroaba AS financeiro,
      cliente_viagem.cliente_codigo,
      cliente_viagem.cliente_nome,
      cliente_viagem.grupo_cliente_codigo,
      cliente_viagem.grupo_cliente_nome
    FROM frotas.abastecimentos a
    LEFT JOIN LATERAL (
      SELECT
        con.clientecon AS cliente_codigo,
        COALESCE(NULLIF(cli.fantasiacli, ''), NULLIF(cli.nomecli, ''), con.clientecon::text) AS cliente_nome,
        cli.grupoclientecli AS grupo_cliente_codigo,
        grp.nomegrc AS grupo_cliente_nome
      FROM logistica.conhecimentos con
      LEFT JOIN gerais.clientes cli ON cli.codigocli = con.clientecon
      LEFT JOIN gerais.gruposclientes grp ON grp.codigogrc = cli.grupoclientecli
      WHERE con.viagemcon = COALESCE(a.viagemaba, (
        SELECT cva.codigocva
        FROM logistica.controleviagensabastecimentos cva
        WHERE cva.empresaabastecimentocva = a.empresaaba
          AND cva.abastecimentocva = a.codigoaba
        LIMIT 1
      ))
      ORDER BY con.dataemissaocon DESC NULLS LAST, con.codigocon DESC
      LIMIT 1
    ) cliente_viagem ON true
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(NULLIF(f.fantasiafor, ''), NULLIF(f.nomefor, ''), 'Posto ' || f.codigofor::text) AS nome_posto,
        cid.nomecid AS cidade,
        est.abreviaturaest AS uf
      FROM gerais.fornecedores f
      LEFT JOIN localidades.cep z ON z.codigocep::text = regexp_replace(COALESCE(f.cepfor::text, ''), '\\D', '', 'g')
      LEFT JOIN localidades.cidades cid ON cid.codigocid = z.cidadecep
      LEFT JOIN localidades.estados est ON est.codigoest = cid.estadocid
      WHERE f.codigofor = a.postocombustivelaba
      ORDER BY (f.empresafor = a.empresaaba) DESC, f.empresafor
      LIMIT 1
    ) posto ON true
    LEFT JOIN LATERAL (
      SELECT p.nomepro AS nome_combustivel
      FROM estoque.produtos p
      WHERE p.codigopro = a.combustivelaba
      ORDER BY (p.empresapro = a.empresaaba) DESC, p.empresapro
      LIMIT 1
    ) produto ON true
    WHERE ${where.join(" AND ")}
      AND COALESCE(a.litrosaba, 0) > 0
      AND COALESCE(a.totalaba, 0) > 0
    ORDER BY a.dataaba DESC, a.codigoaba DESC
    LIMIT 1000
  `, params);

  const divergencias = [];
  for (const row of rows) {
    const candidates = acordos.filter((acordo) => agreementMatchesFuel(acordo, row)).sort(compareAgreement);
    const acordo = candidates[0];
    if (!acordo) continue;

    const valorLitro = num(row.valor_litro) || num(row.valor_litro_tabela);
    const limite = num(acordo.valorMaximo) + num(acordo.tolerancia);
    if (valorLitro <= limite) continue;

    const litros = num(row.litros);
    divergencias.push({
      empresa: row.empresa,
      codigo: row.codigo,
      data: dateOnly(row.data),
      placa: row.placa,
      postoCodigo: row.posto,
      postoNome: row.posto_nome,
      cidade: row.posto_cidade,
      uf: row.posto_uf,
      produtoCodigo: row.produto_codigo,
      produtoNome: row.produto_nome,
      clienteCodigo: row.cliente_codigo,
      clienteNome: row.cliente_nome,
      clienteGrupoCodigo: row.grupo_cliente_codigo,
      grupoClienteNome: row.grupo_cliente_nome,
      litros: money(litros),
      valorLitro: money(valorLitro),
      valorCombinado: money(acordo.valorMaximo),
      tolerancia: money(acordo.tolerancia),
      valorLimite: money(limite),
      excedenteLitro: money(valorLitro - limite),
      excedenteTotal: money((valorLitro - limite) * litros),
      total: money(row.total),
      financeiro: Boolean(row.financeiro),
      acordoId: acordo.id,
      grupoClienteCodigo: acordo.grupoClienteCodigo,
      grupoCliente: acordo.grupoCliente,
      contatoNome: acordo.contatoNome,
      contatoTelefone: acordo.contatoTelefone,
      linkWhatsapp: acordo.linkWhatsapp,
      mensagem: `Alerta de combustivel: ${row.posto_nome} cobrou R$ ${money(valorLitro).toFixed(2).replace(".", ",")}/l em ${dateOnly(row.data)} (${row.produto_nome || "combustivel"}), acima do combinado de R$ ${money(acordo.valorMaximo).toFixed(2).replace(".", ",")}/l.`,
    });
  }

  const totalExcedente = divergencias.reduce((sum, row) => sum + row.excedenteTotal, 0);
  return {
    period,
    summary: {
      acordosAtivos: acordos.length,
      abastecimentosConferidos: rows.length,
      divergencias: divergencias.length,
      totalExcedente: money(totalExcedente),
    },
    divergencias,
  };
}
