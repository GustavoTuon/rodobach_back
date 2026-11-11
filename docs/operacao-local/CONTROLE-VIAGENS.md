# Controle de viagens

A tela `Financeiro → Viagens → Controle de viagens` substitui a consulta no menu.
Os controles próprios usam `/api/financeiro/controle-viagens`, com a permissão
`lucro-viagens` e a política existente de acesso somente consulta. O ERP continua
somente leitura. A consulta antiga permanece disponível internamente para a
busca e importação de viagens.

Aplicar as migrações `088_controle_viagens.sql` e
`089_controle_viagens_diarias.sql` antes de publicar o backend.
Os controles, suas revisões e vínculos ficam em tabelas próprias da aplicação.
Cada gravação mantém uma versão no histórico e exige a revisão atual para
evitar sobrescrever alterações feitas por outra pessoa. Os documentos vinculados
são exclusivos por controle; remover o vínculo não exclui o documento original.

## Operação

- Criar uma viagem com placa e motorista ou importar uma viagem do ERP por
  empresa/número. Reimportar abre o mesmo controle, preservando as edições locais.
- Importação traz os dados principais, fretes, despesas, abastecimentos,
  adiantamentos, recebimentos e os
  totais existentes de diárias e comissão como lançamentos avulsos identificados.
- Vincular CT-es e abastecimentos por placa/período, e despesas já registradas
  em `manutencao_plantao`, excluindo registros apagados.
- Registrar manualmente fretes, despesas, abastecimentos, diárias avulsas,
  premiações, adiantamentos, recebimentos em mãos pelo motorista e ocorrências.
- Cada etapa é conferida explicitamente. Ausência de despesa não é uma etapa
  automaticamente concluída. Alterar seus lançamentos desfaz a conferência.
- Conclusão exige saída, retorno, horários, quilometragens, conferências e
  ocorrências resolvidas. É possível reabrir para conferência.

## Diárias e valores

O botão **Parâmetros de diárias** permite editar os padrões persistidos no banco.
A migração copia os três registros ativos do cadastro de diárias existente,
sem alterá-lo. Em 10/11/2026: café R$ 19,27 às 08h, almoço R$ 38,54 às 12h e
jantar R$ 28,90 às 21h ou após 11 horas de viagem no mesmo dia.
Os valores, horários e horas opcionais são editáveis, com revisão e histórico.

Uma refeição é contada se seu horário estiver dentro do período da viagem,
incluindo os limites, OU se as horas configuradas forem completadas no trecho
da viagem dentro daquele dia. Não é telemetria de horas efetivamente dirigidas.
O tempo por dia recomeça à meia-noite; uma refeição não é duplicada se ambas as
condições forem atendidas. O cálculo usa datas civis e o fuso de Brasília, sem
depender do fuso do servidor. Limite: 366 dias.

Novas viagens e novas importações usam o padrão atual. Viagens existentes
mantêm seus valores. **Aplicar padrão atual** copia as regras para a viagem;
recalcular e aplicar a prévia atualiza seus lançamentos. Salvar o padrão não
modifica viagens anteriores nem os parâmetros do simulador de frete.

A prévia permite desmarcar refeições. Aplicar substitui a lista calculada,
sem acrescentar cópias. Alterar o período exige recalcular. Diárias avulsas
permanecem separadas e devem ser conferidas antes de aplicar um cálculo para
evitar lançar novamente valores importados do ERP.

Resultado do controle = fretes − despesas − abastecimentos − diárias − premiações.
Saldo do motorista = diárias + premiações + reembolsos − adiantamentos − fretes
recebidos em mãos. Reembolso não é uma segunda despesa no resultado. Concluir
não executa pagamentos. Os totais são do controle, sem rateio de custos fixos
e sem inclusão automática dos lançamentos próprios nos relatórios financeiros
baseados no ERP.
