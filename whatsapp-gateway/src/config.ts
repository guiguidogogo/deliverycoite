import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3334),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  APP_URL: z.string().url().transform((v) => v.replace(/\/$/, "")),
  EVOLUTION_API_URL: z.string().url().transform((v) => v.replace(/\/$/, "")),
  EVOLUTION_API_KEY: z.string().min(16),
  WEBHOOK_SECRET: z.string().min(24),
  CORS_ORIGINS: z.string().default(""),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  EVOLUTION_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  RATE_LIMIT_APP_PER_MINUTE: z.coerce.number().int().positive().default(600),
  RATE_LIMIT_TENANT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_INSTANCE_PER_MINUTE: z.coerce.number().int().positive().default(120),
  MAX_PAYLOAD_BYTES: z.coerce.number().int().positive().default(1048576),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().positive().default(24),
  RUN_WORKER: z.enum(["true", "false"]).default("true").transform((v) => v === "true")
});

export const config = schema.parse(process.env);
export const corsOrigins = config.CORS_ORIGINS.split(",").map((v) => v.trim().replace(/\/$/, "")).filter(Boolean);
