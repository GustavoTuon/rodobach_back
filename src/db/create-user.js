import bcrypt from "bcryptjs";
import { tableName } from "../config.js";
import { pool } from "./pool.js";

const LOGIN = process.env.ADMIN_LOGIN?.trim().toLowerCase();
const SENHA = process.env.ADMIN_PASSWORD;
const EMAIL = process.env.ADMIN_EMAIL?.trim();

if (!LOGIN || !SENHA || !EMAIL || SENHA.length < 12) {
  throw new Error("Defina ADMIN_LOGIN, ADMIN_PASSWORD (minimo 12 caracteres) e ADMIN_EMAIL");
}

const hash = await bcrypt.hash(SENHA, 10);

await pool.query(
  `INSERT INTO ${tableName("usuarios")} (login, senha, email, admin)
   VALUES ($1, $2, $3, true)
   ON CONFLICT (login) DO UPDATE SET senha = EXCLUDED.senha, email = EXCLUDED.email, admin = true`,
  [LOGIN, hash, EMAIL]
);

console.log(`Usuário '${LOGIN}' criado/atualizado com sucesso (admin=true).`);
await pool.end();
