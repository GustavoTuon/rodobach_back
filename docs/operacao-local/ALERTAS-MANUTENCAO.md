# Alertas de manutenção

O backend é o único responsável pelos alertas de manutenção. O fluxo antigo
“Manutenção mensagem” do n8n deve permanecer desativado. Sua ativação e a
repetição de execuções pela tela de automações do Rodobach foram bloqueadas.

A API e o worker genérico não iniciam mais os alertas de manutenção. O processo
dedicado é iniciado explicitamente pelo comando abaixo. Nenhum envio foi
ativado durante esta preparação.

## Conferir os planos e iniciar o acompanhamento

Abra um terminal na pasta `rodobach_back` deste projeto.

1. Confira os planos selecionados, sem enviar mensagens:

   ```powershell
   npm run maintenance:preview -- --ids=IDS_DOS_PLANOS
   ```

2. Para enviar os avisos que continuarem vencidos nos planos selecionados:

   ```powershell
   npm run maintenance:send -- --ids=IDS_DOS_PLANOS
   ```

   A execução real consulta novamente os dados e ignora avisos já aceitos
   ou com resultado ainda incerto. A seleção manual não inclui componentes.

3. Para acompanhar automaticamente todos os planos ativos:

   ```powershell
   npm run worker:maintenance
   ```

   A primeira verificação acontece em dois minutos; as demais, a cada dez
   minutos. O comando verifica que o fluxo antigo do n8n está desativado antes
   de iniciar. Mantenha o computador ligado, conectado e sem suspensão, e o
   processo aberto. Para encerrar, use Ctrl+C; uma execução em andamento
   termina antes do encerramento. Abrir o localhost sozinho não inicia envios.

Também é possível iniciar somente o worker: ele inclui os vencidos na primeira
verificação. O envio manual inicial é opcional. Avisos já aceitos não se repetem
para o mesmo plano, destinatário, marco e tipo de alerta. O alerta antecipado e
o vencido são eventos distintos.

## Conferência

Na manutenção preventiva, abra “Auditoria e envios”. Confira data, destinatário,
mensagem, protocolo e resultado. “Aceito pelo serviço” não é confirmação de
entrega/leitura. Tentativas incertas não são reenviadas automaticamente; precisam
ser conferidas no provedor. Falhas definitivas podem ser tentadas novamente.

Enviar uma mensagem nunca muda o vencimento. Registrar uma troca atualiza a
referência. Editar o KM atual não avança o prazo; alterar o intervalo preserva
a referência anterior do serviço. Cada alteração é auditada.

## Servidor de produção

As alterações foram preparadas no projeto local. Para operar com o computador
desligado, publique esta versão no servidor, aplique a migração de auditoria com
`node scripts/apply-maintenance-audit.mjs` e configure um processo persistente
com `npm run worker:maintenance`, com reinício automático. Use as mesmas
configurações de banco, telemetria, ERP, WhatsApp e consulta do n8n do backend.
Não publique nem inicie o worker automaticamente antes do horário escolhido.

Execute uma instância desse worker. O lock no PostgreSQL e o histórico evitam
concorrência e reenvios em reinicializações. O workflow antigo também deve
permanecer desativado na interface direta do n8n.
