import { z } from "zod";

export const loginSchema = z.object({
  login: z.string().trim().min(1).max(120),
  senha: z.string().min(1).max(256),
}).strict();

export function validateBody(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Dados invalidos.",
        fields: parsed.error.issues.map(({ path, message }) => ({ field: path.join("."), message })),
      });
    }
    req.body = parsed.data;
    next();
  };
}
