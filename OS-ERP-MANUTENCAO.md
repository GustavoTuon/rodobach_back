# Sincronização de troca de óleo da OS externa

Aplicar `092_manutencao_os_erp.sql` antes de iniciar a API. A API consulta o ERP
a cada cinco minutos e imediatamente antes do envio real dos alertas de manutenção.
A sincronização não envia mensagens. O agendamento de mensagens continua no n8n.
Falha de sincronização interrompe o envio, evitando usar vencimentos desatualizados.
Prévias de alertas não importam OS nem alteram dados.

A primeira execução cria uma linha de base de todas as OS já existentes, sem
alterar manutenções. Somente novas chaves de OS após essa execução são importadas.
Chave composta: empresa, série, número e fornecedor. OS antigas editadas não são
importadas; corrigir esses casos manualmente. OS novas incompletas são reavaliadas.

Exige serviço explicitamente descrito como troca de óleo (inclusive “TROCAR ÓLEO”),
placa, data não futura e KM positivo. Não considera compra de óleo, complemento,
filtro, óleo de câmbio/diferencial ou serviços genéricos de revisão como troca do motor.
Exige plano ativo por KM cujo título identifique troca de óleo na mesma placa.
Planos chamados apenas “Revisão Volvo”, por exemplo, precisam de identificação
explícita para entrar nesta rotina. OS com troca para múltiplas placas fica pendente,
pois o ERP fornece apenas um KM no cabeçalho. Não presume troca dos filtros.

Grava histórico com referência à OS e usuário de auditoria `integracao-os-erp`;
recalcula próximo KM como KM do serviço + intervalo cadastrado, mantendo o odômetro
atual e protegendo contra datas/KMs inferiores aos da última manutenção.
Registro e confirmação de importação estão na mesma transação; trava de banco
impede duplicação entre instâncias. Correções de OS já importadas exigem revisão
manual, para não substituir silenciosamente manutenção já registrada.

Consultar `manutencao_os_erp` para estados, motivos de pendência e IDs de histórico;
`manutencao_os_erp_estado` guarda início e última execução bem-sucedida. Erros ficam
no log da API. `MAINTENANCE_ERP_SYNC_ENABLED=false` desliga a varredura periódica;
a atualização antes dos alertas permanece obrigatória. Ambiente read-only não grava.
