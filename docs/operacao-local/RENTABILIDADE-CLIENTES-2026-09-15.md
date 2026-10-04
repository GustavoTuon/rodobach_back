# Rentabilidade por cliente e rota

## Entrega

A opção existente **Rentabilidade Clientes** abre a nova análise de receita documental e margem parcial. Inclui comparação com período anterior de mesma duração, agrupamentos por cliente/empresa e rota, busca, CT-es dos dois períodos, origem do custo, exportação CSV de clientes e cartas-frete compartilhadas separadas.

Endpoint: `GET /api/clientes/rentabilidade/analise?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`. Usa a permissão existente `clientes-lucro`. Nenhuma migração ou variável de ambiente nova.

## Critérios e limites

- Base: CT-es autorizados normais/substitutos com chave fiscal, pela emissão. Chaves repetidas entram uma vez, escolhendo deterministicamente empresa/série/código. Orçamentos, cancelados, complementos e anulações ficam fora. Esta receita não corresponde necessariamente à receita financeira da DRE.
- Cliente: tomador do CT-e. Cadastros de empresas distintas permanecem separados; não há consolidação automática por grupo econômico.
- Custo direto: valor do frete contratado em cartas-frete exclusivas, não canceladas. Sem carta, usa o frete/comissão de motorista vinculado ao documento. Não soma as duas fontes.
- Uma carta com vários documentos não é rateada. Seu valor integral aparece uma vez na seção de custos compartilhados; pode abranger outros períodos. Carta sem valor válido também não vira custo zero.
- Saldo parcial = receita dos documentos com custo identificado menos esse custo. Receita de documentos sem custo aparece separadamente e não infla o saldo. A cobertura é mostrada em quantidade de documentos; não comprova que todos os tipos de despesa foram registrados.
- Combustível, manutenção, impostos, despesas gerais e outros custos sem vínculo inequívoco não são incorporados nem quantificados por cliente nesta entrega. O resultado não representa lucro líquido. Não há indicadores por km nesta visão, pois a quilometragem por documento ainda não foi validada.
- Variação de margem em pontos percentuais exige custo identificado em todos os documentos dos dois períodos e receita positiva. Ausência de base comparável não vira variação zero.
- Intervalo de até 366 dias. Mais de 10 mil documentos nos dois períodos gera orientação para reduzir o intervalo, sem exibir relatório truncado. Cache de 30 segundos, limitado em memória e concorrência.
- Os serviços antigos continuam disponíveis para outros consumidores; esta entrega não corrige retroativamente os cálculos usados por outras telas.

## Validação

- Backend: 119 testes aprovados, 2 de integração desabilitados. Os 7 testes novos de margem foram repetidos após o último ajuste e passaram.
- Frontend: 41 testes aprovados; lint sem erros ou avisos; build aprovado.
- Lint backend: nenhum erro, 15 avisos preexistentes.
- Baixa cobertura é uma limitação real da atribuição conservadora. Não foi preenchida com estimativas.

## Operação

Código local, sem publicação, sem inserção de dados e sem alteração de configuração do PostgreSQL. Para publicar, é necessário atualizar backend e frontend. TLS e credenciais continuam adiados conforme solicitado.
