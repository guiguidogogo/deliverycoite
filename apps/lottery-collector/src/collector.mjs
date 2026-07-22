import { createHmac } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const TRANSIENT_WEBHOOK_STATUSES = new Set([429, 500, 502, 503, 504]);

function onlyDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function parseOfficialDate(value) {
  const match = String(value ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw new Error("A CAIXA retornou uma data oficial invalida.");
  return `${match[3]}-${match[2]}-${match[1]}`;
}

export function parseFederalResult(raw, fetchedAt = new Date().toISOString()) {
  if (!raw || typeof raw !== "object") throw new Error("A CAIXA retornou um resultado invalido.");
  const contest = onlyDigits(raw.numero ?? raw.numeroConcurso);
  const prizes = Array.isArray(raw.listaDezenas)
    ? raw.listaDezenas.slice(0, 5).map(onlyDigits)
    : [];
  if (!contest) throw new Error("Numero do concurso ausente na resposta da CAIXA.");
  if (prizes.length !== 5 || prizes.some((prize) => !prize)) {
    throw new Error("A resposta da Loteria Federal nao possui os cinco premios.");
  }

  return {
    eventId: `federal:${contest}`,
    schemaVersion: 1,
    modality: "federal",
    contest,
    drawDate: parseOfficialDate(raw.dataApuracao ?? raw.dataSorteio),
    prizes,
    firstPrize: prizes[0],
    source: "CAIXA_JSON",
    fetchedAt
  };
}

export function signWebhookBody(body, timestamp, secret) {
  return `sha256=${createHmac("sha256", secret).update(timestamp).update(".").update(body).digest("hex")}`;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchFederalResult(config, contestNumber) {
  const url = contestNumber
    ? `${config.caixaResultsApiUrl.replace(/\/$/, "")}/${encodeURIComponent(onlyDigits(contestNumber))}`
    : config.caixaResultsApiUrl;
  const response = await fetchWithTimeout(url, {
    headers: {
      accept: "application/json",
      "user-agent": config.userAgent
    }
  }, config.requestTimeoutMs);

  if (!response.ok) {
    const error = new Error(`A CAIXA retornou HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  const text = await response.text();
  if (!text.trim()) throw new Error("A CAIXA retornou uma resposta vazia.");
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("A CAIXA retornou JSON invalido.");
  }
  return {
    payload: parseFederalResult(raw),
    previousContest: onlyDigits(raw.numeroConcursoAnterior)
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendResultToSaas(config, payload, fetchImpl = fetchWithTimeout) {
  const body = JSON.stringify(payload);
  let attempt = 0;
  while (attempt < config.webhookMaxRetries) {
    attempt += 1;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signWebhookBody(body, timestamp, config.webhookSecret);
    let response;
    try {
      response = await fetchImpl(config.saasWebhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-lottery-event-id": payload.eventId,
          "x-lottery-timestamp": timestamp,
          "x-lottery-signature": signature
        },
        body
      }, config.requestTimeoutMs);
    } catch (error) {
      if (attempt >= config.webhookMaxRetries) throw error;
      await wait(Math.min(1000 * 2 ** (attempt - 1), 30_000));
      continue;
    }

    if (response.ok) return response.json().catch(() => ({ ok: true }));
    const responseText = (await response.text()).slice(0, 500);
    if (!TRANSIENT_WEBHOOK_STATUSES.has(response.status) || attempt >= config.webhookMaxRetries) {
      const error = new Error(`Webhook respondeu HTTP ${response.status}: ${responseText}`);
      error.status = response.status;
      throw error;
    }
    await wait(Math.min(1000 * 2 ** (attempt - 1), 30_000));
  }
  throw new Error("Limite de tentativas do webhook atingido.");
}

async function readState(stateFile) {
  try {
    return JSON.parse(await readFile(stateFile, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeState(stateFile, state) {
  await mkdir(path.dirname(stateFile), { recursive: true });
  const temporary = `${stateFile}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, stateFile);
}

export async function runCollectorCycle(config, { force = false } = {}) {
  const state = await readState(config.stateFile);
  const latest = await fetchFederalResult(config);
  if (!force && state.lastDeliveredEventId === latest.payload.eventId) {
    return { status: "UNCHANGED", eventIds: [latest.payload.eventId] };
  }

  const pending = [latest.payload];
  let previousContest = latest.previousContest;
  if (!force) {
    while (previousContest && pending.length < config.historyLookback) {
      const previous = await fetchFederalResult(config, previousContest);
      if (previous.payload.eventId === state.lastDeliveredEventId) break;
      if (pending.some((item) => item.eventId === previous.payload.eventId)) {
        throw new Error("A CAIXA retornou um ciclo na navegacao de concursos anteriores.");
      }
      pending.push(previous.payload);
      previousContest = previous.previousContest;
    }
  }

  const deliveries = [];
  for (const payload of pending.reverse()) {
    const delivery = await sendResultToSaas(config, payload);
    deliveries.push({ eventId: payload.eventId, delivery });
    await writeState(config.stateFile, {
      lastDeliveredEventId: payload.eventId,
      lastDeliveredAt: new Date().toISOString()
    });
  }
  return { status: "DELIVERED", eventIds: deliveries.map((item) => item.eventId), deliveries };
}
