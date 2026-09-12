# Auditoria de custos por veículo

> Revisão posterior: os totais e a conclusão abaixo ficaram incompletos porque a primeira auditoria não excluiu títulos com status diferentes de 1 e 2. Conciliar a soma dos rateios sem esse filtro não garante ausência de dupla contabilização de títulos. A consulta e o script foram corrigidos. Veja [a conciliação da LXG1J87 com o DRE](AUDITORIA-LXG1J87-DRE.md). Os números abaixo ficam apenas como registro da investigação anterior, não como totais atuais validados.

Consulta realizada em 12/09/2026, para 01/07/2026 a 30/09/2026. Setembro inclui títulos com vencimento posterior à data da auditoria. Valores da frota própria, salvo indicação em contrário. Banco consultado somente em leitura.

## Resultado

Pedágios: 27 rateios, total de **R$ 56.300,09**, todos originados no contas a pagar. Não foram encontradas repetições de identificadores na consulta nem divergências superiores a R$ 0,02 entre os títulos financeiros e a soma dos respectivos rateios no período. Isso não equivale a validar cada cobrança da concessionária ou detectar notas diferentes lançadas indevidamente no ERP.

Em “Outros”, a consulta anterior acrescentava 10 despesas de viagem (R$ 5.560,23), incluindo adiantamentos de prêmio e estacionamento com observações TAG/Sem Parar. Sem vínculo documental suficiente, não é possível afirmar que todo esse valor representa duplicação.

Conforme a orientação de usar o contas a pagar como referência, Análise de Custos e Resultado por Veículo passaram a somar exclusivamente os rateios dos títulos financeiros. Abastecimentos, multas, notas e ordens de serviço operacionais não são acrescentados aos totais. Os registros originais não foram alterados ou apagados.

## Diferença de fonte

Comparação com a consulta anterior, já contendo o primeiro ajuste de abastecimentos:

| Categoria | Contas a pagar mantido | Operacional fora da soma |
|---|---:|---:|
| Abastecimento | R$ 568.927,07 | R$ 15.417,50 |
| Lavação | R$ 1.976,00 | R$ 0,00 |
| Manutenção | R$ 69.742,63 | R$ 1.371,12 |
| Motorista/frete | R$ 3.333,32 | R$ 0,00 |
| Multas | R$ 15.358,81 | R$ 9.574,19 |
| Outros | R$ 801.720,87 | R$ 5.560,23 |
| Pedágio | R$ 56.300,09 | R$ 0,00 |
| Seguro | R$ 56.337,16 | R$ 0,00 |
| **Total** | **R$ 1.573.695,95** | **R$ 31.923,04** |

Os R$ 31.923,04 são exclusões pela mudança de fonte, não uma quantificação de duplicação confirmada. Custos existentes apenas no operacional passam a depender de registro e rateio no contas a pagar para aparecer nos totais.

## Conciliação

- Total anterior da frota: R$ 1.605.618,99.
- Total financeiro da frota: R$ 1.573.695,95, em 1.423 rateios.
- Soma dos veículos, categorias, lançamentos e meses: R$ 1.573.695,95 em todos os casos, conferida na resposta do serviço usado pelas telas.
- Sem filtro de propriedade, total da consulta e total direto dos rateios do ERP: R$ 2.825.947,35 em ambos.
- Nenhum registro operacional no total financeiro.
- Foram encontrados 2 títulos sem rateio, somando R$ 32,00, no universo financeiro. Não entram na base por veículo; precisam de rateio para serem distribuídos. Não foi feita atribuição automática.

O filtro de custos usa **vencimento**, e a evolução mensal foi alinhada ao mesmo critério. Receitas seguem a emissão dos CT-es. “Outros” mantém a classificação financeira existente: esta auditoria não reclassificou contas. A resolução de placa/centro de custo mantém a regra existente; a conciliação de somas não valida isoladamente cada atribuição de placa.

## Reprodução

Na pasta do backend:

```powershell
node scripts/audit-custos-veiculos.mjs 2026-07-01 2026-09-30
$env:TEST_CLIENT_DB='true'
node --test test/custosVeiculosFinanceiro.test.js test/abastecimentoFinanceiro.test.js
```

O script executa a comparação em uma transação somente leitura, com visão consistente dos dados. A união operacional permanece disponível apenas para essa auditoria comparativa; não é uma opção enviada pelas telas.
