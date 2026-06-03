import bcrypt from "bcryptjs";
import { tableName } from "../config.js";
import { pool } from "./pool.js";

const LOGIN = "diogo";
const SENHA = "Senha@123";
const EMAIL = "diogoleonardoa@gmail.com";

const hash = await bcrypt.hash(SENHA, 10);

await pool.query(
  `INSERT INTO ${tableName("usuarios")} (login, senha, email, admin)
   VALUES ($1, $2, $3, true)
   ON CONFLICT (login) DO UPDATE SET senha = EXCLUDED.senha, email = EXCLUDED.email, admin = true`,
  [LOGIN, hash, EMAIL]
);

console.log(`Usuário '${LOGIN}' criado/atualizado com sucesso (admin=true).`);
console.log(`Login: ${LOGIN} / Senha: ${SENHA}`);
await pool.end();
