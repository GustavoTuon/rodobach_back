const plate=value=>String(value||'').replace(/[^A-Z0-9]/gi,'').toUpperCase();
export function activeRodobachPlates(sms=[]) {
 return [...new Set(sms.filter(sm=>!sm.fim&&String(sm.statusCodigo)==='1'
  && /^RODOBACH(?:\s|$)/i.test(String(sm.transportador||'').trim()))
  .map(sm=>plate(sm.placa)).filter(p=>/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p)))];
}
