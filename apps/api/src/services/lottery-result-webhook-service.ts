import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  type CaixaLotteryResult,
  isSupportedRaffleCaixaModality,
  normalizeCaixaModality
} from "./caixa-lottery-service.js";
import { processAutomaticRafflesFromResult } from "./raffle-draw-service.js";
import { prisma } from "../utils/prisma.js";

const digitString = z.union([z.string(), z.number().int().nonnegative()])
  .transform((value) => String(value).trim())
  .refine((value) => /^\d+$/.test(value), "O valor deve conter somente digitos.");

export const lotteryResultWebhookSchema = z.object({
  eventId: z.string().trim().min(3).max(120),
  schemaVersion: z.literal(1),
  modality: z.string().trim().min(1).max(40),
  contest: digitString,
  drawDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data oficial invalida."),
  prizes: z.array(digitString).length(5, "A Loteria Federal deve possuir cinco premios."),
  firstPrize: digitString,
  source: z.enum(["CAIXA_JSON", "CAIXA_XLSX"]),
  fetchedAt: z.string().datetime({ offset: true })
}).strict();

export type LotteryResultWebhookPayload = z.infer<typeof lotteryResultWebhookSchema>;

export type LotteryWebhookVerification =
  | { ok: true }
  | { ok: false; reason: "missing" | "timestamp" | "expired" | "signature" };

export function signLotteryWebhookBody(rawBody: Buffer | string, timestamp: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(timestamp).update(".").update(rawBody).digest("hex")}`;
}

export function verifyLotteryWebhookSignature(input: {
  rawBody: Buffer;
  timestamp?: string;
  signature?: string;
  secret: string;
  maxAgeSeconds: number;
  nowSeconds?: number;
}): LotteryWebhookVerification {
  if (!input.timestamp || !input.signature) return { ok: false, reason: "missing" };
  if (!/^\d+$/.test(input.timestamp)) return { ok: false, reason: "timestamp" };

  const timestamp = Number(input.timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(timestamp)) return { ok: false, reason: "timestamp" };
  if (Math.abs(now - timestamp) > input.maxAgeSeconds) return { ok: false, reason: "expired" };

  const expected = signLotteryWebhookBody(input.rawBody, input.timestamp, input.secret);
  const receivedBuffer = Buffer.from(input.signature);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length) return { ok: false, reason: "signature" };
  return timingSafeEqual(receivedBuffer, expectedBuffer)
    ? { ok: true }
    : { ok: false, reason: "signature" };
}

function officialDateFromKey(dateKey: string) {
  const date = new Date(`${dateKey}T15:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateKey) {
    throw Object.assign(new Error("Data oficial invalida."), { statusCode: 422 });
  }
  return date;
}

function assertPayloadSemantics(payload: LotteryResultWebhookPayload) {
  const modality = normalizeCaixaModality(payload.modality);
  if (!isSupportedRaffleCaixaModality(modality)) {
    throw Object.assign(new Error("Modalidade nao suportada para apuracao de rifas."), { statusCode: 422 });
  }
  if (payload.eventId !== `${modality}:${payload.contest}`) {
    throw Object.assign(new Error("eventId nao corresponde a modalidade e ao concurso."), { statusCode: 422 });
  }
  if (payload.firstPrize !== payload.prizes[0]) {
    throw Object.assign(new Error("O primeiro premio deve ser igual ao primeiro item de prizes."), { statusCode: 422 });
  }
  return modality;
}

function sameStoredResult(
  existing: { officialDateKey: string; firstPrize: string; prizes: Prisma.JsonValue },
  payload: LotteryResultWebhookPayload
) {
  return existing.officialDateKey === payload.drawDate
    && existing.firstPrize === payload.firstPrize
    && JSON.stringify(existing.prizes) === JSON.stringify(payload.prizes);
}

export async function ingestLotteryResult(rawBody: Buffer, payloadInput: unknown) {
  const payload = lotteryResultWebhookSchema.parse(payloadInput);
  const modality = assertPayloadSemantics(payload);
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  const officialDate = officialDateFromKey(payload.drawDate);

  let created = false;
  let inbox = await prisma.lotteryResultInbox.findFirst({
    where: {
      OR: [
        { eventId: payload.eventId },
        { modality, contestNumber: payload.contest }
      ]
    }
  });

  if (inbox && !sameStoredResult(inbox, payload)) {
    throw Object.assign(new Error("O concurso ja existe com dados diferentes. Exige conferencia manual."), { statusCode: 409 });
  }

  if (!inbox) {
    try {
      inbox = await prisma.lotteryResultInbox.create({
        data: {
          eventId: payload.eventId,
          schemaVersion: payload.schemaVersion,
          modality,
          contestNumber: payload.contest,
          officialDateKey: payload.drawDate,
          officialDate,
          prizes: payload.prizes,
          firstPrize: payload.firstPrize,
          source: payload.source,
          fetchedAt: new Date(payload.fetchedAt),
          payloadHash,
          rawPayload: payload as Prisma.InputJsonValue
        }
      });
      created = true;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      inbox = await prisma.lotteryResultInbox.findFirstOrThrow({
        where: {
          OR: [
            { eventId: payload.eventId },
            { modality, contestNumber: payload.contest }
          ]
        }
      });
      if (!sameStoredResult(inbox, payload)) {
        throw Object.assign(new Error("O concurso foi recebido simultaneamente com dados diferentes."), { statusCode: 409 });
      }
    }
  }

  const result: CaixaLotteryResult = {
    modality,
    contestNumber: payload.contest,
    officialDateKey: payload.drawDate,
    officialDate,
    baseNumber: payload.firstPrize,
    source: "EXTERNAL_COLLECTOR",
    raw: payload
  };

  try {
    const summary = await processAutomaticRafflesFromResult(result);
    await prisma.lotteryResultInbox.update({
      where: { id: inbox.id },
      data: { processedAt: new Date(), processingError: null }
    });
    return { inboxId: inbox.id, duplicate: !created, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao processar rifas vinculadas ao resultado.";
    await prisma.lotteryResultInbox.update({
      where: { id: inbox.id },
      data: { processingError: message.slice(0, 1000) }
    });
    throw error;
  }
}
