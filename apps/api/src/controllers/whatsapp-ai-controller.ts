import type { Request, Response } from "express";
import { env } from "../utils/env.js";
import { sendHubWhatsappText } from "../services/hub-whatsapp.js";

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function messageText(data: Record<string, unknown>) {
  const message = (data.message ?? {}) as Record<string, unknown>;
  const extended = (message.extendedTextMessage ?? {}) as Record<string, unknown>;
  const image = (message.imageMessage ?? {}) as Record<string, unknown>;
  return String(message.conversation ?? extended.text ?? image.caption ?? "").trim();
}

async function askOllama(text: string) {
  const response = await fetch(`${env.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: env.ollamaModel,
      stream: false,
      messages: [
        { role: "system", content: "Você é a atendente virtual da Yasmim Lanches. Responda em português brasileiro, com simpatia e objetividade. Informe que é uma atendente virtual. Não invente preços, disponibilidade, prazo ou promoções. Se a pergunta exigir confirmação, diga que vai encaminhar para a equipe. Ainda não registre pedidos." },
        { role: "user", content: text }
      ],
      options: { temperature: 0.2 }
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Ollama respondeu ${response.status}`);
  const payload = await response.json() as { message?: { content?: string } };
  return String(payload.message?.content ?? "").trim().slice(0, 1500);
}

export async function whatsappAiWebhook(req: Request, res: Response) {
  if (!env.whatsappAiEnabled) return res.status(202).json({ ignored: true, reason: "disabled" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const routeEvent = String(req.params.event ?? "").replace(/[.-]/g, "_").toUpperCase();
  const bodyEvent = String(body.event ?? "").replace(/[.-]/g, "_").toUpperCase();
  if ((routeEvent || bodyEvent) !== "MESSAGES_UPSERT") return res.status(202).json({ ignored: true, reason: "event" });
  const data = (body.data ?? {}) as Record<string, unknown>;
  const key = (data.key ?? {}) as Record<string, unknown>;
  if (Boolean(key.fromMe) || String(key.remoteJid ?? "").endsWith("@g.us")) return res.status(202).json({ ignored: true, reason: "outgoing_or_group" });
  const phone = digits(key.remoteJidAlt ?? key.remoteJid).replace(/^55(?=\d{10,11}$)/, "55");
  if (!env.whatsappAiAllowedPhones.includes(phone)) return res.status(202).json({ ignored: true, reason: "phone" });
  const text = messageText(data);
  if (!text || !env.whatsappAiTenantId) return res.status(202).json({ ignored: true, reason: text ? "tenant" : "empty" });
  const reply = await askOllama(text);
  if (!reply) return res.status(202).json({ ignored: true, reason: "empty_reply" });
  await sendHubWhatsappText(env.whatsappAiTenantId, phone, reply, `ai_${String(key.id ?? Date.now())}`);
  return res.status(202).json({ accepted: true, phone });
}


