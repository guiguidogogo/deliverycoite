import { createHash, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { Prisma, WhatsappConversationState, WhatsappMessageActor } from "@prisma/client";
import { z } from "zod";
import { env } from "../utils/env.js";
import { prisma } from "../utils/prisma.js";
import { sendHubWhatsappText } from "../services/hub-whatsapp.js";

const intentSchema = z.object({
  intent: z.enum(["GREETING", "SHOW_MENU", "SHOW_CATEGORY", "SEARCH_PRODUCT", "PRODUCT_DETAILS", "ADD_TO_CART", "REMOVE_FROM_CART", "CHANGE_QUANTITY", "VIEW_CART", "CLEAR_CART", "CHECKOUT", "SEND_LOCATION", "SELECT_PAYMENT", "CONFIRM_ORDER", "CANCEL_ORDER", "ORDER_STATUS", "HUMAN_SUPPORT", "UNKNOWN"]),
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(120).optional(),
  quantity: z.number().int().min(1).max(99).optional(),
  confidence: z.number().min(0).max(1).optional()
});
type Intent = z.infer<typeof intentSchema>;

function digits(value: unknown) { return String(value ?? "").replace(/\D/g, ""); }
function safeEqual(left: string, right: string) {
  return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
}
function messageText(data: Record<string, unknown>) {
  const message = (data.message ?? {}) as Record<string, unknown>;
  const extended = (message.extendedTextMessage ?? {}) as Record<string, unknown>;
  const image = (message.imageMessage ?? {}) as Record<string, unknown>;
  return String(message.conversation ?? extended.text ?? image.caption ?? "").trim();
}
function extractInput(body: Record<string, unknown>, routeEvent: string) {
  const data = (body.data ?? {}) as Record<string, unknown>;
  const key = (data.key ?? {}) as Record<string, unknown>;
  const normalized = (body.message ?? {}) as Record<string, unknown>;
  return {
    companyId: String(body.tenantId ?? body.tenant_id ?? body.companyId ?? env.whatsappAiTenantId).trim(),
    eventType: String(body.event ?? routeEvent ?? "MESSAGES_UPSERT").replace(/[.-]/g, "_").toUpperCase(),
    externalId: String(body.messageId ?? body.externalId ?? key.id ?? "").trim(),
    phone: digits(body.phone ?? normalized.phone ?? key.remoteJidAlt ?? key.remoteJid),
    text: String(body.text ?? normalized.text ?? messageText(data)).trim(),
    fromMe: Boolean(body.fromMe ?? key.fromMe),
    isGroup: Boolean(body.isGroup ?? String(key.remoteJid ?? "").endsWith("@g.us"))
  };
}
function parseModelJson(content: string): Intent {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
  return intentSchema.parse(JSON.parse(candidate));
}
async function classifyIntent(text: string): Promise<Intent> {
  if (/\b(atendente|pessoa|humano|humana|não quero falar com rob[oô]|chama algu[eé]m)\b/i.test(text)) return { intent: "HUMAN_SUPPORT", confidence: 1 };
  const response = await fetch(`${env.ollamaUrl}/api/chat`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: env.ollamaModel, stream: false, format: "json",
      messages: [
        { role: "system", content: `Classifique mensagens de clientes de um delivery. Responda somente JSON válido com intent, search, category, quantity e confidence. Intents: ${intentSchema.shape.intent.options.join(", ")}. Nunca invente produtos, preços, disponibilidade, desconto, pagamento ou prazo. Use search apenas com o nome citado.` },
        { role: "user", content: text }
      ], options: { temperature: 0 }
    }), signal: AbortSignal.timeout(env.ollamaTimeoutMs)
  });
  if (!response.ok) throw new Error(`Ollama respondeu ${response.status}`);
  const payload = await response.json() as { message?: { content?: string } };
  return parseModelJson(String(payload.message?.content ?? ""));
}
function money(value: Prisma.Decimal | number) {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
async function realMenuReply(companyId: string, intent: Intent) {
  if (intent.intent === "GREETING") {
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { tradeName: true, companyName: true } });
    return `Olá! 👋 Bem-vindo à ${company?.tradeName || company?.companyName || "nossa loja"}. Posso mostrar o cardápio ou procurar um produto para você.`;
  }
  if (intent.intent === "SHOW_MENU" || intent.intent === "SHOW_CATEGORY") {
    const categories = await prisma.category.findMany({
      where: { companyId, active: true, ...(intent.category ? { name: { contains: intent.category, mode: "insensitive" } } : {}) },
      orderBy: { name: "asc" }, include: { products: { where: { active: true, available: true }, orderBy: { name: "asc" }, take: 8 } }
    });
    if (!categories.length) return intent.category ? `Não encontrei a categoria “${intent.category}” no cardápio.` : "O cardápio não possui itens disponíveis no momento.";
    return categories.map((category) => `*${category.name}*\n${category.products.map((product) => `• ${product.name} — ${money(product.promoPrice ?? product.price)}`).join("\n") || "Sem itens disponíveis"}`).join("\n\n");
  }
  if (["SEARCH_PRODUCT", "PRODUCT_DETAILS", "ADD_TO_CART"].includes(intent.intent)) {
    const search = intent.search?.trim();
    if (!search) return "Qual produto você gostaria de procurar?";
    const products = await prisma.product.findMany({ where: { companyId, active: true, name: { contains: search, mode: "insensitive" } }, orderBy: { name: "asc" }, take: 6, select: { name: true, description: true, price: true, promoPrice: true, available: true } });
    if (!products.length) return `Não encontrei “${search}” no cardápio. Posso mostrar as categorias disponíveis.`;
    if (products.length > 1) return `Encontrei estas opções:\n${products.map((p, index) => `${index + 1}. ${p.name} — ${money(p.promoPrice ?? p.price)}${p.available ? "" : " (esgotado)"}`).join("\n")}\n\nQual você prefere?`;
    const product = products[0];
    if (!product.available) return `${product.name} está esgotado no momento.`;
    if (intent.intent === "ADD_TO_CART") return `${product.name} foi encontrado por ${money(product.promoPrice ?? product.price)}. A montagem do carrinho será liberada na próxima etapa da integração.`;
    return `*${product.name}*\n${product.description}\n${money(product.promoPrice ?? product.price)}`;
  }
  if (intent.intent === "HUMAN_SUPPORT") return "Certo. Vou chamar uma pessoa da equipe para continuar seu atendimento.";
  return "Ainda não consegui entender com segurança. Você pode pedir o cardápio, procurar um produto ou solicitar um atendente.";
}

export async function whatsappAiWebhook(req: Request, res: Response) {
  if (!env.whatsappAiEnabled) return res.status(202).json({ ignored: true, reason: "disabled" });
  if (env.automationApiKey && !safeEqual(String(req.headers["x-automation-key"] ?? ""), env.automationApiKey)) return res.status(401).json({ message: "Automação não autorizada" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const input = extractInput(body, String(req.params.event ?? ""));
  if (input.eventType !== "MESSAGES_UPSERT") return res.status(202).json({ ignored: true, reason: "event" });
  if (input.fromMe || input.isGroup) return res.status(202).json({ ignored: true, reason: "outgoing_or_group" });
  if (!input.companyId || !input.externalId || !input.phone || !input.text) return res.status(400).json({ message: "tenantId, messageId, phone e text são obrigatórios" });
  if (env.whatsappAiAllowedPhones.length && !env.whatsappAiAllowedPhones.includes(input.phone)) return res.status(202).json({ ignored: true, reason: "phone" });
  const company = await prisma.company.findFirst({ where: { id: input.companyId, active: true }, select: { id: true } });
  if (!company) return res.status(404).json({ message: "Estabelecimento não encontrado" });
  const payloadHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  try { await prisma.whatsappWebhookEvent.create({ data: { companyId: input.companyId, externalId: input.externalId, eventType: input.eventType, payloadHash } }); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return res.status(202).json({ ignored: true, reason: "duplicate" });
    throw error;
  }
  const customer = await prisma.customer.findFirst({ where: { companyId: input.companyId, phone: input.phone, deletedAt: null }, select: { id: true } });
  const conversation = await prisma.whatsappConversation.upsert({ where: { companyId_phone: { companyId: input.companyId, phone: input.phone } }, create: { companyId: input.companyId, customerId: customer?.id, phone: input.phone }, update: { customerId: customer?.id, lastMessageAt: new Date() } });
  await prisma.whatsappConversationMessage.create({ data: { companyId: input.companyId, conversationId: conversation.id, actor: WhatsappMessageActor.CUSTOMER, body: input.text } });
  if (conversation.humanSupport || conversation.state === WhatsappConversationState.HUMAN_SUPPORT) return res.status(202).json({ accepted: true, humanSupport: true });
  let intent: Intent;
  try { intent = await classifyIntent(input.text); } catch { intent = { intent: "UNKNOWN", confidence: 0 }; }
  const reply = await realMenuReply(input.companyId, intent);
  const humanSupport = intent.intent === "HUMAN_SUPPORT";
  await prisma.$transaction([
    prisma.whatsappConversation.update({ where: { id: conversation.id }, data: { humanSupport, state: humanSupport ? WhatsappConversationState.HUMAN_SUPPORT : intent.intent === "SHOW_MENU" ? WhatsappConversationState.BROWSING_MENU : conversation.state, lastMessageAt: new Date() } }),
    prisma.whatsappConversationMessage.create({ data: { companyId: input.companyId, conversationId: conversation.id, actor: WhatsappMessageActor.AI, body: reply, intent: intent.intent, metadata: intent } })
  ]);
  if (env.whatsappAiSendDirect) await sendHubWhatsappText(input.companyId, input.phone, reply, `ai_${input.externalId}`);
  return res.status(202).json({ accepted: true, tenantId: input.companyId, phone: input.phone, intent: intent.intent, reply, dispatchRequired: !env.whatsappAiSendDirect, humanSupport });
}
