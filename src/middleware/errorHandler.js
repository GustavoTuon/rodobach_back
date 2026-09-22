export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const candidate = Number(error.statusCode || error.status);
  const status = candidate >= 400 && candidate <= 599 ? candidate : 500;
  if (status >= 500) req.log?.error({ err: error }, "Falha na requisicao");
  const message = error.type === "entity.parse.failed" ? "JSON invalido."
    : status === 413 ? "Requisicao excede o tamanho permitido."
    : status < 500 ? error.message : "Servico indisponivel. Tente novamente mais tarde.";
  res.status(status).json({ error: message });
}
