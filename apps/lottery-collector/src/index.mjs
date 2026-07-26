import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { resolveFederalResult, runCollectorCycle } from "./collector.mjs";

function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^"|"$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} deve ser um inteiro positivo.`);
  return parsed;
}

function getConfig() {
  const webhookSecret = process.env.LOTTERY_WEBHOOK_SECRET ?? "";
  if (webhookSecret.length < 32) throw new Error("LOTTERY_WEBHOOK_SECRET deve possuir pelo menos 32 caracteres.");
  const saasWebhookUrl = process.env.SAAS_WEBHOOK_URL ?? "";
  if (!/^https?:\/\//.test(saasWebhookUrl)) throw new Error("SAAS_WEBHOOK_URL invalida.");

  return {
    caixaResultsApiUrl: process.env.CAIXA_RESULTS_API_URL
      ?? "https://servicebus2.caixa.gov.br/portaldeloterias/api/federal",
    saasWebhookUrl,
    webhookSecret,
    pollIntervalMs: positiveInteger(process.env.COLLECTOR_POLL_INTERVAL_MS, 900000, "COLLECTOR_POLL_INTERVAL_MS"),
    requestTimeoutMs: positiveInteger(process.env.COLLECTOR_REQUEST_TIMEOUT_MS, 15000, "COLLECTOR_REQUEST_TIMEOUT_MS"),
    webhookMaxRetries: positiveInteger(process.env.COLLECTOR_WEBHOOK_MAX_RETRIES, 5, "COLLECTOR_WEBHOOK_MAX_RETRIES"),
    historyLookback: positiveInteger(process.env.COLLECTOR_HISTORY_LOOKBACK, 10, "COLLECTOR_HISTORY_LOOKBACK"),
    stateFile: path.resolve(process.cwd(), process.env.COLLECTOR_STATE_FILE ?? "./data/state.json"),
    userAgent: process.env.LOTTERY_COLLECTOR_USER_AGENT ?? "HubRegional-LotteryCollector/1.0",
    relayToken: process.env.CAIXA_LOTTERY_RELAY_TOKEN ?? webhookSecret
  };
}

loadEnvFile();

const once = process.argv.includes("--once");
const force = process.argv.includes("--force");
const enabled = (process.env.COLLECTOR_ENABLED ?? "false").toLowerCase() === "true";

if (!once && !enabled) {
  console.log("[lottery-collector] desativado; use COLLECTOR_ENABLED=true ou --once");
  process.exit(0);
}

const config = getConfig();
let running = false;
let lastCycle = null;
const relayCache = new Map();
const relayInFlight = new Map();

function bearerToken(request) {
  const authorization = String(request.headers.authorization ?? "");
  if (/^Bearer /i.test(authorization)) return authorization.slice(7).trim();
  return String(request.headers["x-caixa-relay-token"] ?? "").trim();
}

function relayRequestKey(contestNumber, drawDate) {
  return contestNumber ? `contest:${contestNumber}` : drawDate ? `date:${drawDate}` : "latest";
}

async function resolveRelayRequest(contestNumber, drawDate) {
  const key = relayRequestKey(contestNumber, drawDate);
  const cached = relayCache.get(key);
  if (cached) return cached;
  const existing = relayInFlight.get(key);
  if (existing) return existing;

  const pending = resolveFederalResult(config, { contestNumber, drawDate })
    .then((result) => {
      relayCache.set(key, result.raw);
      relayCache.set(`contest:${result.payload.contest}`, result.raw);
      relayCache.set(`date:${result.payload.drawDate}`, result.raw);
      return result.raw;
    })
    .finally(() => relayInFlight.delete(key));
  relayInFlight.set(key, pending);
  return pending;
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const result = await runCollectorCycle(config, { force });
    lastCycle = {
      ok: true,
      at: new Date().toISOString(),
      status: result.status,
      eventIds: result.eventIds,
      ...(result.retryAt ? { retryAt: result.retryAt } : {}),
      ...(result.reason ? { reason: result.reason } : {})
    };
    console.log(`[lottery-collector] ${result.status} ${result.eventIds.join(",")}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "falha desconhecida";
    lastCycle = { ok: false, at: new Date().toISOString(), message };
    console.error(`[lottery-collector] ${message}`);
  } finally {
    running = false;
  }
}

if (once) {
  void tick();
} else {
  const interval = Math.max(config.pollIntervalMs, 60_000);
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json; charset=utf-8");
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const pathname = requestUrl.pathname;
    if (pathname === "/" || pathname === "/health" || pathname.endsWith("/health")) {
      response.statusCode = lastCycle?.ok === false ? 503 : 200;
      response.end(JSON.stringify({ service: "lottery-collector", enabled: true, lastCycle }));
      return;
    }
    const federalMatch = pathname.match(/(?:^|\/)federal(?:\/(\d+))?\/?$/i);
    if (request.method === "GET" && federalMatch) {
      if (!config.relayToken || bearerToken(request) !== config.relayToken) {
        response.statusCode = 401;
        response.end(JSON.stringify({ message: "Nao autorizado." }));
        return;
      }
      const contestNumber = federalMatch[1] ?? "";
      const drawDate = requestUrl.searchParams.get("date") ?? "";
      void resolveRelayRequest(contestNumber, drawDate)
        .then((raw) => {
          response.statusCode = 200;
          response.end(JSON.stringify(raw));
        })
        .catch((error) => {
          response.statusCode = Number.isInteger(error?.status) ? error.status : 502;
          response.end(JSON.stringify({
            message: error instanceof Error ? error.message : "Falha ao consultar a CAIXA."
          }));
        });
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: "Not found" }));
  });
  server.listen(process.env.PORT || 3000, () => {
    console.log("[lottery-collector] health HTTP ativo");
  });
  void tick();
  setInterval(tick, interval);
  console.log(`[lottery-collector] ativo a cada ${interval}ms`);
}
