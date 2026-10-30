// Aggregate each endpoint separately so multiple CT-es never duplicate a manifest.
export const manifestosMessageQuery = `SELECT m.empresamdf empresa,m.seriemdf serie,m.codigomdf numero,
 m.veiculomdf placa,to_char(m.datahoraautorizacaomdf AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY') autorizado,
 COALESCE(loading.origem,delivery.origem) origem,
 COALESCE(TRIM(final_city.nomecid)||'-'||TRIM(final_state.abreviaturaest),
   CASE WHEN last_delivery.trip_count=1 AND last_delivery.doc_count=delivery.doc_count THEN last_delivery.destino END,
   CASE WHEN delivery.city_count=1 THEN delivery.destino END) destino,
 count(*) OVER()::int total
 FROM logistica.mdfe m
 LEFT JOIN localidades.cidades final_city ON final_city.codigocid=m.cidadeentregafinalmdf
 LEFT JOIN localidades.estados final_state ON final_state.codigoest=final_city.estadocid
 LEFT JOIN LATERAL (
   SELECT string_agg(DISTINCT TRIM(c.nomecid)||'-'||TRIM(e.abreviaturaest), ' / ' ORDER BY TRIM(c.nomecid)||'-'||TRIM(e.abreviaturaest)) origem
   FROM logistica.mdfecidadescarregamento l
   JOIN localidades.cidades c ON c.codigocid=l.cidademcc
   JOIN localidades.estados e ON e.codigoest=c.estadocid
   WHERE l.empresamcc=m.empresamdf AND l.seriemcc=m.seriemdf AND l.codigomcc=m.codigomdf
 ) loading ON true
 LEFT JOIN LATERAL (
   SELECT string_agg(DISTINCT TRIM(c.nomecid)||'-'||TRIM(e.abreviaturaest), ' / ' ORDER BY TRIM(c.nomecid)||'-'||TRIM(e.abreviaturaest)) destino,
     string_agg(DISTINCT TRIM(o.nomecid)||'-'||TRIM(oe.abreviaturaest), ' / ' ORDER BY TRIM(o.nomecid)||'-'||TRIM(oe.abreviaturaest)) origem,
     count(DISTINCT c.codigocid) city_count,count(*) doc_count
   FROM logistica.mdfeconhecimentos d
   JOIN logistica.conhecimentos k ON k.empresacon=d.empresaconhecimentomdc
     AND k.seriecon=d.serieconhecimentomdc AND k.codigocon=d.codigoconhecimentomdc
   LEFT JOIN localidades.cidades c ON c.codigocid=COALESCE(NULLIF(d.cidadeentregadiferentemdc,0),k.cidadeentregacon)
   LEFT JOIN localidades.estados e ON e.codigoest=c.estadocid
   LEFT JOIN localidades.cidades o ON o.codigocid=k.cidadecoletacon
   LEFT JOIN localidades.estados oe ON oe.codigoest=o.estadocid
   WHERE d.empresamdc=m.empresamdf AND d.seriemdc=m.seriemdf AND d.codigomdc=m.codigomdf
 ) delivery ON true
 LEFT JOIN LATERAL (
   SELECT (array_agg(TRIM(c.nomecid)||'-'||TRIM(e.abreviaturaest) ORDER BY f.sequenciacvf DESC))[1] destino,
     count(DISTINCT (f.empresacvf,f.codigocvf)) trip_count,
     count(DISTINCT (d.empresaconhecimentomdc,d.serieconhecimentomdc,d.codigoconhecimentomdc)) doc_count
   FROM logistica.mdfeconhecimentos d
   JOIN logistica.controleviagensfretes f ON f.empresaconhecimentocvf=d.empresaconhecimentomdc
     AND f.serieconhecimentocvf=d.serieconhecimentomdc AND f.conhecimentocvf=d.codigoconhecimentomdc
   JOIN logistica.conhecimentos k ON k.empresacon=d.empresaconhecimentomdc
     AND k.seriecon=d.serieconhecimentomdc AND k.codigocon=d.codigoconhecimentomdc
   LEFT JOIN localidades.cidades c ON c.codigocid=COALESCE(NULLIF(d.cidadeentregadiferentemdc,0),k.cidadeentregacon)
   LEFT JOIN localidades.estados e ON e.codigoest=c.estadocid
   WHERE d.empresamdc=m.empresamdf AND d.seriemdc=m.seriemdf AND d.codigomdc=m.codigomdf
     AND f.sequenciacvf IS NOT NULL
 ) last_delivery ON true
 WHERE m.statusmdf IN (3,5) AND m.datahoraencerramentomdf IS NULL AND m.datahoracancelamentomdf IS NULL
 ORDER BY m.datahoraautorizacaomdf ASC NULLS LAST,m.empresamdf,m.seriemdf,m.codigomdf LIMIT 30`;
