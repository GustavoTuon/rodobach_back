# Conciliação LXG1J87 — Resultado por Veículo e DRE

Conferência de 12/09/2026. Placa LXG1J87, período 01/01/2026 a 12/09/2026, sem filtro adicional de empresa, centro ou situação. Não há implementos vinculados na consulta do conjunto dessa placa.

## Falha identificada e correção

A consulta de custos incluía todos os status de contas a pagar. O DRE, o fluxo de caixa e as despesas futuras já usam somente `statuspag IN (1,2)`. A restrição foi aplicada à base compartilhada por Análise de Custos e Resultado por Veículo, e à consulta de conciliação financeira. Ela se aplica a todas as categorias, placas e períodos.

A auditoria anterior verificava repetição da chave e soma de rateios, mas não verificava a elegibilidade dos títulos por status. Isso deixou passar valores que o DRE exclui, mesmo sem repetição literal de identificadores. Nenhum registro do ERP foi alterado.

## Abastecimento na imagem

| Composição pelo vencimento | Rateios | Valor |
|---|---:|---:|
| Status 2 — mantido | 25 | R$ 32.898,89 |
| Status 3 — excluído | 3 | R$ 7.987,92 |
| Status 4 — excluído | 18 | R$ 11.454,60 |
| Status 6 — excluído | 17 | R$ 13.808,66 |
| Total anterior de abastecimento | 63 | R$ 66.150,07 |
| Exclusões por status | 38 | R$ 33.251,18 |

Na imagem, R$ 87.813,57 era o custo total, não apenas abastecimento. O total corrigido de custos é R$ 51.892,20:

| Categoria | Valor corrigido |
|---|---:|
| Abastecimento | R$ 32.898,89 |
| Lavação | R$ 409,28 |
| Manutenção | R$ 5.917,13 |
| Outros | R$ 5.588,98 |
| Pedágio | R$ 2.114,42 |
| Seguro | R$ 4.963,50 |
| **Total** | **R$ 51.892,20** |

## Diferença remanescente para o DRE

Com os mesmos filtros, o serviço do DRE retorna R$ 33.391,04 em “Combustíveis e Lubrificantes”, em 26 lançamentos. Não foi reproduzido o valor aproximado de R$ 39 mil mencionado inicialmente.

A diferença de R$ 492,15 é integralmente explicada pelo título da empresa 2, série 1, duplicata 256214, parcela 1, fornecedor 294, centro 170, conta 49:

- Emissão: 01/09/2026 — incluído no DRE.
- Vencimento: 01/10/2026 — fora do período da tela de custos.

As telas de custos mantêm o critério de vencimento informado na interface; o DRE usa emissão. A diferença de data não é duplicação. A view `financeiro.valorliquidorateiospagar` usada pelo DRE expõe `valorrateioprt` como `valorliquido`, portanto não existe diferença de valor bruto/líquido nessa view neste banco.

Esta conciliação valida a causa e os valores dessa placa/período. Não atribui nomes aos códigos de status 3, 4 e 6 sem confirmação do cadastro do ERP.
