// Veículo próprio controlado na oficina mesmo sem cadastro na telemetria.
export const ADDITIONAL_MAINTENANCE_PLATES = ['LXG1J87'];

export function mergeMaintenanceVehicles(telemetryVehicles, erpVehicles) {
  const normalize = (plate) => String(plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const vehicles = new Map();
  for (const row of [...telemetryVehicles, ...erpVehicles]) {
    const plate = normalize(row.placa);
    if (plate && !vehicles.has(plate)) vehicles.set(plate, { ...row, placa: plate });
  }
  return [...vehicles.values()].sort((a, b) => a.placa.localeCompare(b.placa));
}
