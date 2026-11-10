# Alertas de manutenção — n8n

Desde 06/11/2026 o agendamento é exclusivo do n8n, workflow `hhjl1q5uyxov5kZI`.
O fluxo permanece **desativado**, aguardando atualização dos vencimentos e
publicação da integração no backend hospedado. Não iniciar workers locais.

A tarefa Windows e os comandos locais de envio foram removidos.
Para consulta sem envio: `npm run maintenance:preview`.

O n8n chama a API hospedada às 08h de Brasília usando credencial exclusiva.
A API mantém o cálculo, a mensagem, o destinatário e a auditoria originais.
Leia a seção de manutenção do README para os requisitos antes da ativação.

## Destinatário em grupo — 10/11/2026

O destinatário da integração foi alterado para o grupo **Manutenção Rodobach**
(`120363432436763201@g.us`), localizado na instância Evolution configurada.
O identificador completo deve ser preservado no envio e na auditoria.
Antes da ativação, publicar o suporte a grupos de `whatsappRecipient.js`,
`whatsapp.js` e `manutencaoAlertaService.js` no backend hospedado, além de
concluir a revisão dos vencimentos indicada acima. Nenhuma mensagem de teste
foi enviada nesta configuração; o workflow permanece desativado.
