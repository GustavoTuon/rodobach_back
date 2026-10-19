import { z } from "zod";

const text = z.string().trim().max(1000);
const positive = z.number().finite().positive().max(1e9);
export const supplierSchema = z
  .object({
    nome: z.string().trim().min(2).max(200),
    documento: text.default(""),
    email: z.union([z.string().email().max(254), z.literal("")]).default(""),
    telefone: text.default(""),
    empresa: z.string().max(40).optional(),
    codigo: z.string().max(40).optional(),
  })
  .refine(
    (v) => Boolean(v.empresa) === Boolean(v.codigo),
    "Informe empresa e código juntos.",
  );
export const quoteSchema = z
  .object({
    titulo: z.string().trim().min(3).max(200),
    prazo: z
      .string()
      .datetime({ offset: true })
      .refine((v) => Date.parse(v) > Date.now(), "Prazo deve estar no futuro."),
    observacoes: text.default(""),
    itens: z
      .array(
        z.object({
          empresa: z.string().min(1).max(40),
          codigo: z.string().min(1).max(40),
          quantidade: positive,
          unidade: z.string().trim().min(1).max(30),
          fornecedores: z.array(z.string().uuid()).min(1).max(100),
        }),
      )
      .min(1)
      .max(200),
  })
  .refine(
    (v) =>
      new Set(v.itens.map((i) => `${i.empresa}:${i.codigo}`)).size ===
      v.itens.length,
    "Produto repetido.",
  );
export const responseSchema = z.object({
  frete: z.number().finite().min(0).max(1e9),
  prazoEntrega: text,
  pagamento: text,
  observacoes: text.default(""),
  itens: z
    .array(
      z
        .object({
          id: z.string().uuid(),
          disponivel: z.boolean(),
          quantidade: z.number().finite().min(0).max(1e9),
          valor: z.number().finite().min(0).max(1e9),
          marca: z.string().trim().max(200),
          observacoes: text.default(""),
        })
        .refine(
          (i) =>
            !i.disponivel ||
            (i.quantidade > 0 && i.valor > 0 && i.marca.length > 0),
          "Informe quantidade, valor e marca dos itens disponíveis.",
        ),
    )
    .min(1)
    .max(200),
});
export function parsePurchase(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success)
    throw Object.assign(
      new Error(result.error.issues.map((i) => i.message).join(" ")),
      { status: 400 },
    );
  return result.data;
}
export function validateAssignedItems(assigned, response) {
  const ids = response.itens.map((i) => i.id);
  if (
    ids.length !== assigned.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !assigned.includes(id))
  ) {
    throw Object.assign(
      new Error("Responda apenas e todos os produtos deste convite."),
      { status: 400 },
    );
  }
}
