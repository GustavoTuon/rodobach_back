import bcrypt from "bcryptjs";
import { tableName } from "../config.js";
import { pool } from "./pool.js";

const LOGIN = "diogo";
const SENHA = "Senha@123";

const { rows } = await pool.query(
  `SELECT login, senha, ativo FROM ${tableName("usuarios")} WHERE login = $1`,
  [LOGIN]
);

if (rows.length === 0) {
  console.log("ERRO: usuário não encontrado no banco.");
} else {
  const user = rows[0];
  console.log("Usuário encontrado:", user.login, "| ativo:", user.ativo);
  console.log("Hash armazenado:", user.senha);
  const ok = await bcrypt.compare(SENHA, user.senha);
  console.log(`bcrypt.compare("${SENHA}", hash) =`, ok);
}

await pool.end();
