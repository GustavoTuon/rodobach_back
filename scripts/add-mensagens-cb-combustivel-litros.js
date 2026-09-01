import { quoteIdent } from "../src/config.js";
import { getVeiculosPool } from "../src/db/pool-veiculos.js";

const schema = quoteIdent(process.env.VEICULOS_DB_SCHEMA || "rodobach");
const table = `${schema}.mensagens_cb`;
const pool = getVeiculosPool();

try {
  await pool.query(`
    ALTER TABLE ${table}
      ADD COLUMN IF NOT EXISTS combustivel_litros INTEGER;

    COMMENT ON COLUMN ${table}.combustivel_litros IS
      'Quantidade total de litros no tanque recebida no campo lt da RequestMensagemCB';
  `);

  const { rows } = await pool.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = $1
      AND table_name = 'mensagens_cb'
      AND column_name = 'combustivel_litros'
  `, [process.env.VEICULOS_DB_SCHEMA || "rodobach"]);

  if (!rows[0]) throw new Error("A coluna combustivel_litros nao foi criada.");
  console.log("mensagens_cb pronta para receber o campo lt:", rows[0]);
} finally {
  await pool.end();
}
