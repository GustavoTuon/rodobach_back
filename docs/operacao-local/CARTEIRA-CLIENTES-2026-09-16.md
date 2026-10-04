# Carteira financeira de clientes

## Acesso
Clientes → Carteira completa / cobrança. A aba é independente do período e do status comercial da análise de faturamento.

## Entrega
- Carteira de todas as emissões: saldo total, a vencer incluindo hoje, vencido e sem vencimento informado.
- Faixas mutuamente exclusivas de atraso: 1–15, 16–30, 31–60 e mais de 60 dias.
- Busca por cliente, filial, CPF ou CNPJ; filtro de empresa; resumo exportável em CSV com proteção contra fórmulas.
- Clique no cliente ou no valor de uma faixa para abrir os títulos que compõem o saldo.
- Detalhe com empresa, série, título, parcela, filial, emissão, vencimento, valor original, saldo atual e atraso; 50 títulos por página e totais de todas as páginas.
- Última baixa positiva encontrada para o cliente/grupo, considerando também títulos já liquidados e filiais sem saldo atual.
- Agrupamento pela raiz do CNPJ; cadastros sem documento válido para agrupamento e valores sem cliente identificado são preservados.

## Regras e segurança
Endpoint GET `/api/financeiro/analise-clientes/carteira`, sob a política existente de Clientes / Diretoria. Não modifica recebíveis, não envia cobranças e não exige migração.

Somente status 1 ou 2 e saldo positivo. Sem corte de emissão ou vencimento: inclui pendências anteriores a 2025. Usa o saldo do ERP, já reduzido por baixas parciais, sem calcular juros ou multas adicionais. O dia comercial é America/Sao_Paulo. Uma transação somente leitura com snapshot consistente mantém totais e títulos alinhados em cada resposta.

Campos de busca da interface não alteram os dados. Paginação e filtros do endpoint são validados, e parâmetros SQL são vinculados. O cadastro da empresa do título tem preferência; junção limitada a um cadastro evita multiplicação de valores por cadastros duplicados.

## Validação
- 6 testes específicos do backend aprovados: autorização, entradas, centavos, transação, ausência de cliente e SQL real com dados sintéticos em VALUES (sem gravações).
- SQL real validou limites das faixas, vencimento de hoje, datas ausentes, emissão antiga, baixa parcial, cancelados, títulos zerados, filiais, empresa e paginação de 65 títulos.
- 6 testes existentes da análise de clientes e 8 testes do frontend aprovados, incluindo abertura do detalhe, busca, troca de empresa e recuperação de erro.
- Conciliação somente leitura com soma direta do ERP por empresa e consolidado, sem diferenças. A quantidade de títulos mudou durante a verificação porque a base está ativa; os totais da tela representam a consulta atual.
- Build e lint dos arquivos de produção alterados aprovados. Interação testada em DOM simulado, sem inspeção visual em navegador real.

Sem publicação no Git/Easypanel ou mudanças na configuração do servidor de produção.
