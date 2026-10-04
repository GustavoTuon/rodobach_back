export const EXTRA_SCREEN_PERMISSIONS = [
  {
    "id": "painel-tv",
    "label": "Painel TV",
    "group": "sistema",
    "legacy": "perm_status_carga",
    "column": "perm_painel_tv"
  },
  {
    "id": "manutencao-plantao",
    "label": "Manutenção de plantão — lançar",
    "group": "frota",
    "legacy": null,
    "column": "perm_manutencao_plantao"
  },
  {
    "id": "conferencia-manutencao",
    "label": "Manutenção de plantão — conferir",
    "group": "frota",
    "legacy": null,
    "column": "perm_conferencia_manutencao"
  }
];
export const EXTRA_PERMISSION_COLUMNS = EXTRA_SCREEN_PERMISSIONS.map(item => item.column);
