# Rodobach Backend

## Atualizações operacionais e manutenção

As migrações `045_painel_carga_confirmacoes.sql` e `046_manutencao_auditoria.sql`
precisam estar aplicadas no banco da aplicação para os novos históricos.

Para alertas diários, configure `MAINTENANCE_ALERT_NUMBER` com o destinatário
exclusivo e `MAINTENANCE_DAILY_TIME=08:00`. Agende `node scripts/maintenance-daily.mjs`
diariamente às 08:00 em `America/Sao_Paulo`, com o diretório de trabalho na raiz
do backend. O script verifica se o fluxo antigo de manutenção no n8n está inativo
antes de enviar. Não execute junto com o worker de manutenção de dez minutos.

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
