import jwt from "jsonwebtoken";
import { config, tableName } from "../config.js";
import { pool } from "../db/pool.js";
import { publicUser, sessionVersion } from "../services/userSession.js";

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Autenticação necessária." });
  }
  let claims;
  try {
    claims = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
    if (!claims || !Number.isSafeInteger(claims.id) || !claims.sessionVersion) throw new Error("Invalid session");
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado." });
  }
  try {
    const { rows: [user] } = await pool.query(`SELECT * FROM ${tableName("usuarios")} WHERE id = $1 AND ativo = true`, [claims.id]);
    if (!user || user.ativo !== true || sessionVersion(user) !== claims.sessionVersion) {
      return res.status(401).json({ error: "Sessao revogada. Faca login novamente." });
    }
    req.user = publicUser(user);
    next();
  } catch (error) {
    // Database outages are not invalid credentials; preserve the browser session.
    error.statusCode = 503;
    next(error);
  }
}
