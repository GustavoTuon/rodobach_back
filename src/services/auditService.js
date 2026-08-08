import { logger } from "../logger.js";

export function auditMutation(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  res.on("finish", () => {
    logger.info({
      event: "audit.http_mutation",
      actorId: req.user?.id,
      actorLogin: req.user?.login,
      method: req.method,
      path: req.originalUrl?.split("?")[0],
      statusCode: res.statusCode,
      requestId: req.id,
    }, "Operacao mutavel concluida");
  });
  next();
}
