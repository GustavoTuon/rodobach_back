import { maintenanceDate } from "./maintenanceDates.js";

// Dependencies are injected so error notification can be tested without sending.
export async function executeMaintenanceDaily({run, notify, now = new Date()}) {
  const day = maintenanceDate(now);
  let result;
  try {
    result = await run({dryRun: false, dailyDate: day});
    if (result.ignorado) return {day, skipped: true, ok: true};
    if (result.ok) return {day, ok: true, accepted: result.enviados.length, failures: 0};
  } catch {
    // Never relay database or provider errors containing credentials.
    result = null;
  }
  const message = [
    "⚠️ *Falha nos alertas de manutenção*",
    `Data: ${day.split("-").reverse().join("/")}`,
    result ? `${result.falhas.length} envio(s) falharam ou ficaram sem confirmação. ${result.enviados.length} aceito(s).`
      : "A rotina não conseguiu concluir a consulta ou o envio dos alertas.",
    "Confira o histórico de manutenção e o registro da execução antes de reenviar.",
  ].join("\n");
  let notification = "failed";
  try {
    const response = await notify(message);
    if (!response?.error && response?.success !== false) notification = "accepted";
  } catch { /* The local execution log is the fallback if WhatsApp is unavailable. */ }
  return {day, ok: false, accepted: result?.enviados.length || 0, failures: result?.falhas.length || 1, notification};
}
