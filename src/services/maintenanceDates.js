// PostgreSQL DATE values can arrive as Date objects. Keep the calendar day in
// Brasília; never derive a date by slicing Date.toString().
export function maintenanceDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'}).format(value);
  }
  const date = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

export function daysUntilMaintenance(value, now = new Date()) {
  const date = maintenanceDate(value), today = maintenanceDate(now);
  if (!date || !today) return null;
  return Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
}
