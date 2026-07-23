import bcrypt from "bcryptjs";
import express from "express";
import jwt from "jsonwebtoken";
import { config, tableName } from "../config.js";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = express.Router();

// POST /api/auth/login
authRouter.post("/auth/login", async (req, res, next) => {
  try {
    const { login, senha } = req.body;
    if (!login || !senha) {
      return res.status(400).json({ error: "Login e senha são obrigatórios." });
    }

    const { rows } = await pool.query(
      `SELECT * FROM ${tableName("usuarios")} WHERE login = $1 AND ativo = true`,
      [String(login).trim().toLowerCase()]
    );

    const user = rows[0];
    if (!user || !(await bcrypt.compare(String(senha), user.senha))) {
      return res.status(401).json({ error: "Credenciais inválidas." });
    }

    const permissions = {
      diretoria: user.perm_diretoria,
      simulador: user.perm_simulador,
      viagens: user.perm_viagens,
      "dre-empresarial": user.perm_dre_empresarial,
      "faturamento-diario": user.perm_faturamento_diario ?? user.perm_dre_empresarial,
      "comparativo-faturamento": user.perm_comparativo_faturamento ?? user.perm_dre_empresarial,
      "analise-frota": user.perm_analise_frota,
      abastecimentos: user.perm_abastecimentos ?? user.perm_analise_frota,
      "precos-combustivel": user.perm_abastecimentos ?? user.perm_analise_frota,
      "lucro-viagens": user.perm_lucro_viagens ?? user.perm_analise_frota,
      "custos-veiculos": user.perm_custos_veiculos,
      "manutencoes-veiculos": user.perm_manutencoes_veiculos,
      clientes: user.perm_clientes,
      "clientes-lucro": user.perm_clientes_lucro ?? user.perm_clientes,
      "status-carga": user.perm_status_carga ?? user.perm_viagens,
      pneus: user.perm_pneus,
      settings: user.perm_settings,
      manutencao: user.perm_manutencao,
      "automacoes-n8n": user.perm_automacoes_n8n ?? user.perm_manutencao,
    };

    const token = jwt.sign(
      { id: user.id, login: user.login, email: user.email, admin: user.admin, permissions },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    res.json({
      token,
      user: {
        id: user.id,
        login: user.login,
        email: user.email,
        numero: user.numero,
        admin: user.admin,
        permissions,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/me
authRouter.get("/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
