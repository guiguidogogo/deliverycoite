import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL ||= "redis://localhost:6379";
process.env.APP_URL ||= "http://localhost:3334";
process.env.EVOLUTION_API_URL ||= "http://localhost:8080";
process.env.EVOLUTION_API_KEY ||= "1234567890123456";
process.env.WEBHOOK_SECRET ||= "123456789012345678901234";

test("API keys are hashed and verifiable", async () => {
  const { generateApiKey, hashApiKey, verifyApiKey } = await import("./api-key.js");
  const generated = generateApiKey("delivery");
  const hash = await hashApiKey(generated.plain);
  assert.equal(await verifyApiKey(generated.plain, hash), true);
  assert.equal(await verifyApiKey(`${generated.plain}x`, hash), false);
  assert.equal(hash.includes(generated.plain), false);
});
