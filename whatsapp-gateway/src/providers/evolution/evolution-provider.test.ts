import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL ||= "redis://localhost:6379";
process.env.APP_URL ||= "http://localhost:3334";
process.env.EVOLUTION_API_URL ||= "http://localhost:8080";
process.env.EVOLUTION_API_KEY ||= "1234567890123456";
process.env.WEBHOOK_SECRET ||= "123456789012345678901234";

test("detects an orphaned Evolution instance from provider 404", async () => {
  const { HttpError, prisma, redis } = await import("../../lib.js");
  const { isEvolutionInstanceMissing } = await import("./evolution-provider.js");

  assert.equal(isEvolutionInstanceMissing(new HttpError(502, "provider", "provider_error", { providerStatus: 404 })), true);
  assert.equal(isEvolutionInstanceMissing(new HttpError(502, "provider", "provider_error", { providerStatus: 401 })), false);
  assert.equal(isEvolutionInstanceMissing(new Error("network")), false);
  redis.disconnect();
  await prisma.$disconnect();
});

test("retries Brazilian mobile numbers without the ninth digit after Evolution 400", async () => {
  const originalFetch = globalThis.fetch;
  const sentNumbers: string[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sentNumbers.push(JSON.parse(String(init?.body)).number);
    if (sentNumbers.length === 1) {
      return new Response(JSON.stringify({ response: { message: ["number not found"] } }), { status: 400 });
    }
    return new Response(JSON.stringify({ key: { id: "message-id" } }), { status: 200 });
  }) as typeof fetch;

  try {
    const { EvolutionProvider } = await import("./evolution-provider.js");
    await new EvolutionProvider().sendText("instance", "5571992294907", "Teste");
    assert.deepEqual(sentNumbers, ["5571992294907", "557192294907"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("adds the Brazilian country code to a local mobile number", async () => {
  process.env.NODE_ENV = "test";
  process.env.EVOLUTION_API_URL = "https://evolution.example";
  process.env.EVOLUTION_API_KEY = "test-key";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.WEBHOOK_SECRET = "01234567890123456789012345678901";

  const calls: string[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)).number);
    return new Response(JSON.stringify({ key: { id: "message-id" } }), { status: 201 });
  }) as typeof fetch;

  const { EvolutionProvider } = await import("./evolution-provider.js");
  await new EvolutionProvider().sendText("instance", "71992294907", "Teste");
  assert.deepEqual(calls, ["5571992294907"]);
});
