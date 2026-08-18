import { env } from "../utils/env.js";

type GatewayErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

export type HubWhatsappStatus = {
  connected: boolean;
  status: "connected" | "connecting" | "reconnecting" | "disconnected" | "qr_required" | "logged_out" | "error";
  phone?: string | null;
  profile_name?: string | null;
  profile_picture_url?: string | null;
};

export type HubWhatsappQrCode = {
  status: "qr_required";
  qr_code?: string;
  pairing_code?: string;
};

export class HubWhatsappError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = "HubWhatsappError";
  }
}

export function isHubWhatsappConfigured() {
  return Boolean(env.hubWhatsappUrl && env.hubWhatsappKey);
}

function gatewayUrl(path: string) {
  if (!isHubWhatsappConfigured()) {
    throw new HubWhatsappError(503, "A integracao central do WhatsApp ainda nao foi configurada");
  }
  return `${env.hubWhatsappUrl}${path}`;
}

async function gatewayRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.hubWhatsappTimeoutMs);

  try {
    const response = await fetch(gatewayUrl(path), {
      ...init,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-hub-api-key": env.hubWhatsappKey,
        ...init.headers
      }
    });
    const payload = await response.json().catch(() => ({})) as GatewayErrorPayload & T;

    if (!response.ok) {
      throw new HubWhatsappError(
        response.status,
        payload.error?.message ?? "Falha na integracao central do WhatsApp",
        payload.error?.code
      );
    }

    return payload;
  } catch (error) {
    if (error instanceof HubWhatsappError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new HubWhatsappError(504, "O servico central do WhatsApp demorou para responder");
    }
    throw new HubWhatsappError(502, "O servico central do WhatsApp esta indisponivel");
  } finally {
    clearTimeout(timeout);
  }
}

function tenantPath(tenantId: string, suffix: string) {
  return `/api/v1/whatsapp/instances/${encodeURIComponent(tenantId)}${suffix}`;
}

export function registerHubWhatsappTenant(tenantId: string, name: string) {
  return gatewayRequest<{ id: string; name: string; active: boolean }>("/api/v1/tenants", {
    method: "POST",
    body: JSON.stringify({ external_tenant_id: tenantId, name })
  });
}

export function createHubWhatsappInstance(tenantId: string) {
  return gatewayRequest<{ tenant_id: string; instance_id: string; status: string }>("/api/v1/whatsapp/instances", {
    method: "POST",
    body: JSON.stringify({ tenant_id: tenantId })
  });
}

export function getHubWhatsappStatus(tenantId: string) {
  return gatewayRequest<HubWhatsappStatus>(tenantPath(tenantId, "/status"));
}

export function getHubWhatsappQrCode(tenantId: string) {
  return gatewayRequest<HubWhatsappQrCode>(tenantPath(tenantId, "/qrcode"));
}

export function reconnectHubWhatsapp(tenantId: string) {
  return gatewayRequest<{ status: string; requires_qr: boolean }>(tenantPath(tenantId, "/reconnect"), {
    method: "POST",
    body: "{}"
  });
}

export function logoutHubWhatsapp(tenantId: string) {
  return gatewayRequest<void>(tenantPath(tenantId, "/logout"), {
    method: "POST",
    body: "{}"
  });
}

export function sendHubWhatsappTest(tenantId: string, to: string, message: string) {
  return gatewayRequest<{ job_id: string; status: string }>("/api/v1/whatsapp/send/text", {
    method: "POST",
    headers: { "idempotency-key": `test_${crypto.randomUUID().replace(/-/g, "")}` },
    body: JSON.stringify({ tenant_id: tenantId, to, message })
  });
}
