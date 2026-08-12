const DAILY_MAX_KM = 2000;
const BASE_TOLERANCE_KM = 2000;

function reading(value, date) {
  const km = Number(value);
  const parsedDate = date ? new Date(date) : null;
  return {
    km: Number.isFinite(km) && km > 0 ? km : null,
    date: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null,
  };
}

export function selectCurrentOdometer({ telemetryKm, telemetryDate, erpKm, erpDate } = {}) {
  const telemetry = reading(telemetryKm, telemetryDate);
  const erp = reading(erpKm, erpDate);
  if (!telemetry.km && !erp.km) return { km: null, source: "indisponivel", telemetryRejected: false };
  if (!telemetry.km) return { km: erp.km, source: "erp", telemetryRejected: false };
  if (!erp.km) return { km: telemetry.km, source: "telemetria", telemetryRejected: false };

  const daysAfterErp = telemetry.date && erp.date
    ? Math.max(0, (telemetry.date - erp.date) / 86400000)
    : 0;
  const allowedAdvance = BASE_TOLERANCE_KM + Math.ceil(daysAfterErp) * DAILY_MAX_KM;
  const tooFarBehind = telemetry.km < erp.km - BASE_TOLERANCE_KM;
  const implausiblyAhead = telemetry.km > erp.km + allowedAdvance;

  if (tooFarBehind || implausiblyAhead) {
    return {
      km: erp.km,
      source: "erp",
      telemetryRejected: true,
      rejectionReason: tooFarBehind ? "telemetria_abaixo_erp" : "salto_telemetria_incompativel",
      telemetryKm: telemetry.km,
      erpKm: erp.km,
    };
  }
  return telemetry.km >= erp.km
    ? { km: telemetry.km, source: "telemetria", telemetryRejected: false }
    : { km: erp.km, source: "erp", telemetryRejected: false };
}
