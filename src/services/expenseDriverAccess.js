import { getVeiculosPool } from "../db/pool-veiculos.js";

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const isExpenseDriver = user => user?.expenseProfile === "motorista";

// Use the identifier sent by telemetry, not the unrelated local motoristas.id.
export async function telemetryDrivers(driverId = null) {
  const { rows } = await getVeiculosPool().query(`
    WITH latest AS (
      SELECT DISTINCT ON (motorista_id) motorista_id, motorista_nome, veiculo_id, data_hora
      FROM rodobach.mensagens_cb
      WHERE motorista_id > 0 AND data_hora <= NOW()
        AND ($1::text IS NULL OR motorista_id::text = $1)
      ORDER BY motorista_id, data_hora DESC, id DESC
    )
    SELECT l.motorista_id::text AS id, l.motorista_nome AS nome,
      regexp_replace(upper(v.placa), '[^A-Z0-9]', '', 'g') AS placa,
      l.data_hora AS observado_em, current_driver.motorista_id::text AS current_driver_id,
      EXISTS (SELECT 1 FROM rodobach.mensagens_cb other
        WHERE other.motorista_id=l.motorista_id AND other.data_hora=l.data_hora
          AND other.veiculo_id<>l.veiculo_id) AS ambiguous
    FROM latest l
    LEFT JOIN rodobach.veiculos v ON v.veiculo_id=l.veiculo_id
    LEFT JOIN LATERAL (
      SELECT motorista_id FROM rodobach.mensagens_cb
      WHERE veiculo_id=l.veiculo_id AND motorista_id IS NOT NULL AND data_hora<=NOW()
      ORDER BY data_hora DESC,id DESC LIMIT 1
    ) current_driver ON TRUE
    ORDER BY l.motorista_nome,l.motorista_id`, [driverId]);
  return rows;
}

export function driverAssignment(rows, driverId, now = Date.now()) {
  const base = { profile: "motorista", driverId, plate: null, status: "unavailable" };
  const matching = rows.filter(row => row.id === driverId);
  const row = matching[0];
  if (!row) return {...base, message: "Motorista sem identificação na telemetria. Solicite a conferência do vínculo."};
  const result = {...base, driverName: row.nome, observedAt: row.observado_em};
  if (matching.length !== 1 || row.ambiguous || row.current_driver_id !== driverId || !/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(row.placa || "")) {
    return {...result, message: "A telemetria não confirma uma placa única para você. Solicite a conferência do vínculo."};
  }
  const age = now - new Date(row.observado_em).getTime();
  if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) {
    return {...result, status: "stale", message: "O vínculo do motorista não é atualizado há mais de 7 dias. Aguarde uma nova identificação na telemetria."};
  }
  return {...result, plate: row.placa, status: "ready", message: "Placa vinculada automaticamente pela telemetria."};
}

export async function expenseAccess(user) {
  if (!isExpenseDriver(user)) return {profile: "colaborador", status: "ready"};
  const id = user.telemetryDriverId;
  return driverAssignment(id ? await telemetryDrivers(id) : [], id);
}

export async function requireExpensePlate(user, plate) {
  if (!isExpenseDriver(user)) return;
  const access = await expenseAccess(user);
  if (access.status !== "ready" || access.plate !== plate) {
    const error = new Error(access.status === "ready"
      ? "Você só pode lançar despesas para a placa vinculada a você na telemetria. Atualize a lista de veículos."
      : access.message);
    error.statusCode = 403;
    throw error;
  }
}
