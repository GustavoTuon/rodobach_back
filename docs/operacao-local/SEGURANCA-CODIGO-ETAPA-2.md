# Segurança no código — etapa 2

## Correções aplicadas

- API envia `Cache-Control: no-store`, inclusive no login e nos erros, para impedir armazenamento das respostas por caches compatíveis. O cache interno da DRE continua funcionando.
- Logs HTTP guardam método, caminho sem parâmetros, identificador e status. Headers, cookies e conteúdo das respostas não são registrados pelo logger HTTP.
- Erros estruturados registrados pelo logger guardam tipo/código/status, omitindo mensagem, stack e detalhes que podem conter SQL, valores e credenciais. Isso reduz o detalhe disponível para diagnóstico.
- Identificadores das requisições são gerados pela API, sem confiar no valor enviado pelo cliente.
- Tentativas de alteração de usuários autenticados negadas por permissão ou modo de consulta também entram no registro de auditoria.

## Validação

- Suíte backend: 111 testes aprovados e 2 desabilitados antes da inclusão do último teste de auditoria.
- Arquivo `test/httpPrivacy.test.js`: 3 testes aprovados, incluindo logs, cache e alteração negada sem escrita no banco.
- Lint backend: nenhum erro; 15 avisos preexistentes.
- Os testes usam dados sintéticos e simulação da consulta de autenticação; não inserem dados de negócio.

## Implantação e pendências

As alterações estão locais e precisam ser publicadas pelo fluxo habitual do backend. Não exigem migração nem novas variáveis de ambiente. Configuração de TLS, credenciais e permissões do PostgreSQL foi adiada a pedido do usuário. Cookies HttpOnly, revogação persistente no logout e retenção central de auditoria permanecem pendentes.
