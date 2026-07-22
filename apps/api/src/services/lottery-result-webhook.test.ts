import assert from "node:assert/strict";
import {
  lotteryResultWebhookSchema,
  signLotteryWebhookBody,
  verifyLotteryWebhookSignature
} from "./lottery-result-webhook-service.js";

const secret = "0123456789abcdef0123456789abcdef";
const timestamp = "1784764800";
const rawBody = Buffer.from(JSON.stringify({ eventId: "federal:6084" }));
const signature = signLotteryWebhookBody(rawBody, timestamp, secret);

assert.deepEqual(verifyLotteryWebhookSignature({
  rawBody,
  timestamp,
  signature,
  secret,
  maxAgeSeconds: 300,
  nowSeconds: Number(timestamp)
}), { ok: true });

assert.deepEqual(verifyLotteryWebhookSignature({
  rawBody,
  timestamp,
  signature: `${signature.slice(0, -1)}0`,
  secret,
  maxAgeSeconds: 300,
  nowSeconds: Number(timestamp)
}), { ok: false, reason: "signature" });

assert.deepEqual(verifyLotteryWebhookSignature({
  rawBody,
  timestamp,
  signature,
  secret,
  maxAgeSeconds: 300,
  nowSeconds: Number(timestamp) + 301
}), { ok: false, reason: "expired" });

const parsed = lotteryResultWebhookSchema.parse({
  eventId: "federal:6084",
  schemaVersion: 1,
  modality: "federal",
  contest: 6084,
  drawDate: "2026-07-19",
  prizes: ["017667", "039675", "033914", "001743", "036446"],
  firstPrize: "017667",
  source: "CAIXA_JSON",
  fetchedAt: "2026-07-19T22:10:00-03:00"
});

assert.equal(parsed.contest, "6084");
assert.equal(parsed.firstPrize, "017667");
assert.equal(parsed.prizes[3], "001743");

console.log("lottery result webhook tests passed");
