# Auditoria de duplicidade de custos — 22/09/2026

Período consultado: 01/01/2026 a 22/09/2026. Consultas somente de leitura,
sem alteração de lançamentos, valores ou regras do portal.

## Custos, Resultado por veículo e Evolução de custos

Os três caminhos usam `baseCostCte()` de `custosVeiculosService.js`. A base padrão
contém apenas contas a pagar/rateios, status 1 ou 2. As fontes operacionais de
abastecimento, OS, notas de entrada, pneus, multas e despesas de viagem não são
somadas novamente nessa base. Resultado usa o mesmo custo, não adiciona novamente
o custo retornado pela análise de receitas. Os filtros de cavalo/carreta usam OR,
sem concatenar lançamentos de consultas independentes.

- 4.891 linhas e 4.891 identificadores únicos no período de vencimento analisado.
- 3.703 títulos: todos os somatórios de rateio coincidem com os valores dos títulos
  dentro da tolerância de dois centavos; nenhuma divergência encontrada.
- Nenhum grupo com títulos distintos e a mesma empresa, fornecedor, documento
  não vazio, emissão, parcela e valor, no período de emissão analisado.
- Setembro (01 a 22), frota: 319 lançamentos e R$ 340.050,81.
  O retorno real de `getCustosVeiculos` informa o mesmo total em `summary` e
  `profit.summary`. A origem de todas essas 319 linhas é `financeiro.pagar`.
- Testes de integração `custosVeiculosFinanceiro` e `abastecimentoFinanceiro`,
  com `TEST_CLIENT_DB=true`: ambos passaram. O primeiro concilia a consulta
  financeira e seus agrupamentos com o ERP; o segundo verifica os vínculos de
  notas e abastecimentos usando fixtures SQL somente de leitura.

## DRE empresarial

- Retorno real: 5.001 linhas de contas a pagar, sem repetição da chave composta
  de título/parcela/fornecedor/centro/conta.
- Total dessas linhas: R$ 7.368.110,48, igual à consulta direta ao rateio do ERP.
- 136 movimentos diretos: 86 de banco e 50 de caixa, com R$ 117.539,97 em valores
  absolutos. A contagem e o valor correspondem às fontes classificadas, sem
  multiplicação pelo cadastro de contas financeiras.
- Não foram encontrados pares banco/caixa vinculados que estivessem entrando
  simultaneamente nessa seleção.
- O DRE usa emissão; Custos/Resultado usam vencimento. Totais distintos entre
  essas telas, para o mesmo intervalo, não demonstram duplicidade por si.

## Exceção que exige conferência documental

Em movimentos diretos administrativos há registros com mesmo dia, valor e
descrição. Alguns correspondem a pessoas diferentes e não devem ser removidos
por semelhança. Um par de caixa também coincide na pessoa:

| Data | Centro | Histórico | Valor de cada registro | Registros | Recibos |
|---|---|---|---:|---|---|
| 15/08/2026 | Área Administrativa (2) | SERVIÇO REALIZADO | R$ 75,00 | 4641 e 4726 | 1131 e 1121 |

Os dois registros têm pessoa 2523, mas recibos distintos. Isso é um candidato a
conferência, não uma duplicidade comprovada. O portal reproduz duas linhas que
já existem no ERP. Não é um custo identificado por placa. Se ambos representarem
o mesmo serviço, haveria R$ 75,00 a mais; se forem dois serviços, os R$ 150,00 são
legítimos. Os comprovantes não foram examinados nesta auditoria.

## Limite da conclusão

Não foi encontrada duplicação introduzida pelas consultas de custos por veículo
no período testado. Isso não certifica que todos os registros de origem representam
despesas distintas: documentos ausentes, números diferentes ou serviços similares
exigem conferência operacional. A análise não equivale a auditoria contábil de
todos os períodos, nem a conciliação de todos os custos estimados por frete/cliente.
