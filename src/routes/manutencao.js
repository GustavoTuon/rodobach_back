import express from "express";
import { tableName } from "../config.js";
import { pool } from "../db/pool.js";
import { getVeiculosPool } from "../db/pool-veiculos.js";

export const manutencaoRouter = express.Router();

const TABLE = () => tableName("automacao_mensagem_manutencao");

const QUERY_VEICULOS = `
  SELECT placa, odometro
  FROM (
    SELECT
      v.placa,
      mcb.odometro,
      ROW_NUMBER() OVER (
        PARTITION BY v.placa
        ORDER BY mcb.data_hora DESC
      ) AS rn
    FROM rodobach.mensagens_cb mcb
    LEFT JOIN rodobach.veiculos v
      ON v.veiculo_id = mcb.veiculo_id
  ) t
  WHERE rn = 1
    AND placa IS NOT NULL
  ORDER BY placa
`;

// GET /api/manutencao/veiculos — lista placas + odômetro do banco externo
manutencaoRouter.get("/manutencao/veiculos", async (_req, res, next) => {
  try {
    const vPool = getVeiculosPool();
    const { rows } = await vPool.query(QUERY_VEICULOS);
    res.json({ veiculos: rows });
  } catch (error) {
    next(error);
  }
});

// GET /api/manutencao
manutencaoRouter.get("/manutencao", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM ${TABLE()} ORDER BY criado_em DESC`
    );
    res.json({ automacoes: rows });
  } catch (error) {
    next(error);
  }
});

// POST /api/manutencao — cria um registro por placa selecionada
manutencaoRouter.post("/manutencao", async (req, res, next) => {
  try {
    const { placas, titulo, mensagem, intervalo_km } = req.body;

    if (!Array.isArray(placas) || placas.length === 0) {
      return res.status(400).json({ error: "Selecione ao menos uma placa." });
    }
    if (!titulo || !mensagem || !intervalo_km) {
      return res.status(400).json({ error: "Título, mensagem e intervalo_km são obrigatórios." });
    }

    // placas vem como [{ placa, km_atual }]
    const entradas = placas.map(p => ({
      placa: String(p.placa).toUpperCase().trim(),
      km_atual: Number(p.km_atual || 0),
    }));

    const criados = [];
    for (const { placa, km_atual } of entradas) {
      const km = Number(km_atual || 0);
      const intervalo = Number(intervalo_km);
      const { rows } = await pool.query(
        `INSERT INTO ${TABLE()} (placa, titulo, mensagem, intervalo_km, km_atual, km_proximo_envio)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [placa, titulo, mensagem, intervalo, km, km + intervalo]
      );
      criados.push(rows[0]);
    }

    res.status(201).json({ automacoes: criados });
  } catch (error) {
    next(error);
  }
});

// PUT /api/manutencao/:id
manutencaoRouter.put("/manutencao/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { placa, titulo, mensagem, intervalo_km, km_atual, ativo } = req.body;

    const sets = [];
    const vals = [];
    let i = 1;

    if (placa !== undefined)        { sets.push(`placa = $${i++}`);        vals.push(String(placa).toUpperCase().trim()); }
    if (titulo !== undefined)       { sets.push(`titulo = $${i++}`);       vals.push(titulo); }
    if (mensagem !== undefined)     { sets.push(`mensagem = $${i++}`);     vals.push(mensagem); }
    if (intervalo_km !== undefined) { sets.push(`intervalo_km = $${i++}`); vals.push(Number(intervalo_km)); }
    if (km_atual !== undefined)     { sets.push(`km_atual = $${i++}`);     vals.push(Number(km_atual)); }
    if (ativo !== undefined)        { sets.push(`ativo = $${i++}`);        vals.push(Boolean(ativo)); }
    // Recalcula km_proximo_envio se km_atual ou intervalo_km mudar
    if (km_atual !== undefined || intervalo_km !== undefined) {
      sets.push(`km_proximo_envio = $${i++}`);
      // Busca os valores atuais do registro para calcular corretamente
      const { rows: atual } = await pool.query(
        `SELECT km_atual, intervalo_km FROM ${TABLE()} WHERE id = $1`, [id]
      );
      if (atual.length > 0) {
        const novoKm = km_atual !== undefined ? Number(km_atual) : atual[0].km_atual;
        const novoIntervalo = intervalo_km !== undefined ? Number(intervalo_km) : atual[0].intervalo_km;
        vals.push(novoKm + novoIntervalo);
      } else {
        vals.push(0);
      }
    }
    sets.push(`atualizado_em = $${i++}`);
    vals.push(new Date());

    if (sets.length === 1) {
      return res.status(400).json({ error: "Nenhum campo para atualizar." });
    }

    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE ${TABLE()} SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
      vals
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Automação não encontrada." });
    }
    res.json({ automacao: rows[0] });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/manutencao/:id
manutencaoRouter.delete("/manutencao/:id", async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM ${TABLE()} WHERE id = $1`, [req.params.id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: "Automação não encontrada." });
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
