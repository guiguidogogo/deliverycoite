import { prisma } from "../utils/prisma.js";

export type N8nEventName =
  | "order.created"
  | "order.paid"
  | "order.status_changed"
  | "table.session.created"
  | "table.session.closed"
  | "customer.created"
  | "event.ticket_order.created"
  | "event.ticket_order.paid";

const EVENT_FLAGS: Record<N8nEventName, string> = {
  "order.created": "n8nEventsOrderCreated",
  "order.paid": "n8nEventsOrderPaid",
  "order.status_changed": "n8nEventsOrderStatusChanged",
  "table.session.created": "n8nEventsTableSession",
  "table.session.closed": "n8nEventsTableSession",
  "customer.created": "n8nEventsCustomerCreated",
  "event.ticket_order.created": "n8nEventsTicketOrder",
  "event.ticket_order.paid": "n8nEventsTicketOrder"
} as const;

export async function dispatchN8nEvent(
  companyId: string,
  event: N8nEventName,
  payload: Record<string, unknown>
) {
  const settings = await prisma.setting.findFirst({
    where: { companyId },
    select: {
      n8nEnabled: true,
      n8nWebhookUrl: true,
      n8nSecret: true,
      companyName: true,
      n8nEventsOrderCreated: true,
      n8nEventsOrderPaid: true,
      n8nEventsOrderStatusChanged: true,
      n8nEventsTableSession: true,
      n8nEventsCustomerCreated: true,
      n8nEventsTicketOrder: true
    }
  });

  if (!settings?.n8nEnabled || !settings.n8nWebhookUrl) {
    return { ok: false, skipped: true, reason: "n8n_disabled" as const };
  }

  if (!settings[EVENT_FLAGS[event] as keyof typeof settings]) {
    return { ok: false, skipped: true, reason: "event_disabled" as const };
  }

  const response = await fetch(settings.n8nWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(settings.n8nSecret ? { "X-HubRegional-N8N-Secret": settings.n8nSecret } : {})
    },
    body: JSON.stringify({
      source: "hubregional",
      event,
      companyId,
      companyName: settings.companyName,
      occurredAt: new Date().toISOString(),
      payload
    })
  });

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    return {
      ok: false,
      skipped: false,
      status: response.status,
      error: text || "Falha ao enviar evento para n8n"
    };
  }

  return { ok: true, skipped: false, status: response.status, response: text || null };
}
