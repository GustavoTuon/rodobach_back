import { config } from "../config.js";

// These POSTs calculate values without persisting changes or sending messages.
const CALCULATIONS = new Set(["/frete/calcular", "/motoristas/diarias/calcular", "/cargas-viagens-v2/gestao/preco", "/cargas-viagens-v2/gestao/cotacao"]);
export function enforceReadOnly(req, res, next) {
  if (!config.readOnly && !req.user?.readOnly) return next();
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.method === "POST" && CALCULATIONS.has(req.path.toLowerCase().replace(/\/$/, ""))) return next();
  return res.status(403).json({ error: "Este acesso permite somente consulta." });
}
