# Monitor de rotas Trafegus

Consulta as Solicitações de Monitoramento (SMs) do Elite OP, detecta criação ou
alteração de rota e envia ao motorista o `link_rota` oficial pelo WhatsApp.

## Segurança

- Credenciais ficam somente no `.env`.
- `DRY_RUN=true` é o padrão e impede mensagens reais.
- A primeira execução cria um baseline; SMs e alterações antigas não são enviadas.
- O estado local fica em `data/state.json`.

## Configuração

```powershell
Copy-Item .env.example .env
npm install
```

Preencha no `.env`:

```env
TRAFEGUS_USER=
TRAFEGUS_PASSWORD=
CLIENT_DB_HOST=
CLIENT_DB_NAME=
CLIENT_DB_USER=
CLIENT_DB_PASSWORD=
EVOLUTION_API_URL=
EVOLUTION_API_KEY=
EVOLUTION_INSTANCE_NAME=rodobach
DRY_RUN=true
```

Esta copia esta arquivada dentro do repositorio do backend. Configure todas as
variaveis no `.env` desta pasta. O caminho opcional `../rodobach_back/.env`
corresponde a estrutura original, com os projetos lado a lado.

O celular é localizado primeiro pelo CPF do motorista informado na SM e, como
alternativa, pelo motorista atualmente vinculado à placa no TMS.

## Execução

```powershell
npm start
```

Endpoints locais:

- `GET /health`: estado da última consulta.
- `POST /run`: força uma consulta imediata.

Depois de validar os logs e os telefones, altere `DRY_RUN=false` para habilitar
o envio real.

## Como uma mudança é identificada

O monitor combina duas fontes autenticadas do Elite OP:

- `/solicitacaomonitoramento/getjsondata`
- `/relatorioalteracaorotasviagem/getjsondata`

Assim, uma mudança de rota é detectada mesmo quando o endereço do `link_rota`
permanece igual. A consulta acompanha a página de registros mais recentes, sem
varrer todo o histórico do portal a cada minuto.
