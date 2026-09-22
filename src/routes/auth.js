import bcrypt from "bcryptjs";
import express from "express";
import jwt from "jsonwebtoken";
import { config, tableName } from "../config.js";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { publicUser, sessionVersion } from "../services/userSession.js";
import { loginSchema, validateBody } from "../middleware/validate.js";

export const authRouter = express.Router();

// POST /api/auth/login
authRouter.post("/auth/login", validateBody(loginSchema), async (req, res, next) => {
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

    const profile = publicUser(user);
    const token = jwt.sign({ id: user.id, sessionVersion: sessionVersion(user) }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
    res.json({ token, user: profile });
  } catch (error) { next(error); }
});

authRouter.get("/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
