import pg from "pg";

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

export function normalizeWhatsappNumber(value, countryCode = "55") {
  let number = digits(value);
  if (number.length === 10 || number.length === 11) number = `${countryCode}${number}`;
  return number.length >= 12 ? number : null;
}

export class PhoneResolver {
  constructor(db, countryCode = "55") {
    this.countryCode = countryCode;
    this.pool = db.host && db.database && db.user
      ? new pg.Pool({
        ...db,
        ssl: db.ssl ? { rejectUnauthorized: false } : false,
        max: 2,
        connectionTimeoutMillis: 10000,
      })
      : null;
  }

  async resolve(sm) {
    if (!this.pool) return null;
    const cpf = digits(sm.cpfMotorista);
    const plate = String(sm.veiculoPlaca || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
    const { rows } = await this.pool.query(`
      SELECT
        mot.nomemot AS motorista,
        CONCAT_WS('', NULLIF(mot.dddcelularmot::text, ''), NULLIF(mot.celularmot::text, '')) AS celular,
        CONCAT_WS('', NULLIF(mot.dddmot::text, ''), NULLIF(mot.telefone1mot::text, '')) AS telefone
      FROM frotas.motoristas mot
      LEFT JOIN frotas.veiculos vei
        ON vei.empresavei = mot.empresamot
       AND vei.motoristavei = mot.codigomot
      WHERE
        ($1 <> '' AND regexp_replace(COALESCE(mot.cpfmot::text, ''), '[^0-9]', '', 'g') = $1)
        OR
        ($2 <> '' AND regexp_replace(UPPER(COALESCE(vei.placavei::text, '')), '[^A-Z0-9]', '', 'g') = $2)
      ORDER BY
        CASE WHEN $1 <> '' AND regexp_replace(COALESCE(mot.cpfmot::text, ''), '[^0-9]', '', 'g') = $1 THEN 0 ELSE 1 END
      LIMIT 1
    `, [cpf, plate]);
    const row = rows[0];
    if (!row) return null;
    return {
      name: row.motorista || sm.nomeMotorista || "",
      number: normalizeWhatsappNumber(row.celular || row.telefone, this.countryCode),
    };
  }

  async close() {
    await this.pool?.end();
  }
}
