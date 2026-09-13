import assert from "node:assert/strict";
import test from "node:test";

import { dispatchWhatsappMessage } from "./whatsapp.js";

function settings() {
  return {
    id: "settings-1",
    companyId: "company-a",
    companyName: "Loja",
    whatsappNumber: "+55 (75) 99999-9999",
    deliveryFee: 5,
    openTime: "18:00",
    closeTime: "23:59",
    autoMessage: "",
    darkModeEnabled: true,
    updatedAt: new Date(),
    createdAt: new Date()
  } as any;
}

test("dispatchWhatsappMessage routes automatic sends through the Evolution gateway", async () => {
  const previousUrl = process.env.HUB_WHATSAPP_URL;
  const previousKey = process.env.HUB_WHATSAPP_KEY;
  const previousFetch = globalThis.fetch;
  process.env.HUB_WHATSAPP_URL = "https://whatsapp-gateway.example.test";
  process.env.HUB_WHATSAPP_KEY = "server-only-key";

  let request: { url?: string; apiKey?: string | null; body?: string } = {};
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    request = {
      url: String(input),
      apiKey: headers.get("x-hub-api-key"),
      body: init?.body?.toString()
    };
    return Response.json({ job_id: "job-1", status: "queued" }, { status: 202 });
  };

  try {
    const result = await dispatchWhatsappMessage(settings(), "75999999999", "Mensagem de teste");
    assert.equal(result.ok, true);
    assert.equal(result.channel, "EVOLUTION");
  } finally {
    globalThis.fetch = previousFetch;
    process.env.HUB_WHATSAPP_URL = previousUrl;
    process.env.HUB_WHATSAPP_KEY = previousKey;
  }

  assert.equal(request.url, "https://whatsapp-gateway.example.test/api/v1/whatsapp/send/text");
  assert.equal(request.apiKey, "server-only-key");
  assert.deepEqual(JSON.parse(request.body ?? "{}"), {
    tenant_id: "company-a",
    to: "75999999999",
    message: "Mensagem de teste"
  });
});

test("dispatchWhatsappMessage returns a manual link when Evolution is unavailable", async () => {
  const previousUrl = process.env.HUB_WHATSAPP_URL;
  const previousKey = process.env.HUB_WHATSAPP_KEY;
  process.env.HUB_WHATSAPP_URL = "";
  process.env.HUB_WHATSAPP_KEY = "";

  try {
    const result = await dispatchWhatsappMessage(settings(), "75999999999", "Mensagem de teste", "75999999999");
    assert.equal(result.ok, true);
    assert.equal(result.channel, "WHATSAPP_LINK");
    assert.match(result.whatsappUrl ?? "", /wa\.me\/75999999999/);
  } finally {
    process.env.HUB_WHATSAPP_URL = previousUrl;
    process.env.HUB_WHATSAPP_KEY = previousKey;
  }
});
