import bcrypt from "bcryptjs";
import express from "express";
import { tableName } from "../config.js";
import { pool } from "../db/pool.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

export const usuariosRouter = express.Router();

const COLS_RETORNO = `
  id, login, email, numero, admin, ativo,
  perm_diretoria, perm_simulador, perm_viagens, perm_dre_empresarial, perm_analise_frota,
  perm_abastecimentos,
  perm_faturamento_diario, perm_comparativo_faturamento, perm_lucro_viagens,
  perm_custos_veiculos, perm_manutencoes_veiculos, perm_clientes, perm_clientes_lucro,
  perm_pneus, perm_settings, perm_manutencao,
  criado_em
`;

// GET /api/usuarios
usuariosRouter.get("/usuarios", requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${COLS_RETORNO} FROM ${tableName("usuarios")} ORDER BY id`
    );
    res.json({ usuarios: rows });
  } catch (error) {
    next(error);
  }
});

// POST /api/usuarios
usuariosRouter.post("/usuarios", requireAdmin, async (req, res, next) => {
  try {
    const {
      login, senha, email, numero,
      admin = false, ativo = true,
      perm_diretoria = true, perm_simulador = true, perm_viagens = true,
      perm_dre_empresarial = true, perm_analise_frota = true, perm_abastecimentos = true,
      perm_faturamento_diario = true, perm_comparativo_faturamento = true, perm_lucro_viagens = true,
      perm_custos_veiculos = true, perm_manutencoes_veiculos = true,
      perm_clientes = true, perm_clientes_lucro = true,
      perm_pneus = true, perm_settings = true, perm_manutencao = true,
    } = req.body;

    if (!login || !senha) {
      return res.status(400).json({ error: "Login e senha são obrigatórios." });
    }

    const hash = await bcrypt.hash(String(senha), 10);

    const { rows } = await pool.query(
      `INSERT INTO ${tableName("usuarios")}
        (login, senha, email, numero, admin, ativo,
         perm_diretoria, perm_simulador, perm_viagens, perm_dre_empresarial, perm_analise_frota,
         perm_abastecimentos,
         perm_faturamento_diario, perm_comparativo_faturamento, perm_lucro_viagens,
         perm_custos_veiculos, perm_manutencoes_veiculos, perm_clientes, perm_clientes_lucro,
         perm_pneus, perm_settings, perm_manutencao)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING ${COLS_RETORNO}`,
      [
        String(login).trim().toLowerCase(), hash, email || null, numero || null,
        Boolean(admin), Boolean(ativo),
        Boolean(perm_diretoria), Boolean(perm_simulador), Boolean(perm_viagens), Boolean(perm_dre_empresarial),
        Boolean(perm_analise_frota), Boolean(perm_abastecimentos), Boolean(perm_faturamento_diario), Boolean(perm_comparativo_faturamento),
        Boolean(perm_lucro_viagens), Boolean(perm_custos_veiculos), Boolean(perm_manutencoes_veiculos),
        Boolean(perm_clientes), Boolean(perm_clientes_lucro),
        Boolean(perm_pneus),
        Boolean(perm_settings),
        Boolean(perm_manutencao),
      ]
    );

    res.status(201).json({ usuario: rows[0] });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Login já está em uso." });
    }
    next(error);
  }
});

// PUT /api/usuarios/:id
usuariosRouter.put("/usuarios/:id", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = req.body;

    const FIELDS = [
      "email", "numero", "admin", "ativo",
      "perm_diretoria", "perm_simulador", "perm_viagens", "perm_dre_empresarial", "perm_analise_frota",
      "perm_abastecimentos",
      "perm_faturamento_diario", "perm_comparativo_faturamento", "perm_lucro_viagens",
      "perm_custos_veiculos", "perm_manutencoes_veiculos", "perm_clientes",
      "perm_clientes_lucro", "perm_pneus", "perm_settings", "perm_manutencao",
    ];
    const BOOL_FIELDS = new Set([
      "admin", "ativo",
      "perm_diretoria", "perm_simulador", "perm_viagens", "perm_dre_empresarial", "perm_analise_frota",
      "perm_abastecimentos",
      "perm_faturamento_diario", "perm_comparativo_faturamento", "perm_lucro_viagens",
      "perm_custos_veiculos", "perm_manutencoes_veiculos", "perm_clientes",
      "perm_clientes_lucro", "perm_pneus", "perm_settings", "perm_manutencao",
    ]);

    const sets = [];
    const vals = [];
    let i = 1;

    if (body.login !== undefined) {
      sets.push(`login = $${i++}`);
      vals.push(String(body.login).trim().toLowerCase());
    }
    if (body.senha) {
      sets.push(`senha = $${i++}`);
      vals.push(await bcrypt.hash(String(body.senha), 10));
    }
    for (const f of FIELDS) {
      if (body[f] !== undefined) {
        sets.push(`${f} = $${i++}`);
        vals.push(BOOL_FIELDS.has(f) ? Boolean(body[f]) : (body[f] || null));
      }
    }
    sets.push(`atualizado_em = $${i++}`);
    vals.push(new Date());

    if (sets.length === 1) {
      return res.status(400).json({ error: "Nenhum campo para atualizar." });
    }

    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE ${tableName("usuarios")} SET ${sets.join(", ")}
       WHERE id = $${i} RETURNING ${COLS_RETORNO}`,
      vals
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }

    res.json({ usuario: rows[0] });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Login já está em uso." });
    }
    next(error);
  }
});

// DELETE /api/usuarios/:id
usuariosRouter.delete("/usuarios/:id", requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (Number(id) === req.user.id) {
      return res.status(400).json({ error: "Não é possível excluir sua própria conta." });
    }
    const { rowCount } = await pool.query(
      `DELETE FROM ${tableName("usuarios")} WHERE id = $1`, [id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
