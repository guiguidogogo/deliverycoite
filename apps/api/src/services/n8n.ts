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

export async function dispatchN8nEvent(
  companyId: string,
  event: N8nEventName,
  payload: Record<string, unknown>
) {
  const settings = await prisma.setting.findFirst({
    where: { companyId },
    select: { n8nEnabled: true, n8nWebhookUrl: true, n8nSecret: true, companyName: true }
  });

  if (!settings?.n8nEnabled || !settings.n8nWebhookUrl) {
    return { ok: false, skipped: true, reason: "n8n_disabled" as const };
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
