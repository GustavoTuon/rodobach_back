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

const userFields = {
  login: z.string().trim().min(1).max(120),
  senha: z.string().min(8).max(72).refine(value => Buffer.byteLength(value, "utf8") <= 72, "Senha excede 72 bytes."),
  email: z.union([z.email(), z.literal(""), z.null()]),
  numero: z.string().max(40).nullable(),
  admin: z.boolean(),
  ativo: z.boolean(),
  perm_diretoria: z.boolean(),
  perm_simulador: z.boolean(),
  perm_viagens: z.boolean(),
  perm_dre_empresarial: z.boolean(),
  perm_analise_frota: z.boolean(),
  perm_abastecimentos: z.boolean(),
  perm_precos_combustivel: z.boolean(),
  perm_faturamento_diario: z.boolean(),
  perm_comparativo_faturamento: z.boolean(),
  perm_lucro_viagens: z.boolean(),
  perm_custos_veiculos: z.boolean(),
  perm_manutencoes_veiculos: z.boolean(),
  perm_clientes: z.boolean(),
  perm_clientes_lucro: z.boolean(),
  perm_status_carga: z.boolean(),
  perm_pneus: z.boolean(),
  perm_multas_frota: z.boolean(),
  perm_settings: z.boolean(),
  perm_manutencao: z.boolean(),
  perm_automacoes_n8n: z.boolean(),
  perm_folgas_motoristas: z.boolean(),
  perm_trafegus: z.boolean(),
  perm_oportunidades_retorno: z.boolean(),
  perm_consulta_nfe: z.boolean(),
  perm_manutencao_posicoes: z.boolean(),
  perm_controle_canhotos: z.boolean(),
  perm_aprovar_viagens: z.boolean(),
};
export const createUserSchema = z.object(userFields).partial().required({ login: true, senha: true }).strict();
export const updateUserSchema = z.object({ ...userFields, senha: z.union([userFields.senha, z.literal("")]) }).partial().strict();
