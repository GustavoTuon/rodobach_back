import {z} from 'zod';

export const reimbursementSchema = z.object({
  status:z.enum(['nao_aplicavel','a_cobrar','cobrado','recebido']),
  customer:z.string().trim().max(160).default(''),
  document:z.string().trim().max(100).default(''),
  receivedDate:z.iso.date().nullable().default(null),
  note:z.string().trim().max(300).default(''),
}).strict();

export function validateReimbursement(value, today) {
  if (value.status !== 'nao_aplicavel' && !value.customer) return 'Informe o cliente responsável pelo reembolso.';
  if (['cobrado','recebido'].includes(value.status) && !value.document) return 'Informe a referência da cobrança (CT-e ou outro documento).';
  if (value.status === 'recebido' && (!value.receivedDate || value.receivedDate > today)) return 'Informe uma data de recebimento válida, sem data futura.';
  if (value.status !== 'recebido' && value.receivedDate) return 'A data de recebimento só se aplica ao reembolso recebido.';
  return null;
}
