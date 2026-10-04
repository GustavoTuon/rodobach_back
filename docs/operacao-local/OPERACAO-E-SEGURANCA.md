# Operação e segurança

## Segredos

- Copie os arquivos `.env.example` para `.env`; nunca versione os `.env`.
- `JWT_SECRET` é obrigatório em produção e deve ter pelo menos 32 caracteres.
- O administrador inicial só é criado com `BOOTSTRAP_ADMIN_LOGIN`, `BOOTSTRAP_ADMIN_PASSWORD` e `BOOTSTRAP_ADMIN_EMAIL`. Remova essas variáveis depois do primeiro acesso.
- As credenciais anteriormente presentes no exemplo devem ser rotacionadas no PostgreSQL e em qualquer integração que as reutilize.

## Processos

- API: `npm start` dentro de `rodobach_back`.
- Worker de alertas de veículos vazios: `npm run worker`, em processo separado.
- Worker de manutenção: `npm run worker:maintenance`, iniciado separadamente e somente quando desejar habilitar os envios. Procedimento em [ALERTAS-MANUTENCAO.md](ALERTAS-MANUTENCAO.md).
- Frontend local: `npm run dev`; produção: `npm run build`.
- Monitor Trafegus: `npm start`; por padrão escuta apenas em `127.0.0.1`.

Execute apenas uma réplica do worker. Os jobs também usam locks consultivos na mesma conexão PostgreSQL para impedir processamento simultâneo acidental.

## Monitor Trafegus

`POST /run` exige `Authorization: Bearer <MONITOR_ADMIN_TOKEN>`, aplica intervalo mínimo de 30 segundos e reutiliza uma execução já em andamento. Em produção, o token deve ter ao menos 32 caracteres.

## Banco de dados

As migrações aplicadas são registradas em `schema_migrations`, incluindo checksum. Uma migração aplicada não deve ser alterada; crie um novo arquivo SQL.

No primeiro deploy sobre um banco que já contém todas as migrações antigas, execute uma única vez com `MIGRATIONS_BASELINE_EXISTING=true`. Depois volte a variável para `false`; em bancos novos ela deve permanecer `false` para executar o SQL.

## Verificações antes do deploy

```powershell
cd rodobach_back
npm test
npm run lint
npm audit --omit=dev

cd ../rodobach_front
npm test
npm run lint
npm run build

cd ../Api-trafegos
npm test
npm audit --omit=dev
```
