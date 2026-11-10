export function isWhatsappGroup(value) {
  return /^\d+(?:-\d+)?@g\.us$/.test(String(value || "").trim());
}

export function normalizeWhatsappRecipient(value) {
  const text = String(value || "").trim();
  return isWhatsappGroup(text) ? text : text.replace(/\D/g, "");
}
