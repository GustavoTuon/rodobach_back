# Análise de clientes — 16/09/2026

## Implementado
- Cards financeiros, média por cliente, rankings e distribuição calculados sobre a mesma seleção de clientes da tabela, excluindo cadastros técnicos.
- Evolução mensal e inatividade mantêm escopo geral da empresa, explicitamente identificado. Busca textual passa a afetar também os indicadores da seleção.
- Ativo padronizado em até 30 dias, com faturamento positivo e data conhecida. Removida inferência de potencial por comparação de métricas incompatíveis.
- Ticket médio do backend usa faturamento e quantidade da mesma população comercial.
- Quatro cards principais; indicadores complementares expansíveis; tabela com resumo e financeiro completo, rolagem e cabeçalhos fixos.
- Maior queda ordenada e exibida por perda em reais; concentração Top 5; ausência de base comparativa explicitada.
- Linguagem de negócio, títulos financeiros corretamente nomeados e metodologia acessível.
- Exportação neutraliza fórmulas em texto.

## Limites preservados e explicitados
- Saldo e vencido são atuais e abrangem títulos emitidos no período, não a carteira total ou saldo histórico.
- Corte de vencimentos anteriores a 2025 e tolerância de cinco dias continuam vigentes.
- Classificação e inatividade referem-se a hoje.
- Rentabilidade permanece na tela própria; não houve união de bases com identidades diferentes de clientes.
- Carteira integral por faixas de atraso e segmentação de novos/reativados não foram acrescentadas nesta entrega.
- Sem migrações, alteração de dados financeiros, publicação ou mudanças na configuração do servidor.

## Validação
Seis testes do serviço, três testes de cálculo/exportação e um teste de interação da tela aprovados. Build do frontend e lint dos arquivos de produção alterados aprovados. A interação foi validada em DOM simulado, sem inspeção visual em navegador real.
