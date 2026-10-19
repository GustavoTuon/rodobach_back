import { getVeiculosPool } from "../db/pool-veiculos.js";

// Only readings from the expense day, in the operation's timezone. No ERP fallback.
export async function expenseTelemetryOdometer(plate, expenseDate, expenseTime) {
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(expenseTime || "")) {
    const error = new Error("Informe o horário da nota para consultar o KM.");
    error.statusCode = 400;
    throw error;
  }
  const { rows } = await getVeiculosPool().query(`
    SELECT m.odometro, m.data_hora
    FROM rodobach.veiculos v
    JOIN LATERAL (
      SELECT odometro,data_hora FROM rodobach.mensagens_cb
      WHERE veiculo_id=v.veiculo_id AND odometro>0 AND odometro<=9999999.9
        AND data_hora >= ($2::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
        AND data_hora <= (($2::date + $3::time) AT TIME ZONE 'America/Sao_Paulo')
        AND data_hora<=NOW()
      ORDER BY data_hora DESC,id DESC LIMIT 1
    ) m ON TRUE
    WHERE regexp_replace(upper(v.placa),'[^A-Z0-9]','','g')=$1
    ORDER BY m.data_hora DESC LIMIT 1`, [plate, expenseDate, expenseTime]);
  const row = rows[0], value = Number(row?.odometro);
  if (!row?.data_hora || !Number.isFinite(value) || value <= 0 || value > 9999999.9) {
    return {odometer:null,date:null,source:"indisponivel"};
  }
  return {odometer:Math.round(value*10)/10,date:row.data_hora,source:"telemetria"};
}
