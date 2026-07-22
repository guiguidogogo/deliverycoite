import type { Request, Response } from "express";
import { env } from "../utils/env.js";
import {
  ingestLotteryResult,
  verifyLotteryWebhookSignature
} from "../services/lottery-result-webhook-service.js";

export async function receiveLotteryResult(req: Request, res: Response) {
  if (!env.lotteryCollectorWebhookEnabled) {
    return res.status(503).json({ message: "Webhook do coletor desativado neste ambiente." });
  }
  if (env.lotteryWebhookSecret.length < 32) {
    return res.status(503).json({ message: "Segredo do webhook nao configurado com seguranca." });
  }
  if (!Buffer.isBuffer(req.body)) {
    return res.status(400).json({ message: "Corpo bruto do webhook nao foi preservado." });
  }

  const timestamp = req.header("x-lottery-timestamp") ?? undefined;
  const signature = req.header("x-lottery-signature") ?? undefined;
  const verification = verifyLotteryWebhookSignature({
    rawBody: req.body,
    timestamp,
    signature,
    secret: env.lotteryWebhookSecret,
    maxAgeSeconds: env.lotteryWebhookMaxAgeSeconds
  });
  if (!verification.ok) {
    return res.status(401).json({ message: `Webhook rejeitado: ${verification.reason}.` });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.status(400).json({ message: "JSON invalido." });
  }

  const eventIdHeader = req.header("x-lottery-event-id");
  const eventIdBody = payload && typeof payload === "object" && "eventId" in payload
    ? String(payload.eventId)
    : "";
  if (!eventIdHeader || eventIdHeader !== eventIdBody) {
    return res.status(422).json({ message: "X-Lottery-Event-Id nao corresponde ao payload." });
  }

  const result = await ingestLotteryResult(req.body, payload);
  return res.status(result.duplicate ? 200 : 201).json({ ok: true, ...result });
}
