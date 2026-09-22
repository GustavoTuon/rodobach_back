import fs from "node:fs";

export function tlsOptions(enabled, prefix, env = process.env) {
  if (!enabled) return false;
  const caFile = env[`${prefix}_SSL_CA_FILE`];
  return { rejectUnauthorized: true, ...(caFile ? { ca: fs.readFileSync(caFile, "utf8") } : {}) };
}
