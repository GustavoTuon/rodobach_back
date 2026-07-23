import express from "express";
import { tableName } from "../config.js";
import { pool } from "../db/pool.js";
import { getVeiculosPool } from "../db/pool-veiculos.js";

export const manutencaoRouter = express.Router();

const TABLE = () => tableName("automacao_mensagem_manutencao");
const CONTACT_TABLE = () => tableName("manutencao_contatos");

function normalizePhone(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function normalizePhoneList(value) {
  return String(value || "")
    .split(/[,;\s]+/)
    .map(normalizePhone)
    .filter(Boolean);
}

async function resolveContato(payload = {}) {
  const numerosDiretos = normalizePhoneList(payload.numeros || payload.contato_numero);
  const numeroDireto = numerosDiretos[0];
  if (payload.contato_id) {
    const { rows } = await pool.query(
      `SELECT id, nome, numero FROM ${CONTACT_TABLE()} WHERE id = $1 AND ativo = TRUE`,
      [Number(payload.contato_id)]
    );
    if (rows[0]) {
      return {
        contato_id: null,
        contato_nome: null,
        contato_numero: null,
        numeros: rows[0].numero,
      };
    }
  }

  if (numeroDireto) {
    return {
      contato_id: null,
      contato_nome: null,
      contato_numero: null,
      numeros: numerosDiretos.join(","),
    };
  }

  return { contato_id: null, contato_nome: null, contato_numero: null, numeros: null };
}

// Aceita array ou string ("123, 456; 789") e devolve "123,456,789"
function normalizarNumeros(input) {
  const lista = Array.isArray(input) ? input : String(input || "").split(/[,;\n]+/);
  return lista
    .map(n => String(n).replace(/[^\d+]/g, ""))
    .filter(Boolean)
    .join(",");
}

const QUERY_VEICULOS = `
  SELECT placa, odometro
  FROM (
    SELECT
      v.placa,
      mcb.odometro,
      ROW_NUMBER() OVER (
        PARTITION BY v.placa
        ORDER BY mcb.data_hora DESC
      ) AS rn
    FROM rodobach.mensagens_cb mcb
    LEFT JOIN rodobach.veiculos v
      ON v.veiculo_id = mcb.veiculo_id
  ) t
  WHERE rn = 1
    AND placa IS NOT NULL
  ORDER BY placa
`;

// GET /api/manutencao/veiculos — lista placas + odômetro do banco externo
manutencaoRouter.get("/manutencao/veiculos", async (_req, res, next) => {
  try {
    const vPool = getVeiculosPool();
    const { rows } = await vPool.query(QUERY_VEICULOS);
    res.json({ veiculos: rows });
  } catch (error) {
    next(error);
  }
});

manutencaoRouter.get("/manutencao/contatos", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nome, numero, ativo, criado_em, atualizado_em
       FROM ${CONTACT_TABLE()}
       WHERE ativo = TRUE
       ORDER BY lower(nome), numero`
    );
    res.json({ contatos: rows });
  } catch (error) {
    next(error);
  }
});

manutencaoRouter.post("/manutencao/contatos", async (req, res, next) => {
  try {
    const nome = String(req.body.nome || "").trim();
    const numero = normalizePhone(req.body.numero);
    if (!nome || !numero) {
      return res.status(400).json({ error: "Nome e numero sao obrigatorios." });
    }

    const { rows } = await pool.query(
      `INSERT INTO ${CONTACT_TABLE()} (nome, numero)
       VALUES ($1, $2)
       ON CONFLICT (numero) DO UPDATE
         SET nome = EXCLUDED.nome,
             ativo = TRUE,
             atualizado_em = NOW()
       RETURNING *`,
      [nome, numero]
    );
    res.status(201).json({ contato: rows[0] });
  } catch (error) {
    next(error);
  }
});

// GET /api/manutencao
manutencaoRouter.get("/manutencao", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM ${TABLE()} ORDER BY criado_em DESC`
    );
    let odometros = new Map();
    try {
      const { rows: veiculos } = await getVeiculosPool().query(QUERY_VEICULOS);
      odometros = new Map(veiculos.map((veiculo) => [String(veiculo.placa).toUpperCase(), Number(veiculo.odometro)]));
    } catch (error) {
      console.warn("Odometros indisponiveis na listagem de manutencao:", error.message);
    }

    const automacoes = rows.map((item) => {
      const odometro = odometros.get(String(item.placa).toUpperCase());
      const kmAtual = Number.isFinite(odometro) ? odometro : Number(item.km_atual || 0);
      const kmManutencao = Number(item.km_manutencao_prevista || item.km_proximo_envio || 0);
      const kmAviso = Number(item.km_proximo_aviso || Math.max(0, kmManutencao - Number(item.antecedencia_km || 0)));
      return {
        ...item,
        km_atual: kmAtual,
        odometro_online: Number.isFinite(odometro),
        km_manutencao_prevista: kmManutencao,
        km_proximo_aviso: kmAviso,
        km_faltante: kmManutencao - kmAtual,
        aviso_disponivel: Boolean(item.ativo) && kmAtual >= kmAviso,
      };
    });
    res.json({ automacoes });
  } catch (error) {
    next(error);
  }
});

// POST /api/manutencao — cria um registro por placa selecionada
manutencaoRouter.post("/manutencao", async (req, res, next) => {
  try {
    const { placas, titulo, mensagem, intervalo_km } = req.body;
    const antecedenciaKm = Number(req.body.antecedencia_km ?? 1000);
    const contato = await resolveContato(req.body);

    if (!Array.isArray(placas) || placas.length === 0) {
      return res.status(400).json({ error: "Selecione ao menos uma placa." });
    }
    if (!titulo || !mensagem || !intervalo_km) {
      return res.status(400).json({ error: "Título, mensagem e intervalo_km são obrigatórios." });
    }
    if (!Number.isFinite(antecedenciaKm) || antecedenciaKm < 0 || antecedenciaKm >= Number(intervalo_km)) {
      return res.status(400).json({ error: "A antecedencia deve ser positiva e menor que o intervalo." });
    }

    if (!contato.numeros) {
      return res.status(400).json({ error: "Selecione ou cadastre um contato para envio." });
    }

    // placas vem como [{ placa, km_atual }]
    const entradas = placas.map(p => ({
      placa: String(p.placa).toUpperCase().trim(),
      km_atual: Number(p.km_atual || 0),
    }));

    const criados = [];
    for (const { placa, km_atual } of entradas) {
      const km = Number(km_atual || 0);
      const intervalo = Number(intervalo_km);
      const { rows } = await pool.query(
        `INSERT INTO ${TABLE()} (
           placa, titulo, mensagem, intervalo_km, antecedencia_km, km_atual,
           km_proximo_envio, km_manutencao_prevista, km_proximo_aviso,
           numeros, contato_id, contato_nome, contato_numero
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $7, $9, $10, $11, $12) RETURNING *`,
        [
          placa,
          titulo,
          mensagem,
          intervalo,
          antecedenciaKm,
          km,
          Math.max(0, km + intervalo - antecedenciaKm),
          km + intervalo,
          contato.numeros,
          contato.contato_id,
          contato.contato_nome,
          contato.contato_numero,
        ]
      );
      criados.push(rows[0]);
    }

    res.status(201).json({ automacoes: criados });
  } catch (error) {
    next(error);
  }
});

// PUT /api/manutencao/:id
manutencaoRouter.put("/manutencao/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      placa,
      titulo,
      mensagem,
      intervalo_km,
      antecedencia_km,
      km_atual,
      ativo,
      numeros,
      contato_id,
      contato_nome,
      contato_numero,
    } = req.body;

    const sets = [];
    const vals = [];
    let i = 1;

    if (placa !== undefined)        { sets.push(`placa = $${i++}`);        vals.push(String(placa).toUpperCase().trim()); }
    if (titulo !== undefined)       { sets.push(`titulo = $${i++}`);       vals.push(titulo); }
    if (mensagem !== undefined)     { sets.push(`mensagem = $${i++}`);     vals.push(mensagem); }
    if (intervalo_km !== undefined) { sets.push(`intervalo_km = $${i++}`); vals.push(Number(intervalo_km)); }
    if (antecedencia_km !== undefined) { sets.push(`antecedencia_km = $${i++}`); vals.push(Number(antecedencia_km)); }
    if (km_atual !== undefined)     { sets.push(`km_atual = $${i++}`);     vals.push(Number(km_atual)); }
    if (ativo !== undefined)        { sets.push(`ativo = $${i++}`);        vals.push(Boolean(ativo)); }
    if (
      numeros !== undefined ||
      contato_id !== undefined ||
      contato_nome !== undefined ||
      contato_numero !== undefined
    ) {
      const contato = await resolveContato(req.body);
      if (!contato.numeros) {
        return res.status(400).json({ error: "Selecione ou cadastre um contato para envio." });
      }
      sets.push(`numeros = $${i++}`); vals.push(contato.numeros);
      sets.push(`contato_id = $${i++}`); vals.push(contato.contato_id);
      sets.push(`contato_nome = $${i++}`); vals.push(contato.contato_nome);
      sets.push(`contato_numero = $${i++}`); vals.push(contato.contato_numero);
    }
    // Recalcula km_proximo_envio se km_atual ou intervalo_km mudar
    if (km_atual !== undefined || intervalo_km !== undefined || antecedencia_km !== undefined) {
      // Busca os valores atuais do registro para calcular corretamente
      const { rows: atual } = await pool.query(
        `SELECT km_atual, intervalo_km, antecedencia_km FROM ${TABLE()} WHERE id = $1`, [id]
      );
      if (atual.length > 0) {
        const novoKm = km_atual !== undefined ? Number(km_atual) : atual[0].km_atual;
        const novoIntervalo = intervalo_km !== undefined ? Number(intervalo_km) : atual[0].intervalo_km;
        const novaAntecedencia = antecedencia_km !== undefined ? Number(antecedencia_km) : atual[0].antecedencia_km;
        const manutencaoPrevista = novoKm + novoIntervalo;
        const proximoAviso = Math.max(0, manutencaoPrevista - novaAntecedencia);
        sets.push(`km_manutencao_prevista = $${i++}`); vals.push(manutencaoPrevista);
        sets.push(`km_proximo_aviso = $${i++}`); vals.push(proximoAviso);
        sets.push(`km_proximo_envio = $${i++}`); vals.push(proximoAviso);
      }
    }
    sets.push(`atualizado_em = $${i++}`);
    vals.push(new Date());

    if (sets.length === 1) {
      return res.status(400).json({ error: "Nenhum campo para atualizar." });
    }

    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE ${TABLE()} SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
      vals
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Automação não encontrada." });
    }
    res.json({ automacao: rows[0] });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/manutencao/:id
manutencaoRouter.delete("/manutencao/:id", async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM ${TABLE()} WHERE id = $1`, [req.params.id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: "Automação não encontrada." });
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
