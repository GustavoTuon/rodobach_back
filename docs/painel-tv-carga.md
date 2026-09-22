# Carga no painel TV

## Instalação e fontes

Aplicar `sql/047_painel_vazio_ate_documento.sql` antes de usar confirmações de vazio
sem vencimento. O script `scripts/apply-empty-confirmation.mjs` aplica somente essa
migração e registra seu checksum.

Terceiros com SM ativa da Rodobach aparecem após a frota, em roxo. A localização
e os quilômetros diários dos terceiros vêm da Elite; a frota mantém a telemetria.
O relatório Elite é filtrado por veículo e dia, inclui movimento com e sem viagem
e tem cache de um minuto. Ausência de dados válidos não é tratada como zero.

O destino da SM e a próxima parada prevista são exibidos juntos. Uma previsão de
entrega não comprova descarga. O retorno vazio à base exige as evidências da SM,
da sequência de entregas e da operação anterior; o destino isolado não basta.

Veículos na base ficam azuis. O modo de seis cartões aumenta as informações e o
modo de nove ajusta o conteúdo à altura disponível em tela cheia.

## Evidências de carga

O painel apresenta Carregado ou Vazio. Sem referência suficiente, apresenta um
travessão e solicita a primeira confirmação em Corrigir carga. A observação
“Confirmação pendente” identifica referências que não comprovam a situação atual.

- Documentos válidos são agrupados pela empresa e viagem da operação mais recente.
  Uma entrega parcial não encerra a carga. Data futura de entrega permanece pendente.
- Todas as entregas efetivas registradas encerram a operação; o tempo vazio parte da última.
  Sem agrupamento conhecido, o resultado exige confirmação e não conta tempo vazio.
- Uma SM posterior à última entrega efetiva não comprova novo carregamento. Sem
  outra evidência, mostra-se travessão com confirmação pendente, sem contador vazio.
- SM iniciada e sem encerramento só informa carga por si quando o tipo indica
  explicitamente Carregado ou Vazio. Destino e previsão de fim não provam carga.
- Chegada à cidade, ausência de SM e tempo estimado de descarga não tornam vazio
  um veículo com documentos pendentes. Documentos com mais de 21 dias requerem
  confirmação; frete de terceiro sem confirmação de carga também.
- Confirmação manual de carregado vale até a data escolhida ou mudança de contexto.
  Vazio não exige data final: permanece até o próximo documento de carga, com o
  contador partindo da data e hora da descarga informadas pelo operador.

O painel consulta a API a cada minuto. A leitura compartilhada de documentos passou
a usar `dataentregacon` como entrega efetiva. `datahoraentregacon` é mantido apenas
como referência suspeita: na auditoria, 43 de 45 documentos recentes tinham esse
campo coincidindo com a previsão. Vencer essa data não encerra a carga. Não há
alteração dos registros no ERP. A ligação entre documentos usa empresa/viagem.

As macros vêm da telemetria já importada, dos últimos 30 dias (até 500 mensagens por
cadastro de veículo). Eventos anteriores à emissão mais recente, ao início da viagem,
à entrega efetiva ou ao início da SM atual são exibidos como históricos. O painel
usa esses eventos como evidência; os detalhes de macros ficam fora do cartão TV.
Falha de consulta é distinguida de ausência de macros.

Somente títulos explícitos de carregamento concluído/início carregado ou veículo
vazio/última descarga concluída confirmam o estado. Texto livre não é interpretado.
Chegada ao cliente, fim de viagem e fim de descarga sem indicação de última entrega
pedem confirmação, sem declarar vazio. Eventos futuros e reenvios são descartados;
macros simultâneas contraditórias não decidem o estado. Confirmações com mais de
24 horas permanecem como referência pendente. Confirmação manual tem prioridade
enquanto válida, e uma nova macro explícita invalida seu contexto anterior.

Validação em 22/09/2026: RYI6H21 tem início de viagem carregado em 21/09 às 18h03 e
chegada ao destino às 23h00, sem última descarga confirmada. RYP7D29, RAA8G58 e
SXR8D09 têm fim de viagem recente, sem confirmação de veículo vazio. RAA8G18 não
tem macro posterior ao início da SM 519194 e não pode ficar vazio por previsão vencida.
