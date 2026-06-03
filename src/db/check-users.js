import { tableName } from "../config.js";
import { pool } from "./pool.js";

const { rows } = await pool.query(
  `SELECT id, login, email, ativo, criado_em FROM ${tableName("usuarios")}`
);

if (rows.length === 0) {
  console.log("Nenhum usuário encontrado na tabela.");
} else {
  console.log("Usuários no banco:");
  rows.forEach(r => console.log(` - id=${r.id}  login=${r.login}  email=${r.email}  ativo=${r.ativo}`));
}

await pool.end();
