import { createHash } from "node:crypto";

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function smSignature(sm) {
  return hash({
    link: sm.link_rota || "",
    map: sm.mapaViagem || "",
    route: sm.rota_identificador || "",
    origin: sm.referenciaOrigemDescricao || "",
    destination: sm.referenciaDestinoDescricao || "",
    vehicle: sm.veiculoPlaca || "",
    driverCpf: sm.cpfMotorista || "",
    status: sm.statusViagemCodigo || "",
    changedBy: sm.usuarioAlterou || "",
  });
}

function routeChangeKey(change) {
  return [
    change.viag_codigo,
    change.rota_codigo,
    change.vrot_data_cadastro_ordenacao || change.vrot_data_cadastro,
    change.vrot_operacao,
  ].join("|");
}

export function detectChanges(state, sms, routeChanges) {
  const next = structuredClone(state);
  const pending = new Map();

  for (const sm of sms) {
    const id = String(sm.id);
    const signature = smSignature(sm);
    if (state.initialized && state.sms[id] && state.sms[id] !== signature) {
      pending.set(id, { sm, reasons: ["SM alterada"] });
    } else if (state.initialized && !state.sms[id]) {
      pending.set(id, { sm, reasons: ["SM criada"] });
    }
    next.sms[id] = signature;
  }

  const smById = new Map(sms.map((sm) => [String(sm.id), sm]));
  for (const change of routeChanges) {
    const key = routeChangeKey(change);
    if (state.initialized && !state.routeChanges[key]) {
      const id = String(change.viag_codigo);
      const sm = smById.get(id);
      if (sm) {
        const item = pending.get(id) || { sm, reasons: [] };
        item.reasons.push(`rota ${change.vrot_operacao || "alterada"}`);
        pending.set(id, item);
      }
    }
    next.routeChanges[key] = true;
  }

  next.initialized = true;
  next.lastPollAt = new Date().toISOString();
  return { next, events: [...pending.values()] };
}

export function routeChangeIdentity(change) {
  return routeChangeKey(change);
}
