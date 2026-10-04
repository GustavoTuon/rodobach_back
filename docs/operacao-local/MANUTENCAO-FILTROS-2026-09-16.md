# Troca completa e filtros intermediários

Ao registrar uma troca de óleo do motor em `/manutencao/registros`, o backend renova os planos de filtros intermediários da mesma placa. A identificação considera títulos com “filtro” e “intermedi”, incluindo as variações cadastradas atualmente. Serviços de câmbio, diferencial, reposição/complemento e filtros isolados não acionam a regra; revisões genéricas não são presumidas como troca completa.

- Usa a data e o KM realizado do serviço, não o hodômetro atual do rastreador.
- Mantém o intervalo individual de cada plano: próximo marco = KM do serviço + intervalo do plano.
- Cria histórico vinculado ao plano intermediário, indicando o registro da troca completa que o originou, fornecedor e documento.
- Atualiza o marco utilizado pelos alertas existentes. Não envia mensagens durante o registro.
- Mantém o estado ativo/inativo de cada plano.
- Não recua referência com data ou KM mais recente. Também preserva uma referência inicial superior quando ainda não há histórico.
- Registros e atualização de marcos ficam na mesma transação, com bloqueio dos planos da placa; falha desfaz toda a operação.
- Não aceita plano vinculado a outra placa.

A tela de registro explica a regra e identifica troca de óleo do motor com filtros como serviço de óleo, em vez de classificá-la apenas como filtro.

Validação: 125 testes backend aprovados, 2 desabilitados; lint sem erros (15 avisos preexistentes no backend); build frontend aprovado. Testes de escrita usam banco simulado, sem inserir serviços reais ou enviar alertas.

Não há migração nem alteração de configuração do servidor. Registros históricos e dados existentes não foram modificados ou reprocessados. A regra entra em ação nos próximos registros feitos com esta versão. Código ainda não publicado.
