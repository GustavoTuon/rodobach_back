export const EXTRA_SCREEN_PERMISSIONS = [
  { id: "compras", label: "Compras", group: "operacao", legacy: null, column: "perm_compras" },
  { id: "ociosidade-frota", label: "Ociosidade (teste)", group: "operacao", legacy: "perm_status_carga", column: "perm_ociosidade_frota" },
  {
    "id": "painel-tv",
    "label": "Painel TV",
    "group": "sistema",
    "legacy": "perm_status_carga",
    "column": "perm_painel_tv"
  },
  {
    "id": "manutencao-plantao",
    "label": "Despesas — registrar",
    "group": "frota",
    "legacy": null,
    "column": "perm_manutencao_plantao"
  },
  {
    "id": "conferencia-manutencao",
    "label": "Despesas — conferir",
    "group": "frota",
    "legacy": null,
    "column": "perm_conferencia_manutencao"
  },
  {id: "pagamento-despesas", label: "Despesas — registrar pagamentos", group: "frota", legacy: null, column: "perm_pagamento_despesas"},
  {id: "lancamento-despesas", label: "Despesas — marcar lançamento no erp", group: "frota", legacy: null, column: "perm_lancamento_despesas"},
  {id: "reembolso-despesas", label: "Despesas — controlar reembolsos", group: "frota", legacy: null, column: "perm_reembolso_despesas"},
];
export const EXTRA_PERMISSION_COLUMNS = EXTRA_SCREEN_PERMISSIONS.map(item => item.column);
