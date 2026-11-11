# Alertas de manutenção — n8n

Desde 06/11/2026 o agendamento é exclusivo do n8n, workflow `hhjl1q5uyxov5kZI`.
O fluxo foi **ativado em 10/11/2026**, após confirmação do responsável de que
os vencimentos estão atualizados e validação da integração hospedada com
`dryRun: true` pelo n8n. Não iniciar workers locais.

A tarefa Windows e os comandos locais de envio foram removidos.
Para consulta sem envio: `npm run maintenance:preview`.

O n8n chama a API hospedada às 08h de Brasília usando credencial exclusiva.
A API mantém o cálculo, a mensagem e a auditoria, com destino no grupo abaixo.
Leia a seção de manutenção do README para os requisitos antes da ativação.

## Destinatário em grupo — 10/11/2026

O destinatário da integração foi alterado para o grupo **Manutenção Rodobach**
(`120363432436763201@g.us`), localizado na instância Evolution configurada.
O identificador completo deve ser preservado no envio e na auditoria.
O responsável confirmou a publicação do suporte a grupos no backend hospedado.
A validação pelo n8n retornou `ok: true`, `dryRun: true` e nenhuma falha.
Foi enviada uma mensagem de teste e, depois, sete alertas vencidos em cinco
veículos, conforme autorização. Os sete alertas foram aceitos pelo provedor
e registrados na auditoria; o retorno `PENDING` não confirma entrega.
O workflow está ativo com cron `0 8 * * *` e fuso `America/Sao_Paulo`.
