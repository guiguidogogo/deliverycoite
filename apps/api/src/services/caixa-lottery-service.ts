import { env } from "../utils/env.js";

export const CAIXA_LOTTERY_MODALITIES = [
  "federal",
  "megasena",
  "lotofacil",
  "quina",
  "lotomania",
  "duplasena",
  "diadesorte",
  "timemania",
  "supersete",
  "maismilionaria"
] as const;

export const SUPPORTED_RAFFLE_CAIXA_MODALITIES = ["federal"] as const;

type CaixaModality = (typeof CAIXA_LOTTERY_MODALITIES)[number];

export type CaixaLotteryResult = {
  modality: CaixaModality;
  contestNumber: string;
  officialDateKey: string;
  officialDate: Date | null;
  baseNumber: string;
  source: "CAIXA_JSON" | "EXTERNAL_COLLECTOR";
  raw: unknown;
};

export class CaixaLotteryError extends Error {
  constructor(message: string, public transient = true) {
    super(message);
    this.name = "CaixaLotteryError";
  }
}

export function isTransientCaixaHttpStatus(status: number) {
  return status === 404 || status === 408 || status === 429 || status >= 500;
}

function caixaRequestHeaders() {
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "accept-language": "pt-BR,pt;q=0.9",
    "cache-control": "no-cache",
    pragma: "no-cache",
    referer: "https://loterias.caixa.gov.br/",
    "user-agent": env.caixaLotteryUserAgent
  };
  if (env.caixaLotteryRelayToken) {
    headers["x-caixa-relay-token"] = env.caixaLotteryRelayToken;
  }
  return headers;
}

export function normalizeCaixaModality(value?: string | null) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") as CaixaModality;
}

export function isAllowedCaixaModality(value?: string | null): value is CaixaModality {
  return CAIXA_LOTTERY_MODALITIES.includes(normalizeCaixaModality(value));
}

export function isSupportedRaffleCaixaModality(value?: string | null) {
  return SUPPORTED_RAFFLE_CAIXA_MODALITIES.includes(normalizeCaixaModality(value) as (typeof SUPPORTED_RAFFLE_CAIXA_MODALITIES)[number]);
}

export function getSaoPauloDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function dateFromBrazilianDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day, 15, 0, 0));
}

function parseOfficialDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return { dateKey: "", date: null };
  const trimmed = value.trim();
  const br = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) {
    const dateKey = `${br[3]}-${br[2]}-${br[1]}`;
    return { dateKey, date: dateFromBrazilianDateKey(dateKey) };
  }
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const dateKey = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return { dateKey, date: dateFromBrazilianDateKey(dateKey) };
  }
  return { dateKey: "", date: null };
}

function firstStringFromArray(value: unknown) {
  if (!Array.isArray(value)) return "";
  const first = value.find((item) => typeof item === "string" && /\d/.test(item));
  return typeof first === "string" ? first : "";
}

function firstPrizeFromObjectArray(value: unknown) {
  if (!Array.isArray(value)) return "";
  const first = value[0];
  if (!first || typeof first !== "object") return "";
  const record = first as Record<string, unknown>;
  const candidates = [
    record.bilhete,
    record.numero,
    record.numeroBilhete,
    record.dezena,
    record.dezenaSorteada,
    record.numeroSorteado
  ];
  const found = candidates.find((item) => typeof item === "string" || typeof item === "number");
  return found === undefined ? "" : String(found);
}

export function extractFederalFirstPrizeBase(raw: unknown) {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const candidates = [
    firstStringFromArray(record.listaDezenas),
    firstStringFromArray(record.dezenasSorteadasOrdemSorteio),
    firstStringFromArray(record.listaDezenasOrdemSorteio),
    firstPrizeFromObjectArray(record.listaResultado),
    firstPrizeFromObjectArray(record.listaRateioPremio),
    firstPrizeFromObjectArray(record.premios)
  ];

  const rawNumber = candidates.find(Boolean);
  const digits = onlyDigits(rawNumber ?? "");
  if (!digits) throw new CaixaLotteryError("Primeiro premio da Loteria Federal nao encontrado na resposta da CAIXA.", false);
  return digits;
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function extractWinningDigits(baseNumber: string, digits: number) {
  if (!Number.isInteger(digits) || digits < 1 || digits > 8) {
    throw new CaixaLotteryError("Quantidade de digitos da rifa invalida para apuracao.", false);
  }
  const normalized = onlyDigits(baseNumber);
  if (!normalized) throw new CaixaLotteryError("Numero-base retornado pela CAIXA e invalido.", false);
  return normalized.padStart(digits, "0").slice(-digits);
}

export async function fetchCaixaLotteryResult(modalityInput: string, contestNumber?: string | null): Promise<CaixaLotteryResult> {
  const modality = normalizeCaixaModality(modalityInput);
  if (!isAllowedCaixaModality(modality)) throw new CaixaLotteryError("Modalidade da CAIXA invalida.", false);
  if (!isSupportedRaffleCaixaModality(modality)) {
    throw new CaixaLotteryError("Esta modalidade ainda nao possui regra de apuracao para rifas. Use Loteria Federal.", false);
  }

  const contestPath = contestNumber ? `/${encodeURIComponent(onlyDigits(contestNumber))}` : "";
  const url = `${env.caixaLotteryBaseUrl.replace(/\/$/, "")}/${modality}${contestPath}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.caixaLotteryTimeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: caixaRequestHeaders()
    });
    if (!response.ok) {
      const detail =
        response.status === 403
          ? "A CAIXA recusou a consulta automatica deste servidor (HTTP 403). O sistema interrompeu as repeticoes; tente novamente mais tarde."
          : `CAIXA retornou HTTP ${response.status}.`;
      throw new CaixaLotteryError(detail, isTransientCaixaHttpStatus(response.status));
    }

    const text = await response.text();
    if (!text.trim()) throw new CaixaLotteryError("CAIXA retornou resposta vazia.");

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new CaixaLotteryError("CAIXA retornou JSON invalido.");
    }

    const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const returnedContest = onlyDigits(String(data.numero ?? data.numeroConcurso ?? ""));
    const official = parseOfficialDate(data.dataApuracao ?? data.dataSorteio ?? data.dataResultado);
    const baseNumber = extractFederalFirstPrizeBase(raw);

    if (!returnedContest) throw new CaixaLotteryError("Numero do concurso ausente na resposta da CAIXA.", false);
    if (!official.dateKey) throw new CaixaLotteryError("Data oficial do concurso ausente na resposta da CAIXA.", false);

    return {
      modality,
      contestNumber: returnedContest,
      officialDateKey: official.dateKey,
      officialDate: official.date,
      baseNumber,
      source: "CAIXA_JSON",
      raw
    };
  } catch (error) {
    if (error instanceof CaixaLotteryError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new CaixaLotteryError("Tempo limite ao consultar a CAIXA.");
    }
    throw new CaixaLotteryError(error instanceof Error ? error.message : "Falha ao consultar a CAIXA.");
  } finally {
    clearTimeout(timeout);
  }
}
