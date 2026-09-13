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
