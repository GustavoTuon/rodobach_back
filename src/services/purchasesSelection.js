import { createHash } from "node:crypto";
const cents = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

// A new response or negotiation requires the buyer to review the selection.
export function proposalVersion(invite) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        resposta: invite.resposta,
        descontos: invite.descontos || {},
        respondido_em: invite.respondido_em
          ? new Date(invite.respondido_em).toISOString()
          : null,
      }),
    )
    .digest("hex");
}
export function eligibleOffer(product, invite) {
  const offer = invite.resposta?.itens?.find((i) => i.id === product.id);
  if (
    !offer?.disponivel ||
    !(offer.valor > 0) ||
    !(product.quantidade > 0) ||
    offer.quantidade < product.quantidade
  )
    return null;
  const discount = invite.descontos?.[product.id];
  const price =
    discount?.original === offer.valor ? discount.valor : offer.valor;
  if (!(price > 0)) return null;
  return { offer, price };
}
export function purchasePlan(quote, invites) {
  const groups = new Map();
  const selections = {};
  let pending = 0,
    review = 0;
  for (const product of quote.itens) {
    const selected = quote.escolhas?.[product.id];
    if (!selected) {
      pending++;
      continue;
    }
    const invite = invites.find((i) => i.id === selected.conviteId);
    const eligible = invite && eligibleOffer(product, invite);
    const valid = Boolean(
      eligible && selected.versaoProposta === proposalVersion(invite),
    );
    selections[product.id] = {
      ...selected,
      valida: valid,
      fornecedor: invite?.nome || selected.fornecedor,
    };
    if (!valid) {
      review++;
      continue;
    }
    if (!groups.has(invite.id))
      groups.set(invite.id, {
        conviteId: invite.id,
        fornecedor: invite.nome,
        email: invite.email,
        telefone: invite.telefone,
        prazoEntrega: invite.resposta.prazoEntrega,
        pagamento: invite.resposta.pagamento,
        frete: cents(Number(invite.resposta.frete || 0)),
        subtotal: 0,
        desconto: 0,
        itens: [],
      });
    const group = groups.get(invite.id);
    const total = cents(eligible.price * product.quantidade);
    const discount = cents(
      cents(eligible.offer.valor * product.quantidade) - total,
    );
    group.itens.push({
      produtoId: product.id,
      nome: product.nome,
      unidade: product.unidade,
      quantidade: product.quantidade,
      marca: eligible.offer.marca,
      original: eligible.offer.valor,
      unitario: eligible.price,
      total,
      desconto: discount,
      motivo: selected.motivo,
    });
    group.subtotal = cents(group.subtotal + total);
    group.desconto = cents(group.desconto + discount);
  }
  const suppliers = [...groups.values()].map((g) => ({
    ...g,
    total: cents(g.subtotal + g.frete),
  }));
  return {
    escolhas: selections,
    fornecedores: suppliers,
    pendentes: pending,
    revisar: review,
    completa:
      quote.status !== "cancelada" &&
      !quote.origem_chave &&
      quote.itens.length > 0 &&
      pending === 0 &&
      review === 0,
    subtotal: cents(suppliers.reduce((n, g) => n + g.subtotal, 0)),
    frete: cents(suppliers.reduce((n, g) => n + g.frete, 0)),
    desconto: cents(suppliers.reduce((n, g) => n + g.desconto, 0)),
    total: cents(suppliers.reduce((n, g) => n + g.total, 0)),
  };
}
