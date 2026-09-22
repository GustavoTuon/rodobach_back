import { clientPool } from "../db/clientPool.js";
import { getVeiculosPool } from "../db/pool-veiculos.js";
import { selectCurrentOdometer } from "./odometerSelection.js";

const normalizePlate = value => String(value || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

export function latestValidFuelOdometer(readings = [], now = new Date()) {
  const valid = readings
    .map(row => ({ ...row, km: Number(row.km), date: new Date(row.data_ref) }))
    .filter(row => row.data_ref && Number.isFinite(row.km) && row.km >= 10000 && row.km <= 2000000
      && !Number.isNaN(row.date.getTime()) && row.date <= now)
    .sort((a, b) => b.date - a.date || b.km - a.km);
  for (const candidate of valid) {
    const previous = valid.find(row => row.date < candidate.date);
    if (!previous) return candidate;
    const elapsedDays = Math.max(1, (candidate.date - previous.date) / 86400000);
    const increase = candidate.km - previous.km;
    if (increase >= 0 && increase <= elapsedDays * 2000 + 2000) return candidate;
  }
  return null;
}

export function resolveMaintenanceOdometer(telemetry, fuel) {
  // An older position cannot replace a newer fuel reference even if its KM is larger.
  const stale = fuel && telemetry?.data_hora && new Date(telemetry.data_hora) < new Date(fuel.data_ref);
  const selected = selectCurrentOdometer({
    telemetryKm: stale ? null : telemetry?.odometro,
    telemetryDate: telemetry?.data_hora,
    erpKm: fuel?.km,
    erpDate: fuel?.data_ref,
  });
  const isTelemetry = selected.source === "telemetria";
  return {
    km_atual: selected.km,
    km_fonte: isTelemetry ? "telemetria" : selected.source === "erp" ? "abastecimento" : "indisponivel",
    km_data: isTelemetry ? telemetry.data_hora : selected.source === "erp" ? fuel.data_ref : null,
    telemetria_descartada: Boolean(selected.telemetryRejected),
    telemetria_km: selected.telemetryRejected ? selected.telemetryKm : null,
    telemetria_motivo: selected.rejectionReason || null,
  };
}

// The screen and sender query this same source on every refresh/execution.
// Stored plan KM is the maintenance baseline and is never used as current KM.
export async function loadMaintenanceOdometers(plates = []) {
  const normalized = [...new Set(plates.map(normalizePlate).filter(Boolean))];
  if (!normalized.length) return new Map();
  const [fuelResult, telemetryResult] = await Promise.all([
    clientPool.query(`
      SELECT regexp_replace(upper(veiculoaba::text), '[^A-Z0-9]', '', 'g') AS placa,
             dataaba::date AS data_ref, kilometragematualaba::numeric AS km
      FROM frotas.abastecimentos
      WHERE regexp_replace(upper(veiculoaba::text), '[^A-Z0-9]', '', 'g') = ANY($1::text[])
        AND dataaba <= CURRENT_DATE
        AND kilometragematualaba BETWEEN 10000 AND 2000000
      ORDER BY dataaba DESC, kilometragematualaba DESC
    `, [normalized]),
    getVeiculosPool().query(`
      SELECT DISTINCT ON (placa) regexp_replace(upper(v.placa), '[^A-Z0-9]', '', 'g') AS placa,
             m.odometro, m.data_hora
      FROM rodobach.veiculos v
      LEFT JOIN LATERAL (
        SELECT odometro, data_hora FROM rodobach.mensagens_cb
        WHERE veiculo_id = v.veiculo_id AND odometro > 0 AND data_hora <= NOW()
        ORDER BY data_hora DESC LIMIT 1
      ) m ON TRUE
      WHERE regexp_replace(upper(v.placa), '[^A-Z0-9]', '', 'g') = ANY($1::text[])
      ORDER BY placa, m.data_hora DESC NULLS LAST
    `, [normalized]),
  ]);
  return new Map(normalized.map(plate => {
    const fuel = latestValidFuelOdometer(fuelResult.rows.filter(row => row.placa === plate));
    const telemetry = telemetryResult.rows.find(row => row.placa === plate);
    return [plate, resolveMaintenanceOdometer(telemetry, fuel)];
  }));
}
