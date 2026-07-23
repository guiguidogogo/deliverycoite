import type { Setting } from "@prisma/client";
import { dispatchWhatsappMessage } from "./whatsapp.js";
import { prisma } from "../utils/prisma.js";

function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function buildMessage(order: {
  participant: { name: string; phone: string };
  raffle: { title: string; drawScheduledAt: Date | null };
  items: Array<{ formattedNumber: string }>;
  total: { toString(): string };
}, settings: Setting) {
  return [
    `Ola, ${order.participant.name}!`,
    `Sua reserva da rifa ${order.raffle.title} ainda aguarda pagamento.`,
    `Numero(s): ${order.items.map((item) => item.formattedNumber).join(", ")}.`,
    `Valor: ${money(Number(order.total))}.`,
    order.raffle.drawScheduledAt ? `Sorteio: ${order.raffle.drawScheduledAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.` : "",
    settings.pixKey ? `Chave Pix: ${settings.pixKey}` : "Solicite a chave Pix ao responsavel pela rifa.",
    "Depois do pagamento, envie o comprovante para confirmarmos seus numeros."
  ].filter(Boolean).join("\n");
}

export async function sendRafflePaymentReminderById(orderId: string) {
  const order = await prisma.raffleOrder.findUnique({
    where: { id: orderId },
    include: { participant: true, raffle: true, items: { orderBy: { number: "asc" } } }
  });
  if (!order || order.paymentStatus !== "PENDING" || !["RESERVED", "PENDING_PAYMENT"].includes(order.status)) {
    return { sent: false, message: "Pedido nao esta pendente." };
  }
  const settings = await prisma.setting.findFirst({ where: { companyId: order.companyId } });
  if (!settings) return { sent: false, message: "Configuracoes da empresa nao encontradas." };
  const message = buildMessage(order, settings);
  const result = await dispatchWhatsappMessage(settings, order.participant.phone, message, order.participant.phone);
  const sent = result.channel === "MENUAI" && result.ok;
  await prisma.raffleOrder.update({
    where: { id: order.id },
    data: {
      paymentReminderAttemptedAt: new Date(),
      paymentReminderSentAt: sent ? new Date() : null,
      paymentReminderStatus: sent ? "SENT" : "MANUAL_REQUIRED",
      paymentReminderError: sent ? null : (result.error ?? "Menuia nao configurada; envio manual necessario")
    }
  });
  return { sent, whatsappUrl: result.whatsappUrl ?? null, message };
}

export async function processDueRafflePaymentReminders(limit = 100) {
  const now = new Date();
  const oneDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const retryBefore = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const orders = await prisma.raffleOrder.findMany({
    where: {
      paymentStatus: "PENDING",
      status: { in: ["RESERVED", "PENDING_PAYMENT"] },
      raffle: { drawScheduledAt: { gt: now, lte: oneDay } },
      paymentReminderSentAt: null,
      OR: [{ paymentReminderAttemptedAt: null }, { paymentReminderAttemptedAt: { lte: retryBefore } }]
    },
    select: { id: true },
    take: limit
  });
  let sent = 0;
  for (const order of orders) {
    const result = await sendRafflePaymentReminderById(order.id);
    if (result.sent) sent += 1;
  }
  return { processed: orders.length, sent };
}
