import { config } from "../../config.js";
import { HttpError, logger } from "../../lib.js";
import type { ProviderStatus, WhatsAppProvider } from "../whatsapp-provider.js";

export function isEvolutionInstanceMissing(error: unknown) {
  return isEvolutionProviderStatus(error, 404);
}

function isEvolutionProviderStatus(error: unknown, status: number) {
  if (!(error instanceof HttpError) || error.code !== "provider_error") return false;
  const details = error.details;
  return Boolean(details && typeof details === "object" && "providerStatus" in details && details.providerStatus === status);
}

function providerMessage(data: any) {
  const value = data?.response?.message ?? data?.message ?? data?.error;
  if (typeof value === "string") return value.slice(0, 300);
  if (value !== undefined) {
    try {
      return JSON.stringify(value).slice(0, 500);
    } catch {
      return String(value).slice(0, 300);
    }
  }
  return undefined;
}

function brazilianLegacyNumber(number: string) {
  return /^55\d{2}9\d{8}$/.test(number) ? `${number.slice(0, 4)}${number.slice(5)}` : null;
}

export function normalizeWhatsappNumber(number: string) {
  const digits = number.replace(/\D/g, "");
  // Os cadastros brasileiros da loja normalmente guardam somente DDD + telefone.
  // A Evolution exige o DDI para montar o JID do destinatario.
  if (/^\d{10,11}$/.test(digits)) return `55${digits}`;
  return digits;
}

export class EvolutionProvider implements WhatsAppProvider {
  private async request(path: string, init: RequestInit = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.EVOLUTION_TIMEOUT_MS);
    try {
      const response = await fetch(`${config.EVOLUTION_API_URL}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { "content-type": "application/json", apikey: config.EVOLUTION_API_KEY, ...init.headers }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = providerMessage(data);
        logger.warn({ provider: "evolution", path, status: response.status, providerMessage: message }, "Evolution request failed");
        throw new HttpError(502, "Falha na comunicação com o provedor WhatsApp", "provider_error", { providerStatus: response.status, providerMessage: message });
      }
      return data as any;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, "Evolution indisponível", "provider_unavailable");
    } finally { clearTimeout(timeout); }
  }

  async createInstance(instanceName: string, webhookUrl: string) {
    await this.request("/instance/create", { method: "POST", body: JSON.stringify({ instanceName, qrcode: true, integration: "WHATSAPP-BAILEYS" }) });
    await this.request(`/webhook/set/${encodeURIComponent(instanceName)}`, { method: "POST", body: JSON.stringify({ webhook: { enabled: true, url: webhookUrl, webhookByEvents: false, headers: { "x-webhook-secret": config.WEBHOOK_SECRET }, events: ["QRCODE_UPDATED", "CONNECTION_UPDATE", "MESSAGES_UPSERT", "MESSAGES_UPDATE"] } }) });
  }

  async getConnectionStatus(instanceName: string): Promise<ProviderStatus> {
    const data = await this.request(`/instance/connectionState/${encodeURIComponent(instanceName)}`);
    const raw = String(data?.instance?.state ?? data?.state ?? "disconnected").toLowerCase();
    const state = raw === "open" || raw === "connected" ? "connected" : raw === "connecting" ? "connecting" : raw === "close" ? "disconnected" : "disconnected";
    return { state, phone: data?.instance?.owner?.replace(/\D/g, ""), profileName: data?.instance?.profileName, profilePictureUrl: data?.instance?.profilePictureUrl };
  }

  async getQrCode(instanceName: string) {
    const data = await this.request(`/instance/connect/${encodeURIComponent(instanceName)}`);
    return { code: data?.code, base64: data?.base64 };
  }
  reconnect(instanceName: string) { return this.getQrCode(instanceName); }
  async sendText(instanceName: string, to: string, message: string) {
    const path = `/message/sendText/${encodeURIComponent(instanceName)}`;
    const send = (number: string) => this.request(path, {
      method: "POST",
      body: JSON.stringify({ number, text: message, delay: 800, linkPreview: false })
    });
    const normalizedNumber = normalizeWhatsappNumber(to);
    try {
      return await send(normalizedNumber);
    } catch (error) {
      const legacyNumber = brazilianLegacyNumber(normalizedNumber);
      if (!legacyNumber || !isEvolutionProviderStatus(error, 400)) throw error;
      logger.info({ provider: "evolution", phoneLast4: legacyNumber.slice(-4) }, "Retrying Brazilian number without the ninth digit");
      return send(legacyNumber);
    }
  }
  sendImage(instanceName: string, to: string, imageUrl: string, caption?: string) { return this.request(`/message/sendMedia/${encodeURIComponent(instanceName)}`, { method: "POST", body: JSON.stringify({ number: to, mediatype: "image", media: imageUrl, caption }) }); }
  sendDocument(instanceName: string, to: string, documentUrl: string, filename: string, caption?: string) { return this.request(`/message/sendMedia/${encodeURIComponent(instanceName)}`, { method: "POST", body: JSON.stringify({ number: to, mediatype: "document", media: documentUrl, fileName: filename, caption }) }); }
  async logout(instanceName: string) { await this.request(`/instance/logout/${encodeURIComponent(instanceName)}`, { method: "DELETE" }); }
  async deleteInstance(instanceName: string) { await this.request(`/instance/delete/${encodeURIComponent(instanceName)}`, { method: "DELETE" }); }
}

export const whatsappProvider = new EvolutionProvider();
