import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { config, corsOrigins } from "./config.js";
import { apiRouter } from "./routes.js";
import { HttpError, logger, prisma, redis } from "./lib.js";

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(pinoHttp({ logger, genReqId: (req: any, res: any) => { const id = req.headers["x-request-id"]?.toString().slice(0, 128) || randomUUID(); res.setHeader("x-request-id", id); return id; } }));
app.use(cors({ origin(origin, callback) { if (!origin || corsOrigins.includes(origin.replace(/\/$/, ""))) return callback(null, true); callback(new HttpError(403, "Origem CORS não permitida", "cors_denied")); }, methods: ["GET", "POST", "DELETE", "OPTIONS"], allowedHeaders: ["content-type", "x-hub-api-key", "authorization", "idempotency-key", "x-request-id", "x-confirm-delete"], maxAge: 86400 }));
app.use(express.json({ limit: config.MAX_PAYLOAD_BYTES }));

async function checkEvolution() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(config.EVOLUTION_TIMEOUT_MS, 3000));
  try { const response = await fetch(`${config.EVOLUTION_API_URL}/`, { signal: controller.signal, headers: { apikey: config.EVOLUTION_API_KEY } }); return response.ok ? "ok" : "error"; }
  catch { return "error"; } finally { clearTimeout(timer); }
}

app.get("/health", async (_req, res) => {
  const [database, redisState, evolution] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => "ok").catch(() => "error"),
    redis.ping().then(() => "ok").catch(() => "error"),
    checkEvolution()
  ]);
  const status = database === "ok" && redisState === "ok" ? "ok" : "degraded";
  res.status(status === "ok" ? 200 : 503).json({ status, database, redis: redisState, evolution });
});
app.get("/ready", async (_req, res) => {
  const ready = await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping()]).then(() => true).catch(() => false);
  res.status(ready ? 200 : 503).json({ ready });
});
app.use("/api/v1", apiRouter);
app.use((_req, _res, next) => next(new HttpError(404, "Rota não encontrada", "not_found")));
app.use((error: any, req: any, res: any, _next: any) => {
  const status = error instanceof HttpError ? error.status : error?.type === "entity.too.large" ? 413 : 500;
  if (status >= 500) req.log?.error({ err: error }, "Request failed");
  res.status(status).json({ error: { code: error instanceof HttpError ? error.code : status === 413 ? "payload_too_large" : "internal_error", message: status === 500 ? "Erro interno" : error.message, details: error instanceof HttpError ? error.details : undefined, request_id: req.id } });
});
