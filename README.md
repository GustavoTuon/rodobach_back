# Rodobach Backend

## Pneu vinculado na despesa de borracharia

O lançamento permite escolher entre os pneus montados na placa (ERP e
movimentações locais), por número, posição ou marca. A API valida empresa,
número e placa e salva a identificação em `pneu_vinculado`, junto ao número
de fogo. Editar a despesa preserva a posição registrada, mesmo que o pneu
tenha sido movimentado depois. Trocar a placa exige selecionar novamente.
Também é possível informar um número manualmente ou continuar sem número;
esses casos não criam vínculo com o cadastro. O lançamento não movimenta pneus.

Antes de iniciar a API atualizada, execute
`node scripts/apply-expense-tire.mjs --apply` (migração 080). Sem `--apply`,
o comando somente verifica se a migração está pendente.

## Tela única de despesas e permissões por ação

A tela `/manutencao-plantao` reúne cadastro, conferência e controles financeiros.
Qualquer uma das permissões de despesas permite consultar os lançamentos,
status, comprovantes e histórico. `conferencia-manutencao` permite somente
conferir; pagamentos, lançamento no ERP e reembolsos exigem, respectivamente,
`pagamento-despesas`, `lancamento-despesas` e `reembolso-despesas`.
O cadastro continua em `manutencao-plantao`, com edição dos próprios registros
pendentes. Administradores podem editar registros pendentes de outros autores.
Despesas conferidas ou pagas continuam bloqueadas para edição/exclusão.
O perfil motorista não pode executar ações de conferência ou financeiras.

Aplique `node scripts/apply-expense-permissions.mjs --apply` antes de iniciar
a API atualizada. Sem `--apply`, o comando apenas verifica a migração 079.
As novas permissões iniciam desativadas: conceda cada responsabilidade no
cadastro de usuários. Administradores mantêm acesso integral. Para uma pessoa
que só confere, habilite apenas “Despesas — conferir”; os status financeiros
continuam visíveis. URLs antigas de conferência abrem a mesma tela.

## Responsável das cargas e controle de reembolsos

As migrações `077_cargas_responsavel.sql` e `078_plantao_reembolso.sql` acrescentam
campos sem alterar vendedores ou conferências históricas. Aplicação isolada:
`node scripts/apply-client-improvements.mjs --apply` (sem `--apply`, apenas consulta).

Cargas novas e editadas exigem um responsável ativo de `financeiro.responsaveis`.
A API valida código e empresa e guarda o nome retornado pelo ERP. O cadastro de
clientes usa `responsavelcli` para sugerir o responsável. Cargas antigas sem vínculo
permanecem sem responsável até serem revisadas; o vendedor não é convertido automaticamente.

Na gestão de despesas, Pagamentos, Conferência e Reembolsos têm abas próprias.
Novos pagamentos não confirmam a conferência; despesas pagas continuam bloqueadas
para edição/exclusão. Reembolsos são controles locais, auditados e protegidos por
revisão: a cobrar, cobrado ou recebido, com cliente, documento e data de recebimento.
Descargas antigas com previsão de reembolso aparecem como a cobrar. Não há criação
automática de CT-e nem baixa no ERP. O CSV exporta as despesas dos filtros da tela,
incluindo viagem, placa, período, fornecedor, cliente e controles financeiros.

## Resumo de manifestos no n8n

O workflow de manifestos em aberto usa `America/Sao_Paulo`, segunda a sexta às
16h (`0 16 * * 1-5`), e os dois destinatários configurados em
`scripts/manifestos-message-code.js`. O resumo mantém número, placa e data de
autorização, não envia listas vazias e evita repetir o envio no mesmo dia.
`node scripts/update-manifestos-schedule.mjs` apenas consulta e mostra a prévia;
`--apply` atualiza e publica o workflow existente. Chaves do n8n e do WhatsApp
continuam em variáveis de ambiente. O script de criação recusa duplicar um
workflow de manifestos já existente.

## Volumes e itinerário de conferência

A migração `071_carga_volumes.sql` adiciona volumes inteiros opcionais à carga e
às paradas. `NULL` representa quantidade não informada, diferente de zero.
A soma das entregas adicionais e a soma das coletas adicionais não podem exceder,
cada uma, o total da carga. A entrega e a coleta principais recebem seus respectivos
saldos no itinerário; se faltar uma quantidade, o saldo fica a distribuir.
O itinerário permite ordenar paradas para a impressão e apresenta apenas dados
operacionais, com campos manuais para contagem e assinaturas. A ordem escolhida
vale para a impressão atual; não modifica a programação da viagem.

## Documento ERP da viagem

A migração `070_viagem_documento_erp.sql` adiciona a referência do documento da
impressão em `viagens_v2.documento_erp`. Frota consulta `logistica.controleviagens`;
terceiros consultam `logistica.cartasfretes`. A pesquisa restringe pela placa da
viagem e aceita número e data opcionais, com paginação. Ao salvar, o servidor
confere novamente tipo, empresa, série, número e placa no ERP. O mesmo documento
pode ser usado em várias viagens locais. Alterar a placa ou o tipo de propriedade
limpa o vínculo. Nenhum documento do ERP é criado ou alterado por essa operação.
As cargas recebem a referência da viagem vinculada para impressão.

## Histórico de cargas e desempenho da tela

A migração `069_quitacao_historico_cargas.sql` encerra somente cargas com
`legado_id`, data anterior a `2026-08-01` e status `aguardando_cte`. A quitação
histórica fica registrada em `dados_legados.quitacao_historica`, com motivo,
data e status anterior. Ela não cria títulos nem baixas no ERP e não é copiada
ao duplicar cargas. Viagens mistas só são encerradas se todas as cargas estiverem
entregues. A tela identifica esse caso como “Quitação histórica · planilha”.

Para conferir o alcance: `node scripts/settle-historical-loads.mjs`.
Para aplicar exclusivamente essa migração: acrescente `--apply`. A execução é
transacional, registra checksum em `schema_migrations` e pode ser repetida.

As consultas financeiras buscam recebimentos apenas dos títulos envolvidos.
Resultados iguais compartilham consultas em andamento e cache de até 60 segundos;
resumo e filtros usam até 30 segundos. Gravações do módulo invalidam os caches.
A sincronização de entregas acontece em segundo plano, e a tela visível atualiza
a cada minuto. A lista é exibida independentemente do carregamento do resumo.

Validação SQL isolada: `$env:CARGAS_WORKFLOW_DB_TEST='1'; node --test test/cargasHistorical.test.js test/cargasViagensV2Workflow.test.js`.

## Identificação de documentos e entregas de cargas

A migração `068_carga_documentos_identidade_erp.sql` acrescenta empresa e série
aos documentos das cargas, sem alterar os vínculos existentes. Aplique-a antes
de iniciar o backend atualizado e publique o frontend correspondente. Atualize
as abas abertas para que novas seleções enviem a identificação completa.

A entrega automática da tela Cargas/Viagens V2 exige a baixa/encerramento dos
manifestos vinculados a todos os CT-es da carga: status 7 (ENCERRADO) e
`datahoraencerramentomdf` válida, não futura, posterior à emissão do CT-e e à
autorização do manifesto, com placa correspondente. Manifestos cancelados não
confirmam entrega; se houver manifesto aberto, a carga permanece em trânsito.
Datas do CT-e, previsões e encerramento parcial não concluem a entrega.
Documentos ou orçamentos sem vínculo com manifesto permanecem pendentes.

A identificação usa chave ou empresa/série/número. Vínculos antigos sem esses
dados só usam o número quando há uma correspondência única (e placa coincidente
na entrega automática). Uma chave conhecida nunca recorre ao número para
encontrar outro documento. Ambiguidade financeira aparece como “Revisar”.
Cargas já marcadas como entregues não são reabertas por esta migração:
precisam de conferência dos documentos antes de qualquer correção histórica.

Validação da migração em tabelas temporárias, sem alterar dados
operacionais: `$env:CARGAS_DOCUMENTS_DB_TEST='1'; node --test test/cargasViagensV2Migration.test.js`.

## Nota de abastecimento e quilometragem

A migração `060_plantao_dados_nota_telemetria.sql` preserva o combustível e o cliente
identificados na nota, além da data da leitura de KM. O endpoint de hodômetro do
portal exige `date` e `time` e consulta a última leitura anterior ou igual ao horário
da nota, no mesmo dia em America/Sao_Paulo, sem usar o último abastecimento do ERP.
No cadastro de abastecimentos, a API consulta novamente a telemetria e não confia
no KM enviado pelo navegador. Edições mantêm a leitura original quando placa, data
e horário não mudam. Sem leitura anterior nesse dia, retorna 422. As fotos antigas
de painel e bomba continuam preservadas; novos
anexos do assistente usam a nota. Os dados do OCR são sugestões revisáveis, com
cliente/destinatário separado do fornecedor/emitente e litros de ARLA separados.

A migração `061_plantao_fluxo_conferencia.sql` adiciona horário da nota, perfil do
autor e justificativa sem nota. O perfil vem da sessão autenticada e permanece
inalterado nas edições; registros antigos ficam com perfil não registrado.
Cadastro, edição e conferência exigem imagem da nota ou justificativa de pelo
menos 10 caracteres. Pagamento e conferência são independentes; o portal destaca
despesas pagas ainda não conferidas. Não há devolução para correção.

Rascunhos são guardados no navegador por usuário, formulário e versão do registro,
incluindo a imagem anexada. São removidos após salvar ou descartar; falhas de
armazenamento mostram um aviso. Não são sincronizados entre aparelhos.

## Despesas por perfil de usuário

A migração `059_usuarios_motorista_telemetria.sql` adiciona os perfis Colaborador e
Motorista ao cadastro de usuários. Contas existentes continuam como Colaborador.
O administrador vincula cada conta de motorista ao identificador enviado nas
mensagens da telemetria; o código interno de `rodobach.motoristas` não é equivalente.
Cada identificador pode pertencer a uma única conta. Não são criadas contas ou
senhas automaticamente. Motoristas não podem ter acesso de administrador ou
conferência neste perfil.

A placa acompanha a identificação mais recente na telemetria, desde que o veículo
ainda tenha esse motorista, sem vínculos simultâneos conflitantes e com identificação
nos últimos sete dias. Ausência, conflito, dados antigos ou falha na consulta bloqueiam
novos lançamentos; não liberam outras placas. A API revalida a placa ao criar/editar
e nas consultas de localização e hodômetro. O histórico próprio continua disponível
após uma troca de veículo; correções de despesas da placa anterior ficam a cargo
da conferência. Colaboradores continuam selecionando qualquer placa cadastrada.

## Controle de custos de plantão

A migração `050_plantao_controle_custos.sql` adiciona data da despesa, número do
comprovante, revisão e histórico de alterações. Para registros anteriores, a
data inicial é a data do cadastro no fuso `America/Sao_Paulo`.

Motoristas podem editar/excluir seus próprios lançamentos pendentes. Conferentes
podem editar/excluir pendentes da frota pela rota de conferência. A exclusão exige
motivo e preserva os dados; lançamentos conferidos ficam bloqueados. Edição,
exclusão e conferência exigem a `version` recebida na consulta, evitando alterações
baseadas em uma lista desatualizada. O histórico registra autor, antes e depois.

A API bloqueia registros ativos com placa, data, valor, serviço e fornecedor
iguais, ou comprovante e fornecedor iguais. As gravações são serializadas para
evitar duplicação por envios simultâneos. Isso não concilia pagamentos do ERP:
conferido indica revisão, não pagamento ou reembolso.

Validação em schema temporário, removido ao final:
`$env:PLANTAO_DB_TEST='1'; node --test test/plantaoCostsDatabase.test.js`

## Atualizações operacionais e manutenção

As migrações `045_painel_carga_confirmacoes.sql` e `046_manutencao_auditoria.sql`
precisam estar aplicadas no banco da aplicação para os novos históricos.

O agendamento da manutenção foi migrado para o n8n em 06/11/2026.
Workflow: `hhjl1q5uyxov5kZI`, diariamente às 08:00 em `America/Sao_Paulo`.
**Permanece desativado enquanto os vencimentos são atualizados.**

O n8n chama `POST /api/integracoes/n8n/manutencao` na API hospedada.
O endpoint exige credencial Bearer exclusiva, cujo hash e destinatário ficam em
`manutencao_n8n_integracao` (migração 085). O segredo fica nas credenciais do n8n.
Não utiliza a sessão de um usuário nem depende de caminhos do Windows.
A função original preserva mensagem, dados do veículo, fonte do KM, destinatários,
componentes, auditoria e proteção contra duplicidade.

Antes de ativar: publicar este backend, confirmar o endpoint com `dryRun: true`,
atualizar os vencimentos e obter autorização para retomar os envios.
O fluxo em produção usa `dryRun: false`, timeout de 5 minutos e sem repetição
HTTP automática. Erros e resultados parciais falham a execução do n8n; não há
aviso externo de falha configurado neste fluxo. Consultar execuções e auditoria.

O mesmo marco/tipo/destinatário não é reenviado. Tentativas inconclusivas ficam
bloqueadas para conferência. Não modificar isso para forçar reenvios.

A tarefa Windows `Rodobach-Manutencao-0800` foi removida com backup local.
Os scripts diários e o worker de manutenção foram removidos. A única opção de
terminal restante é `npm run maintenance:preview`, que nunca envia mensagens.
Backups do fluxo antigo e da tarefa estão em `.local-logs/`, fora do Git.

API Node.js/Express para alimentar as telas ativas do front:

- Simulador de Frete ANTT
- Viagens e Cotacoes
- Custos
- Receita

## Requisitos

- Node.js instalado
- Acesso ao PostgreSQL configurado no arquivo `.env`

## Comandos

Instalar dependencias:

```powershell
npm install
```

Criar/atualizar as tabelas do banco usando os SQLs da pasta `sql`:

```powershell
npm run db:init
```

Subir a API local:

```powershell
npm run dev
```

A API sobe em:

```text
http://localhost:3333/api
```

## Endpoints principais

```text
GET    /api/health
GET    /api/frete/antt
GET    /api/motoristas/diarias
POST   /api/frete/calcular
GET    /api/viagens
GET    /api/viagens/:id
POST   /api/viagens
PUT    /api/viagens/:id
DELETE /api/viagens/:id
GET    /api/financeiro/resumo
```

## Observacao sobre o SQL 004

O arquivo `sql/004_analise_clientes.sql` contem consultas parametrizadas para tabelas externas (`logistica.conhecimentos` e `gerais.clientes`). Ele nao e executado como migracao automatica.
# Atualização automática da tabela ANTT

Aplicar `052_antt_monitor.sql` antes de reiniciar a API ou o worker. O monitor
inicia junto com a API/worker, consulta o ANTTlegis a cada 24 horas e tenta
novamente após uma hora se a consulta falhar. `ANTT_SYNC_ENABLED=false` desativa
o agendamento; `READ_ONLY_MODE=true` impede gravações. Não depende de
`RUN_SCHEDULERS` e não envia mensagens externas. A API/worker precisa permanecer
em execução; ao reiniciar, recupera a agenda pela última execução no banco.

Consulta avulsa: `npm run antt:sync -- --force`. Sem `--force`, respeita o intervalo.
A trava PostgreSQL impede execuções concorrentes entre instâncias.

Fontes: índices oficiais de portarias e publicações recentes do ANTTlegis e
referências da Resolução 5.867/2020 consolidada. Não há dependência de buscas na web
ou de interpretação por IA durante a execução. O leitor valida título, data do
DOU, regra de vigência, eixos, unidades e os dez coeficientes de carga geral das
tabelas A/C (3 a 7 eixos). Novos tipos de carga ou regras não reconhecidas exigem
adaptação do leitor. A automação depende da disponibilidade e atualização dos
índices oficiais; não promete detecção instantânea de publicações.

Coeficientes incompletos, datas ambíguas, alterações na mesma vigência e variações
acima de 20% são retidos para revisão. A calculadora mostra a última verificação e
um aviso quando a validação falha ou a última confirmação supera 26 horas.
Consulte `antt_monitor_execucoes` para motivo e dados candidatos; valide a
publicação original antes de inserir uma migração revisada. Não marque execuções
como bem-sucedidas nem contorne a validação para esconder avisos.

`antt_publicacoes` preserva fonte, título, coeficientes, vigência e hashes do conteúdo.
`antt_tabela` preserva as versões anteriores. A publicação inteira é gravada em
uma transação. Tarifas futuras são selecionadas somente a partir da vigência,
considerando America/Sao_Paulo. A calculadora e os alertas consultam a mesma tabela;
não existe mais reserva de coeficientes manual no frontend ou na tabela legada.
Na indisponibilidade do banco, o cálculo fica indisponível, sem assumir valores antigos.
