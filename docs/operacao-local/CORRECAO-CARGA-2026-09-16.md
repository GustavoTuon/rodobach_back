# Confirmação manual de carga no Painel TV

## Uso

Botão **Corrigir carga**, ao lado de **Atualizar agora**, disponível a administradores fora do modo de consulta. Veículos com carga a conferir aparecem primeiro. São obrigatórios: veículo, carregado/vazio, data e hora, motivo (5–500 caracteres). Para vazio, o horário informado representa o término da descarga e inicia a contagem do tempo vazio.

O cartão identifica o usuário e a validade da confirmação. O formulário permite consultar as últimas 50 confirmações do veículo e desfazer a confirmação ativa. O histórico é preservado; desfazer não reativa confirmações anteriores.

## Validade e alcance

- Prazo máximo: 24 horas após salvar. A confirmação só é aplicada quando o identificador da operação permanece igual ao registrado. Esse identificador inclui documento, viagem, carga, emissão/saída/entrega, estado automático e SM. Atualização de posição GPS não o altera.
- O salvamento consulta novamente o painel e rejeita com 409 se a operação divergir daquela vista pelo operador.
- Confirmação atua apenas no Painel TV. Não modifica ERP, documentos, classificação de outras telas ou automações de envio.
- Estado automático é preservado no retorno para rastreabilidade. Ao confirmar vazio, o destino anterior não é apresentado como próxima entrega.
- Histórico registra usuário, criação, horário confirmado, motivo, validade e usuário/horário de cancelamento. Atualizações e cancelamentos exigem administrador; o bloqueio de escrita para modo consulta continua aplicado pelo middleware global.

## Banco e implantação

Migração `rodobach_back/sql/045_painel_carga_confirmacoes.sql`: tabela dedicada e índice por placa/ID. Foi executado somente esse DDL, em transação, no banco configurado da aplicação. Nenhuma confirmação real ou fictícia foi inserida; tabela estava vazia ao validar.

Outros ambientes precisam aplicar essa migração antes de usar o botão. Sem a tabela, o painel permanece disponível e o botão fica desabilitado. Frontend e backend precisam ser publicados juntos. TLS, credenciais e permissões do PostgreSQL não foram alterados.

## Validação

Suíte backend: 129 aprovados, 2 desabilitados; depois foi acrescentado teste específico de acesso administrativo, e os 11 testes de segurança passaram. Frontend: 45 testes aprovados antes do último teste de visibilidade do botão. Lint sem erros, build aprovado. Testes de formulário usam API simulada; não foram enviados alertas nem registradas cargas de teste.

Validação final dos três arquivos de testes do painel/formulário/modelo: 9 testes aprovados, incluindo visibilidade por perfil e expiração no navegador mesmo com API indisponível. Lint e build repetidos após o ajuste de expiração, aprovados.
