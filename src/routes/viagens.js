import { Router } from "express";
import { pool } from "../db/pool.js";
import { clientPool } from "../db/clientPool.js";
import { tableName } from "../config.js";
import { mapViagem, viagemParams } from "../mappers.js";

export const viagensRouter = Router();

const viagemColumns = `
  numero_viagem, placa_veiculo, situacao, data, cidade_origem, uf_origem,
  cidade_destino, uf_destino, cliente, cliente_final, valor_cliente, km_viagem,
  material, peso_kg, motorista, valor_motorista, vendedor, tomador_servico,
  condicao_pagamento, numero_motorista, cnh_motorista, antt_veiculo,
  conta_deposito, chave_pix, doc_placas, doc_antt, doc_conta_deposito,
  doc_chave_pix, doc_cnh_motorista, doc_consulta_motorista, doc_comprovante_residencia,
  doc_numero_motorista, rota_maps_url, observacoes
`;

const insertPlaceholders = Array.from({ length: 34 }, (_, index) => `$${index + 1}`).join(", ");
const updateAssignments = viagemColumns
  .split(",")
  .map((column, index) => `${column.trim()} = $${index + 1}`)
  .join(", ");
const viagemParamCount = viagemColumns.split(",").length;

async function getViagemById(client, id) {
  const { rows } = await client.query(`
    SELECT *
    FROM ${tableName("cadastro_cotacao_frete")}
    WHERE id = $1
  `, [id]);

  if (!rows.length) return null;

  const { rows: rotas } = await client.query(`
    SELECT *
    FROM ${tableName("cadastro_cotacao_frete_rotas")}
    WHERE cotacao_id = $1
    ORDER BY ordem, id
  `, [id]);

  const { rows: documentos } = await client.query(`
    SELECT *
    FROM ${tableName("cadastro_cotacao_frete_documentos")}
    WHERE cotacao_id = $1
    ORDER BY id
  `, [id]);

  return mapViagem(rows[0], rotas, documentos);
}

async function replaceParadas(client, viagemId, paradas = []) {
  await client.query(`DELETE FROM ${tableName("cadastro_cotacao_frete_rotas")} WHERE cotacao_id = $1`, [viagemId]);

  for (const [index, parada] of paradas.entries()) {
    await client.query(`
      INSERT INTO ${tableName("cadastro_cotacao_frete_rotas")} (
        cotacao_id, ordem, tipo_parada, cidade, uf, cliente, endereco, numero_nota_fiscal, observacoes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      viagemId,
      Number(parada.ordem || index + 1),
      parada.tipo || "entrega",
      parada.cidade || null,
      (parada.uf || "").slice(0, 2).toUpperCase() || null,
      parada.cliente || null,
      parada.endereco || null,
      parada.nf || null,
      parada.obs || null,
    ]);
  }
}

function userAudit(user = {}) {
  return {
    id: Number.isFinite(Number(user.id)) ? Number(user.id) : null,
    login: user.login || user.email || null,
  };
}

function normalizeDocumentoFinanceiro(documento = {}) {
  return {
    id: Number(documento.id) || null,
    tipo: String(documento.tipo || documento.tipoDocumento || "CT-e").trim() || "CT-e",
    numero: String(documento.numero || documento.numeroDocumento || "").trim(),
    chave: String(documento.chave || documento.chaveDocumento || "").trim(),
    link: String(documento.link || documento.linkDocumento || "").trim(),
    observacoes: String(documento.observacoes || documento.obs || "").trim(),
  };
}

async function replaceDocumentosFinanceiros(client, viagemId, documentos = [], user = {}) {
  const normalized = (Array.isArray(documentos) ? documentos : [])
    .map(normalizeDocumentoFinanceiro)
    .filter((doc) => doc.tipo || doc.numero || doc.chave || doc.link || doc.observacoes);
  const ids = normalized.map((doc) => doc.id).filter(Boolean);
  const audit = userAudit(user);

  if (ids.length) {
    await client.query(`
      DELETE FROM ${tableName("cadastro_cotacao_frete_documentos")}
      WHERE cotacao_id = $1 AND id <> ALL($2::int[])
    `, [viagemId, ids]);
  } else {
    await client.query(`DELETE FROM ${tableName("cadastro_cotacao_frete_documentos")} WHERE cotacao_id = $1`, [viagemId]);
  }

  for (const doc of normalized) {
    if (doc.id) {
      const { rowCount } = await client.query(`
        UPDATE ${tableName("cadastro_cotacao_frete_documentos")}
        SET tipo_documento = $3,
            numero_documento = $4,
            chave_documento = $5,
            link_documento = $6,
            observacoes = $7,
            atualizado_por_id = $8,
            atualizado_por_login = $9,
            atualizado_em = CURRENT_TIMESTAMP
        WHERE cotacao_id = $1 AND id = $2
      `, [viagemId, doc.id, doc.tipo, doc.numero || null, doc.chave || null, doc.link || null, doc.observacoes || null, audit.id, audit.login]);
      if (rowCount) continue;
    }

    await client.query(`
      INSERT INTO ${tableName("cadastro_cotacao_frete_documentos")} (
        cotacao_id, tipo_documento, numero_documento, chave_documento, link_documento, observacoes,
        criado_por_id, criado_por_login, atualizado_por_id, atualizado_por_login
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $7, $8)
    `, [viagemId, doc.tipo, doc.numero || null, doc.chave || null, doc.link || null, doc.observacoes || null, audit.id, audit.login]);
  }
}

function uniq(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function accountText(row = {}) {
  const parts = [
    row.driver_bank ? `Banco ${row.driver_bank}` : "",
    row.driver_account_type,
    row.driver_agency ? `Ag ${row.driver_agency}${row.driver_agency_digit ? `-${row.driver_agency_digit}` : ""}` : "",
    row.driver_account ? `Conta ${row.driver_account}${row.driver_account_digit ? `-${row.driver_account_digit}` : ""}` : "",
    row.driver_account_operation ? `Op ${row.driver_account_operation}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

function mapVehicleOption(row) {
  const propriedade = String(row.ownership_type || "").trim().toUpperCase();
  const ownershipType = propriedade === "T" || propriedade === "TERCEIRO" ? "TERCEIRO" : "FROTA";
  return {
    placa: row.plate || "",
    label: [row.plate, row.name].filter(Boolean).join(" · "),
    veiculo: row.name || "",
    tipoPropriedade: row.ownership_type || "",
    ownershipType,
    vehicleOwnershipType: ownershipType,
    cidadePlaca: row.plate_city || "",
    ufPlaca: row.plate_uf || "",
    motoristaCodigo: row.driver_code || null,
    motorista: row.driver_name || "",
    numeroMotorista: row.driver_cellphone || row.driver_phone || "",
    cnh: row.driver_license || "",
    antt: row.rntrc || "",
    contaDeposito: accountText(row),
    chavePix: row.driver_pix_key || "",
  };
}

function mapDriverOption(row) {
  return {
    codigo: row.code || null,
    nome: row.name || "",
    label: row.name || "",
    numeroMotorista: row.cellphone || row.phone || "",
    cnh: row.driver_license || "",
    antt: row.rntrc || "",
    contaDeposito: accountText(row),
    chavePix: row.driver_pix_key || "",
  };
}

function mapClientOption(row) {
  const nome = row.name || row.fantasy || "";
  return {
    codigo: row.code || null,
    nome,
    label: nome,
    razaoSocial: row.name || "",
    fantasia: row.fantasy || "",
    documento: row.document || "",
    contato: row.contact || "",
    condicaoPagamento: row.payment_condition || "",
    vendedorCodigo: row.seller_code || null,
    vendedor: row.seller_name || "",
  };
}

function mapSellerOption(row) {
  const nome = row.name || row.fantasy || "";
  return {
    codigo: row.code || null,
    nome,
    label: nome,
    fantasia: row.fantasy || "",
  };
}

async function loadClientOptions(search = "") {
  const like = `%${String(search || "").trim()}%`;
  const { rows } = await clientPool.query(`
    SELECT
      codigocli AS code,
      nomecli AS name,
      fantasiacli AS fantasy,
      cnpjcpfcli AS document,
      NULL::text AS contact,
      condicaopagamentocli AS payment_condition,
      clientes.vendedorcli AS seller_code,
      pessoas.nomepes AS seller_name
    FROM gerais.clientes clientes
    LEFT JOIN gerais.pessoas pessoas
      ON pessoas.codigorepresentantepes = clientes.vendedorcli
     AND pessoas.ativopes::text = 'S'
    WHERE NULLIF(TRIM(clientes.nomecli::text), '') IS NOT NULL
      AND ($1::text = '%%' OR CONCAT_WS(' ', clientes.nomecli, clientes.fantasiacli, clientes.cnpjcpfcli, clientes.codigocli::text) ILIKE $1)
    ORDER BY COALESCE(NULLIF(clientes.fantasiacli, ''), clientes.nomecli)
    LIMIT 80
  `, [like]);
  return rows.map(mapClientOption);
}

async function loadSellerOptions(search = "") {
  const like = `%${String(search || "").trim()}%`;
  const { rows } = await clientPool.query(`
    SELECT DISTINCT
      representantes.codigorep AS code,
      pessoas.nomepes AS name,
      pessoas.fantasiapes AS fantasy
    FROM logistica.representantes representantes
    INNER JOIN gerais.pessoas pessoas
      ON pessoas.codigorepresentantepes = representantes.codigorep
    WHERE NULLIF(TRIM(pessoas.nomepes::text), '') IS NOT NULL
      AND pessoas.ativopes::text = 'S'
      AND ($1::text = '%%' OR CONCAT_WS(' ', pessoas.nomepes, pessoas.fantasiapes, representantes.codigorep::text) ILIKE $1)
    ORDER BY pessoas.nomepes
    LIMIT 80
  `, [like]);
  return rows.map(mapSellerOption);
}

async function loadVehicleOptions(search = "") {
  const like = `%${String(search || "").trim()}%`;
  const { rows } = await clientPool.query(`
    SELECT
      veiculos.placavei AS plate,
      veiculos.nomevei AS name,
      veiculos.tipopropriedadevei AS ownership_type,
      veiculos.municipioplacavei AS plate_city,
      veiculos.ufplacavei AS plate_uf,
      veiculos.motoristavei AS driver_code,
      motoristas.nomemot AS driver_name,
      CONCAT_WS('', NULLIF(motoristas.dddcelularmot::text, ''), NULLIF(motoristas.celularmot::text, '')) AS driver_cellphone,
      CONCAT_WS('', NULLIF(motoristas.dddmot::text, ''), NULLIF(motoristas.telefone1mot::text, '')) AS driver_phone,
      motoristas.cnhmot AS driver_license,
      NULL::text AS rntrc,
      motoristas.bancomot AS driver_bank,
      motoristas.tipocontabancariamot AS driver_account_type,
      motoristas.agenciamot AS driver_agency,
      motoristas.dvagenciamot AS driver_agency_digit,
      motoristas.contabancariamot AS driver_account,
      motoristas.dvcontabancariamot AS driver_account_digit,
      motoristas.operacaocontabancariamot AS driver_account_operation,
      motoristas.chavepixmot AS driver_pix_key
    FROM frotas.veiculos veiculos
    LEFT JOIN frotas.motoristas motoristas
      ON motoristas.empresamot = veiculos.empresavei
     AND motoristas.codigomot = veiculos.motoristavei
    WHERE veiculos.placavei IS NOT NULL
      AND COALESCE(veiculos.situacaovei::text, '') <> 'I'
      AND ($1::text = '%%' OR CONCAT_WS(' ', veiculos.placavei, veiculos.nomevei, motoristas.nomemot) ILIKE $1)
    ORDER BY veiculos.placavei
    LIMIT 80
  `, [like]);
  return rows.map(mapVehicleOption);
}

async function loadDriverOptions(search = "") {
  const like = `%${String(search || "").trim()}%`;
  const { rows } = await clientPool.query(`
    SELECT
      codigomot AS code,
      nomemot AS name,
      CONCAT_WS('', NULLIF(dddcelularmot::text, ''), NULLIF(celularmot::text, '')) AS cellphone,
      CONCAT_WS('', NULLIF(dddmot::text, ''), NULLIF(telefone1mot::text, '')) AS phone,
      cnhmot AS driver_license,
      NULL::text AS rntrc,
      bancomot AS driver_bank,
      tipocontabancariamot AS driver_account_type,
      agenciamot AS driver_agency,
      dvagenciamot AS driver_agency_digit,
      contabancariamot AS driver_account,
      dvcontabancariamot AS driver_account_digit,
      operacaocontabancariamot AS driver_account_operation,
      chavepixmot AS driver_pix_key
    FROM frotas.motoristas
    WHERE nomemot IS NOT NULL
      AND ($1::text = '%%' OR CONCAT_WS(' ', nomemot, cpfmot, cnhmot) ILIKE $1)
    ORDER BY nomemot
    LIMIT 80
  `, [like]);
  return rows.map(mapDriverOption);
}

async function loadLocationOptions(search = "") {
  const like = `%${String(search || "").trim()}%`;
  const { rows } = await clientPool.query(`
    SELECT DISTINCT
      NULLIF(TRIM(municipioplacavei::text), '') AS cidade,
      NULLIF(TRIM(ufplacavei::text), '') AS uf
    FROM frotas.veiculos
    WHERE NULLIF(TRIM(municipioplacavei::text), '') IS NOT NULL
      AND NULLIF(TRIM(ufplacavei::text), '') IS NOT NULL
      AND ($1::text = '%%' OR CONCAT_WS(' ', municipioplacavei, ufplacavei) ILIKE $1)
    ORDER BY cidade, uf
    LIMIT 80
  `, [like]);
  return rows.map((row) => `${row.cidade}/${String(row.uf || "").toUpperCase().slice(0, 2)}`);
}

async function loadLocalOptions() {
  const { rows } = await pool.query(`
    WITH recentes AS (
      SELECT *
      FROM ${tableName("cadastro_cotacao_frete")}
      ORDER BY id DESC
      LIMIT 500
    ),
    rotas AS (
      SELECT *
      FROM ${tableName("cadastro_cotacao_frete_rotas")}
      ORDER BY id DESC
      LIMIT 500
    )
    SELECT
      ARRAY(SELECT DISTINCT NULLIF(TRIM(cliente), '') FROM recentes WHERE NULLIF(TRIM(cliente), '') IS NOT NULL ORDER BY 1) AS clientes,
      ARRAY(SELECT DISTINCT NULLIF(TRIM(cliente_final), '') FROM recentes WHERE NULLIF(TRIM(cliente_final), '') IS NOT NULL ORDER BY 1) AS clientes_finais,
      ARRAY(SELECT DISTINCT NULLIF(TRIM(tomador_servico), '') FROM recentes WHERE NULLIF(TRIM(tomador_servico), '') IS NOT NULL ORDER BY 1) AS tomadores,
      ARRAY(SELECT DISTINCT NULLIF(TRIM(placa_veiculo), '') FROM recentes WHERE NULLIF(TRIM(placa_veiculo), '') IS NOT NULL ORDER BY 1) AS placas,
      ARRAY(SELECT DISTINCT NULLIF(TRIM(motorista), '') FROM recentes WHERE NULLIF(TRIM(motorista), '') IS NOT NULL ORDER BY 1) AS motoristas,
      ARRAY(SELECT DISTINCT NULLIF(TRIM(vendedor), '') FROM recentes WHERE NULLIF(TRIM(vendedor), '') IS NOT NULL ORDER BY 1) AS vendedores,
      ARRAY(SELECT DISTINCT NULLIF(TRIM(material), '') FROM recentes WHERE NULLIF(TRIM(material), '') IS NOT NULL ORDER BY 1) AS materiais,
      ARRAY(SELECT DISTINCT TRIM(cidade_origem) || '/' || UPPER(TRIM(uf_origem))
            FROM recentes
            WHERE NULLIF(TRIM(cidade_origem), '') IS NOT NULL AND NULLIF(TRIM(uf_origem), '') IS NOT NULL
            ORDER BY 1) AS origens,
      ARRAY(SELECT DISTINCT TRIM(cidade_destino) || '/' || UPPER(TRIM(uf_destino))
            FROM recentes
            WHERE NULLIF(TRIM(cidade_destino), '') IS NOT NULL AND NULLIF(TRIM(uf_destino), '') IS NOT NULL
            ORDER BY 1) AS destinos,
      ARRAY(SELECT DISTINCT TRIM(cidade) || '/' || UPPER(TRIM(uf))
            FROM rotas
            WHERE NULLIF(TRIM(cidade), '') IS NOT NULL AND NULLIF(TRIM(uf), '') IS NOT NULL
            ORDER BY 1) AS paradas
  `);
  return rows[0] || {};
}

// ── GET /api/viagens/opcoes — deve vir antes de /:id ─────────────────────────
viagensRouter.get("/viagens/opcoes", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const local = await loadLocalOptions();
    const [clientes, placas, motoristas, locais, vendedores] = await Promise.all([
      loadClientOptions(q).catch(() => []),
      loadVehicleOptions(q).catch(() => []),
      loadDriverOptions(q).catch(() => []),
      loadLocationOptions(q).catch(() => []),
      loadSellerOptions(q).catch(() => []),
    ]);

    res.json({
      clientes: uniq([...clientes.map((c) => c.nome), ...(local.clientes ?? [])]),
      clientesFinais: uniq([...clientes.map((c) => c.nome), ...(local.clientes_finais ?? [])]),
      tomadores: uniq([...clientes.map((c) => c.nome), ...(local.tomadores ?? [])]),
      placas: uniq([...placas.map((p) => p.placa), ...(local.placas ?? [])]),
      motoristas: uniq([...motoristas.map((m) => m.nome), ...(local.motoristas ?? [])]),
      vendedores: uniq(vendedores.map((v) => v.nome)),
      origens: uniq([...(local.origens ?? []), ...locais]),
      destinos: uniq([...(local.destinos ?? []), ...locais]),
      paradas: uniq([...(local.paradas ?? []), ...(local.destinos ?? []), ...locais]),
      materiais: local.materiais ?? [],
      detalhes: { clientes, placas, motoristas, vendedores },
    });
  } catch (error) {
    next(error);
  }
});

viagensRouter.get("/viagens/opcoes/placas", async (req, res, next) => {
  try {
    res.json(await loadVehicleOptions(req.query.q || ""));
  } catch (error) {
    next(error);
  }
});

viagensRouter.get("/viagens/opcoes/motoristas", async (req, res, next) => {
  try {
    res.json(await loadDriverOptions(req.query.q || ""));
  } catch (error) {
    next(error);
  }
});

viagensRouter.get("/viagens/opcoes/clientes", async (req, res, next) => {
  try {
    res.json(await loadClientOptions(req.query.q || ""));
  } catch (error) {
    next(error);
  }
});

viagensRouter.get("/viagens/opcoes/vendedores", async (req, res, next) => {
  try {
    res.json(await loadSellerOptions(req.query.q || ""));
  } catch (error) {
    next(error);
  }
});

viagensRouter.get("/viagens", async (req, res, next) => {
  try {
    const params = [];
    const where = [];

    if (req.query.situacao && req.query.situacao !== "todos") {
      params.push(req.query.situacao);
      where.push(`situacao = $${params.length}`);
    }

    if (req.query.cliente) {
      params.push(`%${String(req.query.cliente).trim().toLowerCase()}%`);
      where.push(`lower(coalesce(cliente, '')) LIKE $${params.length}`);
    }

    if (req.query.origem) {
      params.push(`%${String(req.query.origem).trim().toLowerCase().split("/")[0]}%`);
      where.push(`lower(coalesce(cidade_origem, '')) LIKE $${params.length}`);
    }

    if (req.query.destino) {
      params.push(`%${String(req.query.destino).trim().toLowerCase().split("/")[0]}%`);
      where.push(`lower(coalesce(cidade_destino, '')) LIKE $${params.length}`);
    }

    if (req.query.material) {
      params.push(`%${String(req.query.material).trim().toLowerCase()}%`);
      where.push(`lower(coalesce(material, '')) LIKE $${params.length}`);
    }

    if (req.query.dataInicio) {
      params.push(String(req.query.dataInicio).slice(0, 10));
      where.push(`data >= $${params.length}`);
    }

    if (req.query.dataFim) {
      params.push(String(req.query.dataFim).slice(0, 10));
      where.push(`data <= $${params.length}`);
    }

    if (req.query.search) {
      params.push(`%${String(req.query.search).toLowerCase()}%`);
      where.push(`(
        lower(coalesce(numero_viagem, '')) LIKE $${params.length}
        OR lower(coalesce(cliente, '')) LIKE $${params.length}
        OR lower(coalesce(cliente_final, '')) LIKE $${params.length}
        OR lower(coalesce(tomador_servico, '')) LIKE $${params.length}
        OR lower(coalesce(motorista, '')) LIKE $${params.length}
        OR lower(coalesce(material, '')) LIKE $${params.length}
        OR lower(coalesce(cidade_origem, '')) LIKE $${params.length}
        OR lower(coalesce(cidade_destino, '')) LIKE $${params.length}
        OR lower(coalesce(placa_veiculo, '')) LIKE $${params.length}
        OR EXISTS (
          SELECT 1
          FROM ${tableName("cadastro_cotacao_frete_rotas")} r
          WHERE r.cotacao_id = cf.id
            AND (
              lower(coalesce(r.numero_nota_fiscal, '')) LIKE $${params.length}
              OR lower(coalesce(r.cliente, '')) LIKE $${params.length}
              OR lower(coalesce(r.cidade, '')) LIKE $${params.length}
              OR lower(coalesce(r.observacoes, '')) LIKE $${params.length}
            )
        )
      )`);
    }

    params.push(Math.min(Number(req.query.limit || 300), 1000));

    const { rows } = await pool.query(`
      SELECT *
      FROM ${tableName("cadastro_cotacao_frete")} cf
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY data DESC, id DESC
      LIMIT $${params.length}
    `, params);

    const ids = rows.map((row) => row.id);
    const rotasByViagem = new Map(ids.map((id) => [id, []]));
    const documentosByViagem = new Map(ids.map((id) => [id, []]));

    if (ids.length) {
      const { rows: rotas } = await pool.query(`
        SELECT *
        FROM ${tableName("cadastro_cotacao_frete_rotas")}
        WHERE cotacao_id = ANY($1::int[])
        ORDER BY cotacao_id, ordem, id
      `, [ids]);

      for (const rota of rotas) {
        rotasByViagem.get(rota.cotacao_id)?.push(rota);
      }

      const { rows: documentos } = await pool.query(`
        SELECT *
        FROM ${tableName("cadastro_cotacao_frete_documentos")}
        WHERE cotacao_id = ANY($1::int[])
        ORDER BY cotacao_id, id
      `, [ids]);

      for (const documento of documentos) {
        documentosByViagem.get(documento.cotacao_id)?.push(documento);
      }
    }

    res.json(rows.map((row) => mapViagem(row, rotasByViagem.get(row.id) || [], documentosByViagem.get(row.id) || [])));
  } catch (error) {
    next(error);
  }
});

viagensRouter.get("/viagens/:id", async (req, res, next) => {
  const client = await pool.connect();

  try {
    const viagem = await getViagemById(client, Number(req.params.id));
    if (!viagem) {
      res.status(404).json({ error: "Viagem nao encontrada." });
      return;
    }
    res.json(viagem);
  } catch (error) {
    next(error);
  } finally {
    client.release();
  }
});

viagensRouter.post("/viagens", async (req, res, next) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`
      INSERT INTO ${tableName("cadastro_cotacao_frete")} (${viagemColumns})
      VALUES (${insertPlaceholders})
      RETURNING id
    `, viagemParams(req.body));

    await replaceParadas(client, rows[0].id, req.body.paradas);
    await replaceDocumentosFinanceiros(client, rows[0].id, req.body.documentosFinanceiros, req.user);
    const viagem = await getViagemById(client, rows[0].id);
    await client.query("COMMIT");
    res.status(201).json(viagem);
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

viagensRouter.put("/viagens/:id", async (req, res, next) => {
  const client = await pool.connect();
  const id = Number(req.params.id);

  try {
    await client.query("BEGIN");
    const { rowCount } = await client.query(`
      UPDATE ${tableName("cadastro_cotacao_frete")}
      SET ${updateAssignments}, atualizado_em = CURRENT_TIMESTAMP
      WHERE id = $${viagemParamCount + 1}
    `, [...viagemParams(req.body), id]);

    if (!rowCount) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Viagem nao encontrada." });
      return;
    }

    await replaceParadas(client, id, req.body.paradas);
    await replaceDocumentosFinanceiros(client, id, req.body.documentosFinanceiros, req.user);
    const viagem = await getViagemById(client, id);
    await client.query("COMMIT");
    res.json(viagem);
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

viagensRouter.delete("/viagens/:id", async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(`
      DELETE FROM ${tableName("cadastro_cotacao_frete")}
      WHERE id = $1
    `, [Number(req.params.id)]);

    if (!rowCount) {
      res.status(404).json({ error: "Viagem nao encontrada." });
      return;
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
