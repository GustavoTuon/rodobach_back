export function maintenanceWorkflow({url,credential}) {
  if(!/^https:\/\//.test(url))throw new Error('Use a URL HTTPS da API hospedada.');
  return {
    name:'Manutenção · alertas às 08h (API Rodobach)',
    nodes:[
      {id:'maintenance-schedule',name:'Todos os dias às 08h',type:'n8n-nodes-base.scheduleTrigger',typeVersion:1.3,position:[0,0],parameters:{rule:{interval:[{field:'cronExpression',expression:'0 8 * * *'}]}}},
      {id:'maintenance-call',name:'Executar manutenção na API',type:'n8n-nodes-base.httpRequest',typeVersion:4.4,position:[280,0],retryOnFail:false,parameters:{method:'POST',url,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,specifyBody:'json',jsonBody:JSON.stringify({dryRun:false}),options:{timeout:300000}},credentials:{httpHeaderAuth:credential}},
      {id:'maintenance-result',name:'Conferir resultado',type:'n8n-nodes-base.code',typeVersion:2,position:[560,0],parameters:{jsCode:"const r=$input.first().json; if(r.ok!==true || r.falhas>0 || r.dryRun!==false) throw new Error('Execução de manutenção não concluída. Consulte a auditoria do sistema antes de repetir.'); return [{json:r}];"}},
      {id:'maintenance-note',name:'Orientações',type:'n8n-nodes-base.stickyNote',typeVersion:1,position:[0,-300],parameters:{width:840,height:250,content:'## Manutenção — manter DESATIVADO\nAguardar a atualização dos vencimentos e a publicação da integração no backend.\n\nAgendamento: 08h, America/Sao_Paulo. A API hospedada monta a mesma mensagem com placa, serviço, KM/data, fonte do KM, situação, destino, cliente, localização/mapa e ação recomendada. Preserva destinatários e histórico.\n\nSem repetição automática de pedidos HTTP: conferir a auditoria antes de reenviar falhas ou resultados inconclusivos. O mesmo marco/tipo/destinatário não é reenviado. Nenhum gatilho depende do Windows.'}},
    ],
    connections:{'Todos os dias às 08h':{main:[[{node:'Executar manutenção na API',type:'main',index:0}]]},'Executar manutenção na API':{main:[[{node:'Conferir resultado',type:'main',index:0}]]}},
    settings:{executionOrder:'v1',timezone:'America/Sao_Paulo',saveDataErrorExecution:'all',saveDataSuccessExecution:'all',saveManualExecutions:true,executionTimeout:360},
  };
}
