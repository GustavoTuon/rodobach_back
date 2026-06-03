import bcrypt from "bcryptjs";
import express from "express";
import { tableName } from "../config.js";
import { pool } from "../db/pool.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

export const usuariosRouter = express.Router();

const COLS_RETORNO = `
  id, login, email, numero, admin, ativo,
  perm_simulador, perm_diarias, perm_viagens, perm_custos, perm_receita,
  perm_demonstrativo, perm_dre_empresarial, perm_placa, perm_clientes, perm_settings,
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
      perm_simulador = true, perm_diarias = true, perm_viagens = true,
      perm_custos = true, perm_receita = true, perm_demonstrativo = true,
      perm_dre_empresarial = true, perm_placa = true, perm_clientes = true,
      perm_settings = true,
    } = req.body;

    if (!login || !senha) {
      return res.status(400).json({ error: "Login e senha são obrigatórios." });
    }

    const hash = await bcrypt.hash(String(senha), 10);

    const { rows } = await pool.query(
      `INSERT INTO ${tableName("usuarios")}
        (login, senha, email, numero, admin, ativo,
         perm_simulador, perm_diarias, perm_viagens, perm_custos, perm_receita,
         perm_demonstrativo, perm_dre_empresarial, perm_placa, perm_clientes, perm_settings)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING ${COLS_RETORNO}`,
      [
        String(login).trim().toLowerCase(), hash, email || null, numero || null,
        Boolean(admin), Boolean(ativo),
        Boolean(perm_simulador), Boolean(perm_diarias), Boolean(perm_viagens),
        Boolean(perm_custos), Boolean(perm_receita), Boolean(perm_demonstrativo),
        Boolean(perm_dre_empresarial), Boolean(perm_placa), Boolean(perm_clientes),
        Boolean(perm_settings),
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
      "perm_simulador", "perm_diarias", "perm_viagens", "perm_custos", "perm_receita",
      "perm_demonstrativo", "perm_dre_empresarial", "perm_placa", "perm_clientes", "perm_settings",
    ];
    const BOOL_FIELDS = new Set([
      "admin", "ativo",
      "perm_simulador", "perm_diarias", "perm_viagens", "perm_custos", "perm_receita",
      "perm_demonstrativo", "perm_dre_empresarial", "perm_placa", "perm_clientes", "perm_settings",
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
