# Alerta de bateria 24 V

Piloto validado no RAA8G58; destinatário confirmado: +55 48 99950-3759.
O campo `bateria_carreta` apresentou 24–26 V desligado e 27–28 V ligado
no histórico consultado em 26/10/2026. Nesse período os valores eram inteiros.
Validar o circuito medido e a escala antes de incluir outro caminhão.

Regra operacional inicial: tensão de 16 a 24 V, ignição explicitamente
desligada, sem movimento ou RPM positivo; três leituras distintas abrangendo
pelo menos 10 minutos, intervalo máximo de 6 minutos e última leitura com
até 5 minutos. Dado ausente, inválido, futuro ou ignição desconhecida
interrompe a sequência. Todas as leituras abaixo de 23,5 V classificam o
evento como crítico. Um valor abaixo de 16 V exige investigação da medição,
não é considerado automaticamente bateria baixa de um sistema 24 V.

Consulta a cada minuto; no máximo um envio por nível/placa/destinatário a
cada 24 horas. Um alerta crítico pode ser enviado após um alerta baixo.
A auditoria PostgreSQL `bateria_alertas_envios` registra a intenção antes
do envio e usa lock para evitar concorrência. Status `aceito` significa
aceitação pelo provedor, não confirmação de entrega. Resultado `incerto`
também bloqueia repetição por 24 horas; conferir no provedor antes de agir.
O teste tem controle separado e contém apenas dados simulados.

Comandos na pasta do backend:

```powershell
node scripts/battery-alerts.mjs --init
node scripts/battery-alerts.mjs --preview
node scripts/battery-alerts.mjs --test
node scripts/battery-alerts.mjs --worker
```

`--init` cria apenas a tabela e seu índice. Configurações opcionais:
`BATTERY_ALERT_PLATE` e `BATTERY_ALERT_NUMBER`. Usa as conexões existentes
do backend para telemetria, banco de aplicação e Evolution WhatsApp.
Respeita `READ_ONLY_MODE`. Nenhum agendador genérico é alterado.

O processo local depende do computador ligado, conectado e sem suspensão.
Logs: `.local-logs/battery-worker.out.log` e `.local-logs/battery-worker.err.log`.
PID da execução iniciada: `.local-logs/battery-worker.pid` (verificar se ainda
corresponde ao processo antes de encerrar). Para execução contínua em servidor,
publicar o código, executar `--init` e supervisionar o comando `--worker`.

Referências consultadas em 26/10/2026:

- https://www.trojanbattery.com/resources/battery-maintenance — referência
  para chumbo-ácido: 25,46 V cheio e 24,20 V a 50%, somente em circuito aberto
  após repouso; não extrapolar porcentagem para telemetria sob carga.
- https://www.victronenergy.com/media/pg/BMV-700/en/all-features-and-settings.html
  — parâmetro de tensão carregada de 28 V para sistema nominal de 24 V;
  a determinação de carga também depende de corrente e duração.

Os limiares e tempos são escolhas operacionais do piloto, não especificação
do fabricante dos caminhões. A queda momentânea na partida é diferente da
tensão elevada durante a carga. Ajustar após validação com medição nos bornes.
