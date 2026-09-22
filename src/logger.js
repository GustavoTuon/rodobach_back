import pino from "pino";

export const loggerOptions = {
  level: process.env.LOG_LEVEL || "info",
  serializers: {
    req(req) {
      return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
    err(error) {
      // Driver errors can contain SQL, parameters, URLs and credentials.
      return { type: error?.name || error?.type, code: error?.code, statusCode: error?.statusCode };
    },
  },
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']", "password", "senha", "token", "apiKey", "*.password", "*.senha", "*.token", "*.apiKey"],
    censor: "[REDACTED]",
  },
};

export const logger = pino(loggerOptions);
