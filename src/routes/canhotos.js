import { Router } from "express";
import { clientPool } from "../db/clientPool.js";
import { pool } from "../db/pool.js";
import { tableName } from "../config.js";

export const canhotosRouter = Router();
const DATA_CORTE = "2026-07-01";

const digits = (value) => String(value || "").replace(/\D/g, "");
const text = (value, max = 120) => String(value || "").trim().slice(0, max);
const keyOf = (row) => [row.empresa, row.serieCte, row.numeroCte, row.sequenciaNota].join("|");

function isoDate(value, fallback) {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback;
}

canhotosRouter.get("/canhotos", async (req, res, next) => {
  try {
    const hoje = new Date();
    const inicioInformado = isoDate(req.query.inicio, DATA_CORTE);
    const inicio = inicioInformado < DATA_CORTE ? DATA_CORTE : inicioInformado;
    const fim = isoDate(req.query.fim, hoje.toISOString().slice(0, 10));
    const proprietario = ["frota", "terceiro"].includes(req.query.proprietario) ? req.query.proprietario : "todos";
    const status = ["pendente", "recebido"].includes(req.query.status) ? req.query.status : "todos";
    const busca = text(req.query.busca, 100);
    const motorista = text(req.query.motorista, 100);
    const cliente = text(req.query.cliente, 100);
    const placa = text(req.query.placa, 20).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const viagem = digits(req.query.viagem);
    const nota = digits(req.query.nota);
    const serie = text(req.query.serie, 20);
    const cte = digits(req.query.cte);
    const semViagem = String(req.query.semViagem || "").toLowerCase() === "true";

    const { rows } = await clientPool.query(`
      WITH veiculos AS (
        SELECT DISTINCT ON (UPPER(TRIM(v.placavei)))
          UPPER(TRIM(v.placavei)) AS placa_norm,
          v.tipopropriedadevei
        FROM frotas.veiculos v
        WHERE NULLIF(TRIM(v.placavei), '') IS NOT NULL
        ORDER BY UPPER(TRIM(v.placavei)), (v.tipopropriedadevei::text = 'P') DESC, v.empresavei
      ), motoristas_empresa AS (
        SELECT DISTINCT ON (m.empresamot, m.codigomot) m.empresamot, m.codigomot, m.nomemot
        FROM frotas.motoristas m ORDER BY m.empresamot, m.codigomot, m.ativomot DESC NULLS LAST
      ), motoristas_geral AS (
        SELECT DISTINCT ON (m.codigomot) m.codigomot, m.nomemot
        FROM frotas.motoristas m ORDER BY m.codigomot, m.ativomot DESC NULLS LAST, m.empresamot
      ), clientes_empresa AS (
        SELECT DISTINCT ON (c.empresacli, c.codigocli) c.empresacli, c.codigocli, c.nomecli, c.fantasiacli
        FROM gerais.clientes c ORDER BY c.empresacli, c.codigocli
      ), clientes_geral AS (
        SELECT DISTINCT ON (c.codigocli) c.codigocli, c.nomecli, c.fantasiacli
        FROM gerais.clientes c ORDER BY c.codigocli, c.empresacli
      ), chegada_motorista AS (
        SELECT cv.empresacvg, cv.motoristacvg, MAX(cv.datachegadacvg) AS ultima_chegada
        FROM logistica.controleviagens cv
        WHERE cv.motoristacvg IS NOT NULL
          AND cv.datachegadacvg > cv.datasaidacvg
          AND cv.datachegadacvg <= $2::date
        GROUP BY cv.empresacvg, cv.motoristacvg
      ), chegada_placa AS (
        SELECT UPPER(TRIM(cv.veiculocvg)) AS placa_norm, MAX(cv.datachegadacvg) AS ultima_chegada
        FROM logistica.controleviagens cv
        WHERE NULLIF(TRIM(cv.veiculocvg), '') IS NOT NULL
          AND cv.datachegadacvg > cv.datasaidacvg
          AND cv.datachegadacvg <= $2::date
        GROUP BY UPPER(TRIM(cv.veiculocvg))
      ), viagem_motorista AS (
        SELECT DISTINCT ON (cv.empresacvg, cv.motoristacvg)
          cv.empresacvg, cv.motoristacvg, cv.codigocvg, cv.datasaidacvg,
          CASE WHEN cv.datachegadacvg > cv.datasaidacvg THEN cv.datachegadacvg END AS datachegadacvg,
          cv.veiculocvg
        FROM logistica.controleviagens cv
        WHERE cv.motoristacvg IS NOT NULL AND cv.datasaidacvg <= $2::date
        ORDER BY cv.empresacvg, cv.motoristacvg, cv.datasaidacvg DESC, cv.codigocvg DESC
      ), viagem_placa AS (
        SELECT DISTINCT ON (UPPER(TRIM(cv.veiculocvg)))
          UPPER(TRIM(cv.veiculocvg)) AS placa_norm, cv.codigocvg, cv.datasaidacvg,
          CASE WHEN cv.datachegadacvg > cv.datasaidacvg THEN cv.datachegadacvg END AS datachegadacvg,
          cv.veiculocvg, cv.motoristacvg
        FROM logistica.controleviagens cv
        WHERE NULLIF(TRIM(cv.veiculocvg), '') IS NOT NULL AND cv.datasaidacvg <= $2::date
        ORDER BY UPPER(TRIM(cv.veiculocvg)), cv.datasaidacvg DESC, cv.codigocvg DESC
      )
      SELECT
        con.empresacon AS empresa,
        con.seriecon AS serie_cte,
        con.codigocon AS numero_cte,
        nf.sequenciacnf AS sequencia_nota,
        nf.notafiscalcnf AS numero_nota,
        COALESCE(nf.serienotafiscalcnf, '') AS serie_nota,
        nf.dataemissaocnf AS emissao_nota,
        NULLIF(TRIM(nf.chavenfecnf), '') AS chave_nfe,
        con.dataemissaocon AS emissao_cte,
        COALESCE(con.viagemcon, con.cargacontroleviagemcon, con.numeroviagemcon) AS viagem_documento,
        COALESCE(vm.codigocvg, vp.codigocvg) AS viagem,
        COALESCE(vm.datasaidacvg, vp.datasaidacvg) AS data_saida,
        COALESCE(vm.datachegadacvg, vp.datachegadacvg) AS data_chegada,
        GREATEST($1::date, COALESCE(cm.ultima_chegada, cp.ultima_chegada, $1::date)) AS inicio_janela_faturamento,
        $2::date AS fim_janela_faturamento,
        COALESCE(NULLIF(TRIM(con.veiculocon), ''), vm.veiculocvg, vp.veiculocvg) AS placa,
        COALESCE(me.nomemot, mg.nomemot, '') AS motorista,
        COALESCE(ce.fantasiacli, ce.nomecli, cg.fantasiacli, cg.nomecli, 'Cliente nao informado') AS cliente,
        CASE WHEN vei.tipopropriedadevei::text = 'P' THEN 'frota' ELSE 'terceiro' END AS proprietario,
        CASE
          WHEN NULLIF(TRIM(con.chaveorcamentocon), '') IS NOT NULL OR UPPER(TRIM(con.seriecon)) IN ('O', 'OC') THEN 'Orçamento'
          ELSE 'CT-e'
        END AS tipo_documento,
        CASE WHEN UPPER(COALESCE(nf.entreguecanhotocnf, '')) IN ('S', 'SIM', '1')
          OR nf.datarecebimentocanhotocnf IS NOT NULL THEN TRUE ELSE FALSE END AS recebido_erp,
        nf.datarecebimentocanhotocnf AS recebido_erp_em,
        COALESCE(nf.responsavelcanhotocnf, '') AS recebido_erp_por
      FROM logistica.conhecimentos con
      JOIN logistica.conhecimentosnotasfiscais nf
        ON nf.empresacnf = con.empresacon AND nf.seriecnf = con.seriecon AND nf.codigocnf = con.codigocon
      LEFT JOIN veiculos vei ON vei.placa_norm = UPPER(TRIM(con.veiculocon))
      LEFT JOIN motoristas_empresa me ON me.empresamot = con.empresacon AND me.codigomot = con.motoristacon
      LEFT JOIN motoristas_geral mg ON mg.codigomot = con.motoristacon
      LEFT JOIN clientes_empresa ce ON ce.empresacli = con.empresacon AND ce.codigocli = con.clientecon
      LEFT JOIN clientes_geral cg ON cg.codigocli = con.clientecon
      LEFT JOIN chegada_motorista cm ON cm.empresacvg = con.empresacon AND cm.motoristacvg = con.motoristacon
      LEFT JOIN chegada_placa cp ON cp.placa_norm = UPPER(TRIM(con.veiculocon))
      LEFT JOIN viagem_motorista vm ON vm.empresacvg = con.empresacon AND vm.motoristacvg = con.motoristacon
      LEFT JOIN viagem_placa vp ON vp.placa_norm = UPPER(TRIM(con.veiculocon)) AND vm.codigocvg IS NULL
      WHERE con.dataemissaocon BETWEEN $1::date AND $2::date
        -- Status 2 corresponde ao CT-e emitido/autorizado; status 3 e cancelado.
        AND COALESCE(con.statuscon, 0) <> 3
        AND (
          vei.tipopropriedadevei::text <> 'P'
          OR con.dataemissaocon >= GREATEST($1::date, COALESCE(cm.ultima_chegada, cp.ultima_chegada, $1::date))
        )
      ORDER BY con.dataemissaocon DESC, con.codigocon DESC, nf.sequenciacnf
      LIMIT 5000
    `, [inicio, fim]);

    const { rows: baixas } = await pool.query(`
      SELECT empresa, serie_cte, numero_cte, sequencia_nota, recebido_em, recebido_por, observacao
      FROM ${tableName("controle_canhotos")}
      WHERE recebido_em >= $1::date - INTERVAL '1 year'
    `, [inicio]);
    const baixasMap = new Map(baixas.map((row) => [[row.empresa, row.serie_cte, row.numero_cte, row.sequencia_nota].join("|"), row]));

    let itens = rows.map((row) => {
      const item = {
        empresa: row.empresa, serieCte: row.serie_cte, numeroCte: row.numero_cte,
        sequenciaNota: row.sequencia_nota, numeroNota: row.numero_nota, serieNota: row.serie_nota,
        emissaoNota: row.emissao_nota, chaveNfe: row.chave_nfe, emissaoCte: row.emissao_cte,
        viagem: row.viagem, dataSaida: row.data_saida, dataChegada: row.data_chegada,
        viagemDocumento: row.viagem_documento,
        inicioJanelaFaturamento: row.inicio_janela_faturamento,
        fimJanelaFaturamento: row.fim_janela_faturamento,
        motoristaChegou: Boolean(row.data_chegada),
        placa: text(row.placa, 20), motorista: row.motorista, cliente: row.cliente,
        proprietario: row.proprietario, recebidoErp: row.recebido_erp,
        tipoDocumento: row.tipo_documento,
      };
      const baixa = baixasMap.get(keyOf(item));
      item.recebido = Boolean(baixa || row.recebido_erp);
      item.recebidoEm = baixa?.recebido_em || row.recebido_erp_em || null;
      item.recebidoPor = baixa?.recebido_por || row.recebido_erp_por || "";
      item.observacao = baixa?.observacao || "";
      item.origemBaixa = baixa ? "portal" : row.recebido_erp ? "erp" : null;
      return item;
    });

    itens = itens.filter((item) => {
      const alvo = [item.motorista, item.cliente, item.placa, item.viagem, item.numeroNota, item.serieNota, item.numeroCte].join(" ").toLowerCase();
      return (item.proprietario !== "terceiro" || !item.recebido)
        && (proprietario === "todos" || item.proprietario === proprietario)
        && (status === "todos" || (status === "recebido") === item.recebido)
        && (!busca || alvo.includes(busca.toLowerCase()))
        && (!motorista || item.motorista.toLowerCase().includes(motorista.toLowerCase()))
        && (!cliente || item.cliente.toLowerCase().includes(cliente.toLowerCase()))
        && (!placa || item.placa.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().includes(placa))
        && (!viagem || String(item.viagem || "") === viagem)
        && (!nota || String(item.numeroNota) === nota)
        && (!serie || String(item.serieNota).replace(/^0+/, "") === serie.replace(/^0+/, ""))
        && (!cte || String(item.numeroCte) === cte)
        && (!semViagem || !item.viagem);
    });

    const viagens = new Set(itens.map((item) => item.viagem).filter(Boolean));
    res.json({
      periodo: { inicio, fim, dataCorte: DATA_CORTE }, itens,
      resumo: {
        total: itens.length,
        pendentes: itens.filter((item) => !item.recebido).length,
        recebidos: itens.filter((item) => item.recebido).length,
        viagens: viagens.size,
        frotaPendentes: itens.filter((item) => !item.recebido && item.proprietario === "frota").length,
        terceirosPendentes: itens.filter((item) => !item.recebido && item.proprietario === "terceiro").length,
      },
    });
  } catch (error) { next(error); }
});

canhotosRouter.put("/canhotos/baixa", async (req, res, next) => {
  try {
    const docs = Array.isArray(req.body?.documentos)
      ? req.body.documentos.slice(0, 500).filter((doc) => doc && doc.empresa && doc.serieCte && doc.numeroCte && doc.sequenciaNota)
      : [];
    if (!docs.length) return res.status(400).json({ error: "Selecione ao menos uma nota fiscal." });
    const recebidoPor = text(req.user?.login || req.user?.email || req.user?.id || "Usuario", 120);
    const observacao = text(req.body?.observacao, 500);
    const recebidoEm = req.body?.recebidoEm || new Date().toISOString();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const doc of docs) {
        await client.query(`
          INSERT INTO ${tableName("controle_canhotos")}
            (empresa, serie_cte, numero_cte, sequencia_nota, numero_nota, serie_nota, recebido_em, recebido_por, observacao)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (empresa, serie_cte, numero_cte, sequencia_nota) DO UPDATE SET
            recebido_em=EXCLUDED.recebido_em, recebido_por=EXCLUDED.recebido_por,
            observacao=EXCLUDED.observacao, updated_at=NOW()
        `, [doc.empresa, text(doc.serieCte, 20), doc.numeroCte, doc.sequenciaNota, doc.numeroNota,
          text(doc.serieNota, 20), recebidoEm, recebidoPor, observacao]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    res.json({ ok: true, quantidade: docs.length, recebidoPor, recebidoEm });
  } catch (error) { next(error); }
});

canhotosRouter.delete("/canhotos/baixa", async (req, res, next) => {
  try {
    const doc = req.body || {};
    const result = await pool.query(`DELETE FROM ${tableName("controle_canhotos")}
      WHERE empresa=$1 AND serie_cte=$2 AND numero_cte=$3 AND sequencia_nota=$4`,
    [doc.empresa, text(doc.serieCte, 20), doc.numeroCte, doc.sequenciaNota]);
    res.json({ ok: true, removidos: result.rowCount });
  } catch (error) { next(error); }
});

canhotosRouter.delete("/canhotos/baixa/lote", async (req, res, next) => {
  const docs = Array.isArray(req.body?.documentos)
    ? req.body.documentos.slice(0, 500).filter((doc) => doc && doc.empresa && doc.serieCte && doc.numeroCte && doc.sequenciaNota)
    : [];
  if (!docs.length) return res.status(400).json({ error: "Informe os canhotos que devem ser desmarcados." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let removidos = 0;
    for (const doc of docs) {
      const result = await client.query(`DELETE FROM ${tableName("controle_canhotos")}
        WHERE empresa=$1 AND serie_cte=$2 AND numero_cte=$3 AND sequencia_nota=$4`,
      [doc.empresa, text(doc.serieCte, 20), doc.numeroCte, doc.sequenciaNota]);
      removidos += result.rowCount;
    }
    await client.query("COMMIT");
    res.json({ ok: true, removidos });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally { client.release(); }
});
