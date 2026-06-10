import { Router } from "express";

const router = Router();

const INSTANCE_NAME = process.env.EVOLUTION_INSTANCE_NAME || "rodobach";

function evolutionConfig() {
  const url = process.env.EVOLUTION_API_URL;
  const key = process.env.EVOLUTION_API_KEY;
  if (!url || !key) {
    throw new Error("Evolution API não configurada (EVOLUTION_API_URL / EVOLUTION_API_KEY)");
  }
  return { url, key };
}

async function evolutionFetch(path, options = {}) {
  const { url, key } = evolutionConfig();
  const res = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      "apikey": key,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Evolution API ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

async function fetchInstanceInfo() {
  try {
    const list = await evolutionFetch(`/instance/fetchInstances?instanceName=${INSTANCE_NAME}`);
    const inst = Array.isArray(list) ? list[0] : list;
    const raw = inst?.ownerJid?.replace("@s.whatsapp.net", "") ?? null;
    return { phone: raw, profileName: inst?.profileName ?? null };
  } catch {
    return { phone: null, profileName: null };
  }
}

// GET /api/whatsapp/status
router.get("/whatsapp/status", async (_req, res, next) => {
  try {
    const data = await evolutionFetch(`/instance/connectionState/${INSTANCE_NAME}`);
    const state = data.instance?.state ?? "unknown";
    if (state === "open") {
      const info = await fetchInstanceInfo();
      return res.json({ state, ...info });
    }
    res.json({ state });
  } catch (err) {
    if (err.status === 404) return res.json({ state: "not_found" });
    next(err);
  }
});

// POST /api/whatsapp/connect — cria instância se não existir e retorna QR code
router.post("/whatsapp/connect", async (_req, res, next) => {
  try {
    let state = "not_found";

    try {
      const statusData = await evolutionFetch(`/instance/connectionState/${INSTANCE_NAME}`);
      state = statusData.instance?.state ?? "unknown";
    } catch (err) {
      if (err.status !== 404) throw err;
    }

    if (state === "open") {
      const info = await fetchInstanceInfo();
      return res.json({ connected: true, ...info });
    }

    if (state === "not_found") {
      await evolutionFetch("/instance/create", {
        method: "POST",
        body: JSON.stringify({ instanceName: INSTANCE_NAME, integration: "WHATSAPP-BAILEYS" }),
      });
    }

    const qrData = await evolutionFetch(`/instance/connect/${INSTANCE_NAME}`);
    res.json({ connected: false, qrcode: qrData.base64, code: qrData.code });
  } catch (err) {
    next(err);
  }
});

export { router as whatsappRouter };
