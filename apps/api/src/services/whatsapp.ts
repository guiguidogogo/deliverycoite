import type { Order, OrderItem, OrderItemComplement, Product, Customer, Setting } from "@prisma/client";
import { formatOrderCode } from "../utils/order-code.js";

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
  channel: "MENUAI" | "WHATSAPP_LINK";
  whatsappUrl?: string;
  error?: string;
};

function resolveMenuiaCredentials(settings: Setting) {
  const authkey = settings.menuiaApiKey?.trim() ?? "";
  const appkey = settings.menuiaStoreId?.trim() ?? "";
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  // Some installations stored the two fields inverted. Menuia APPKEY is a UUID.
  if (uuidPattern.test(authkey) && !uuidPattern.test(appkey)) {
    return { authkey: appkey, appkey: authkey };
  }

  return { authkey, appkey };
}

async function sendByMenuia(settings: Setting, toPhoneRaw: string, message: string) {
  const credentials = resolveMenuiaCredentials(settings);
  if (!credentials.authkey || !credentials.appkey) {
    return { ok: false, error: "Credenciais Menuia ausentes" };
  }

  const toPhone = toPhoneRaw.replace(/\D/g, "");
  const configuredBase = process.env.MENUIA_API_BASE_URL?.trim()
    || "https://chatbot.menuia.com";

  let base: string;
  try {
    base = new URL(configuredBase).toString().replace(/\/$/, "");
  } catch {
    return { ok: false, error: "MENUIA_API_BASE_URL invalida" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(`${base}/api/create-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        appkey: credentials.appkey,
        authkey: credentials.authkey,
        to: toPhone,
        message,
        licence: process.env.MENUIA_LICENSE?.trim() || "hugocursos"
      }),
      signal: controller.signal
    });

    const text = await res.text().catch(() => "");
    if (res.ok) {
      return { ok: true };
    }

    return { ok: false, error: `Menuia ${res.status}: ${text || "sem detalhe"}` };
  } catch (error) {
    if (error instanceof Error) {
      const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
      return { ok: false, error: `${error.name}: ${error.message}${cause}` };
    }

    return { ok: false, error: "Erro de conexao com Menuia" };
  } finally {
    clearTimeout(timeout);
  }
}

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
  const canUseMenuia = Boolean(settings.menuiaEnabled && settings.menuiaApiKey && settings.menuiaStoreId);

  if (canUseMenuia) {
    const sent = await sendByMenuia(settings, toPhoneRaw, message);
    if (sent.ok) {
      return { ok: true, channel: "MENUAI" };
    }

    const fallbackPhone = (fallbackPhoneRaw ?? toPhoneRaw).replace(/\D/g, "");
    if (fallbackPhone) {
      return {
        ...buildWhatsappLink(fallbackPhoneRaw ?? toPhoneRaw, message),
        error: sent.error
      };
    }
  }

  return buildWhatsappLink(fallbackPhoneRaw ?? toPhoneRaw, message);
}
