function numericCoordinate(point) {
  const latitude = Number(point?.latitude ?? point?.lat);
  const longitude = Number(point?.longitude ?? point?.lng);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude }
    : null;
}

export function parseOfficialPolyline(value) {
  try {
    const points = Array.isArray(value) ? value : JSON.parse(String(value || "[]"));
    return points.map(numericCoordinate).filter(Boolean);
  } catch {
    return [];
  }
}
