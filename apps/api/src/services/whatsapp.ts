import type { Order, OrderItem, OrderItemComplement, Product, Customer, Setting } from "@prisma/client";
import { formatOrderCode } from "../utils/order-code.js";
import { sendHubWhatsappText } from "./hub-whatsapp.js";

type FullOrder = Order & {
  customer: Customer;
  items: Array<OrderItem & { product: Product; complements: OrderItemComplement[] }>;
};

function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function buildWhatsappMessage(order: FullOrder, setting: Setting) {
  const itemsText = order.items
    .map((item) => {
      const complements = item.complements
        .map((complement) =>
          `  + ${complement.quantity}x ${complement.name}${Number(complement.price) > 0 ? ` (${money(Number(complement.price))} cada)` : ""}`
        )
        .join("\n");
      return `${item.quantity}x ${item.product.name} - ${money(Number(item.total))}${complements ? `\n${complements}` : ""}`;
    })
    .join("\n");

  const lines = [
    `NOVO PEDIDO #${formatOrderCode(order.orderNumber)}`,
    "",
    `Cliente: ${order.customer.name}`,
    `Telefone: ${order.customer.phone}`,
    "",
    order.fulfillmentType === "PICKUP" ? "Tipo: Retirada na loja" : "Tipo: Entrega",
    ...(order.fulfillmentType === "PICKUP"
      ? []
      : [
          `${order.customer.address}, ${order.customer.number}`,
          `${order.customer.district}${order.customer.complement ? ` - ${order.customer.complement}` : ""}`
        ]),
    "",
    "Itens:",
    itemsText,
    "",
    `Subtotal: ${money(Number(order.subtotal))}`,
    `Taxa de entrega: ${money(Number(order.deliveryFee))}`,
    `Desconto: ${money(Number(order.discount))}`,
    `Total: ${money(Number(order.total))}`,
    "",
    `Pagamento: ${order.paymentMethod}`,
    order.changeFor ? `Troco para: ${money(Number(order.changeFor))}` : ""
  ].filter(Boolean);

  const message = lines.join("\n");
  const phone = setting.whatsappNumber.replace(/\D/g, "");

  return {
    message,
    url: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
  };
}

const statusLabels: Record<string, string> = {
  RECEIVED: "Recebido",
  PREPARING: "Em preparo",
  OUT_FOR_DELIVERY: "Saiu para entrega",
  DELIVERED: "Entregue",
  FINISHED: "Finalizado",
  CANCELED: "Cancelado",
  PAYMENT_CONFIRMED: "Pagamento confirmado"
};

export function buildOrderStatusWhatsappMessage(phoneRaw: string, customerName: string, status: string, setting: Setting) {
  const phone = phoneRaw.replace(/\D/g, "");
  const label = statusLabels[status] ?? status;
  const message = [
    `Ola, ${customerName}!`,
    `Seu pedido foi atualizado para: ${label}.`,
    "Qualquer duvida estamos a disposicao.",
    setting.companyName
  ].join("\n");

  return {
    message,
    url: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
  };
}

type SendResult = {
  ok: boolean;
  channel: "EVOLUTION" | "WHATSAPP_LINK";
  whatsappUrl?: string;
  error?: string;
};

function buildWhatsappLink(phoneRaw: string, message: string) {
  const phone = phoneRaw.replace(/\D/g, "");
  return {
    ok: true,
    channel: "WHATSAPP_LINK" as const,
    whatsappUrl: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
  };
}

export async function dispatchWhatsappMessage(
  settings: Setting,
  toPhoneRaw: string,
  message: string,
  fallbackPhoneRaw?: string
): Promise<SendResult> {
  try {
    await sendHubWhatsappText(settings.companyId, toPhoneRaw.replace(/\D/g, ""), message);
    return { ok: true, channel: "EVOLUTION" };
  } catch (error) {
    const fallback = buildWhatsappLink(fallbackPhoneRaw ?? toPhoneRaw, message);
    return {
      ...fallback,
      error: error instanceof Error ? error.message : "Falha ao enviar pelo Evolution"
    };
  }
}
