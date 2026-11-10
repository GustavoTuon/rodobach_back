import { test } from "node:test";
import assert from "node:assert/strict";
import { isWhatsappGroup, normalizeWhatsappRecipient } from "../src/services/whatsappRecipient.js";
import { sendWhatsappText } from "../src/routes/whatsapp.js";

test("preserves current and legacy group IDs and normalizes phones", () => {
  for (const id of ["120363123456789012@g.us", "5511999999999-1234567890@g.us"]) {
    assert.equal(isWhatsappGroup(id), true);
    assert.equal(normalizeWhatsappRecipient(id), id);
  }
  assert.equal(normalizeWhatsappRecipient("+55 (11) 99999-9999"), "5511999999999");
  assert.equal(isWhatsappGroup("grupo@g.us"), false);
});

test("sender passes the complete group ID to the provider without sending", async (t) => {
  const previous = { url: process.env.EVOLUTION_API_URL, key: process.env.EVOLUTION_API_KEY };
  process.env.EVOLUTION_API_URL = "https://example.invalid";
  process.env.EVOLUTION_API_KEY = "test";
  t.after(() => {
    for (const [name, value] of [["EVOLUTION_API_URL", previous.url], ["EVOLUTION_API_KEY", previous.key]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  let payload;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ success: true }) };
  });
  await sendWhatsappText("120363123456789012@g.us", "Alerta de manutenção");
  assert.deepEqual(payload, { number: "120363123456789012@g.us", text: "Alerta de manutenção" });
});
