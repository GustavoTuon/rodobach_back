# Rodobach Backend

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

Para alertas diários, configure `MAINTENANCE_ALERT_NUMBER` com o destinatário
exclusivo e `MAINTENANCE_DAILY_TIME=08:00`. Agende `node scripts/maintenance-daily.mjs`
diariamente às 08:00 em `America/Sao_Paulo`, com o diretório de trabalho na raiz
do backend. O script verifica se o fluxo antigo de manutenção no n8n está inativo
antes de enviar. Não execute junto com o worker de manutenção de dez minutos.

A consulta é diária, mas o mesmo alerta não é reenviado a cada dia: o histórico
é consultado por plano/componente, marco, tipo (próximo ou vencido) e destinatário.
Registros antigos com sufixo de data também impedem repetição. Um novo marco ou
a passagem de próximo para vencido permite um novo aviso. Tentativas inconclusivas
ficam bloqueadas para conferência; falhas definitivas podem ser tentadas novamente.

O agendamento do Windows, contatos no banco e valores de `.env` são configurações
do ambiente e não são instalados pelo Git. No Windows, o script
`scripts/maintenance-daily.ps1` pode ser usado pelo Agendador de Tarefas.
Falhas tentam notificar o mesmo destinatário; se o WhatsApp também falhar, consulte
`.local-logs/maintenance-daily.jsonl`. Logs, credenciais e backups locais não são
versionados.

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
