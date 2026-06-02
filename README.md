# Rodobach Backend

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
