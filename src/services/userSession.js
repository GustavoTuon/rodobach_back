import { createHmac } from "node:crypto";
import { config } from "../config.js";

export function sessionVersion(user) {
  return createHmac("sha256", config.jwtSecret).update(String(user.senha)).update("|").update(String(user.atualizado_em instanceof Date ? user.atualizado_em.toISOString() : user.atualizado_em || "")).digest("hex");
}

export function publicUser(user) {
  const permissions = {
      diretoria: user.perm_diretoria,
      simulador: user.perm_simulador,
      viagens: user.perm_viagens,
      "aprovar-viagens": Boolean(user.admin || user.perm_aprovar_viagens),
      "dre-empresarial": user.perm_dre_empresarial,
      "fluxo-caixa": user.perm_dre_empresarial,
      "faturamento-diario": user.perm_faturamento_diario ?? user.perm_dre_empresarial,
      "comparativo-faturamento": user.perm_comparativo_faturamento ?? user.perm_dre_empresarial,
      "analise-frota": user.perm_analise_frota,
      abastecimentos: user.perm_abastecimentos ?? user.perm_analise_frota,
      "precos-combustivel": user.perm_precos_combustivel ?? user.perm_abastecimentos ?? user.perm_analise_frota,
      "lucro-viagens": user.perm_lucro_viagens ?? user.perm_analise_frota,
      "custos-veiculos": user.perm_custos_veiculos,
      "manutencoes-veiculos": user.perm_manutencoes_veiculos,
      clientes: user.perm_clientes,
      "clientes-lucro": user.perm_clientes_lucro ?? user.perm_clientes,
      "status-carga": user.perm_status_carga ?? user.perm_viagens,
      "folgas-motoristas": user.perm_folgas_motoristas ?? user.perm_viagens,
      trafegus: user.perm_trafegus ?? user.perm_viagens,
      "oportunidades-retorno": user.perm_oportunidades_retorno ?? user.perm_viagens,
      "consulta-cte": user.perm_consulta_nfe ?? user.perm_viagens,
      "controle-canhotos": user.perm_controle_canhotos ?? user.perm_consulta_nfe ?? user.perm_viagens,
      pneus: user.perm_pneus,
      "multas-frota": user.perm_multas_frota ?? user.perm_manutencao,
      settings: user.perm_settings,
      manutencao: user.perm_manutencao,
      "manutencao-posicoes": user.perm_manutencao_posicoes ?? user.perm_manutencao,
      "automacoes-n8n": user.perm_automacoes_n8n ?? user.perm_manutencao,
    };

  return { id: user.id, login: user.login, email: user.email, numero: user.numero, admin: user.admin === true, permissions, readOnly: config.readOnly || config.readOnlyUsers.includes(String(user.login).toLowerCase()) };
}
