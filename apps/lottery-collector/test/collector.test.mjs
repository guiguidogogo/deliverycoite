import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parseFederalResult,
  parseOfficialDate,
  runCollectorCycle,
  sendResultToSaas,
  signWebhookBody
} from "../src/collector.mjs";

test("converte a data oficial brasileira", () => {
  assert.equal(parseOfficialDate("19/07/2026"), "2026-07-19");
  assert.throws(() => parseOfficialDate("2026-07-19"));
});

test("preserva zeros dos cinco premios", () => {
  const result = parseFederalResult({
    numero: 6084,
    dataApuracao: "19/07/2026",
    listaDezenas: ["017667", "039675", "033914", "001743", "036446"]
  }, "2026-07-19T22:10:00.000Z");

  assert.equal(result.eventId, "federal:6084");
  assert.equal(result.firstPrize, "017667");
  assert.equal(result.prizes[3], "001743");
});

test("assina exatamente timestamp, ponto e corpo", () => {
  const body = JSON.stringify({ eventId: "federal:6084" });
  const timestamp = "1784764800";
  const secret = "0123456789abcdef0123456789abcdef";
  const expected = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
  assert.equal(signWebhookBody(body, timestamp, secret), expected);
});

test("envia corpo e cabecalhos assinados ao SaaS", async () => {
  const secret = "0123456789abcdef0123456789abcdef";
  const payload = {
    eventId: "federal:6084",
    schemaVersion: 1,
    modality: "federal",
    contest: "6084",
    drawDate: "2026-07-19",
    prizes: ["017667", "039675", "033914", "001743", "036446"],
    firstPrize: "017667",
    source: "CAIXA_JSON",
    fetchedAt: "2026-07-19T22:10:00.000Z"
  };
  let captured;
  const response = await sendResultToSaas({
    saasWebhookUrl: "https://dev.example/api/integrations/lottery-results",
    webhookSecret: secret,
    webhookMaxRetries: 1,
    requestTimeoutMs: 1000
  }, payload, async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { "content-type": "application/json" }
    });
  });

  assert.equal(response.ok, true);
  assert.equal(captured.url, "https://dev.example/api/integrations/lottery-results");
  assert.equal(captured.options.headers["x-lottery-event-id"], payload.eventId);
  assert.equal(
    captured.options.headers["x-lottery-signature"],
    signWebhookBody(captured.options.body, captured.options.headers["x-lottery-timestamp"], secret)
  );
});

test("nao repete webhook rejeitado com HTTP 403", async () => {
  let calls = 0;
  await assert.rejects(() => sendResultToSaas({
    saasWebhookUrl: "https://dev.example/api/integrations/lottery-results",
    webhookSecret: "0123456789abcdef0123456789abcdef",
    webhookMaxRetries: 5,
    requestTimeoutMs: 1000
  }, {
    eventId: "federal:6084",
    schemaVersion: 1,
    modality: "federal",
    contest: "6084",
    drawDate: "2026-07-19",
    prizes: ["017667", "039675", "033914", "001743", "036446"],
    firstPrize: "017667",
    source: "CAIXA_JSON",
    fetchedAt: "2026-07-19T22:10:00.000Z"
  }, async () => {
    calls += 1;
    return new Response("forbidden", { status: 403 });
  }), /HTTP 403/);
  assert.equal(calls, 1);
});

test("pausa consultas a CAIXA por 6h e depois 24h ao receber bloqueio", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "lottery-collector-"));
  const stateFile = path.join(directory, "state.json");
  const config = { stateFile };
  const start = Date.parse("2026-07-23T00:00:00.000Z");
  let calls = 0;
  const blockedFetch = async () => {
    calls += 1;
    const error = new Error("A CAIXA retornou HTTP 403.");
    error.status = 403;
    throw error;
  };

  try {
    const first = await runCollectorCycle(config, { now: start, fetchResult: blockedFetch });
    assert.equal(first.status, "PAUSED");
    assert.equal(first.retryAt, "2026-07-23T06:00:00.000Z");
    assert.equal(calls, 1);

    const duringPause = await runCollectorCycle(config, {
      now: start + 60 * 60 * 1000,
      fetchResult: blockedFetch
    });
    assert.equal(duringPause.status, "PAUSED");
    assert.equal(duringPause.retryAt, first.retryAt);
    assert.equal(calls, 1);

    const second = await runCollectorCycle(config, {
      now: start + 6 * 60 * 60 * 1000,
      fetchResult: blockedFetch
    });
    assert.equal(second.retryAt, "2026-07-24T06:00:00.000Z");
    assert.equal(calls, 2);

    const saved = JSON.parse(await readFile(stateFile, "utf8"));
    assert.equal(saved.caixaBlockCount, 2);
    assert.equal(saved.caixaLastStatus, 403);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
