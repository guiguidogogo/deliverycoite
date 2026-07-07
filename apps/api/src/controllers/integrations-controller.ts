import type { Request, Response } from "express";
import { dispatchWhatsappMessage } from "../services/whatsapp.js";
import { dispatchN8nEvent } from "../services/n8n.js";
import { prisma } from "../utils/prisma.js";
import { companyWhere } from "../utils/tenant.js";
import { ensureCompanySettings } from "../utils/settings.js";

export async function getFutureIntegrations(_req: Request, res: Response) {
  return res.json({
    ifood: "planned",
    mercadopago: "planned",
    automaticPix: "planned",
    n8n: "available",
    notes: "Estrutura preparada para receber webhooks, automacoes e conciliacao de pagamentos."
  });
}

export async function testMenuiaIntegration(req: Request, res: Response) {
  const settings = await ensureCompanySettings(companyWhere(req).companyId);

  if (!settings.menuiaEnabled) {
    return res.status(400).json({ message: "Menuia esta desabilitado nas configuracoes" });
  }

  if (!settings.menuiaApiKey || !settings.menuiaStoreId) {
    return res.status(400).json({ message: "Informe AUTHKEY e APPKEY da Menuia" });
  }

  const storePhone = settings.whatsappNumber?.replace(/\D/g, "");
  if (!storePhone) {
    return res.status(400).json({ message: "Configure o WhatsApp da loja para teste" });
  }

  const message =
    "Teste de integracao Menuia/WhatsApp realizado com sucesso no sistema Delivery.";
  const sent = await dispatchWhatsappMessage(settings, storePhone, message, storePhone);

  if (!sent.ok || sent.channel !== "MENUAI") {
    return res.status(502).json({
      ok: false,
      fallbackUsed: sent.channel === "WHATSAPP_LINK",
      whatsappUrl: sent.whatsappUrl ?? null,
      message: sent.error ?? "Falha ao enviar teste via Menuia"
    });
  }

  return res.json({
    ok: true,
    channel: sent.channel,
    fallbackUsed: false,
    message: "Teste enviado com sucesso via servidor Menuia",
    detail: null
  });
}

export async function testN8nIntegration(req: Request, res: Response) {
  const settings = await ensureCompanySettings(companyWhere(req).companyId);

  if (!settings.n8nEnabled) {
    return res.status(400).json({ message: "n8n esta desabilitado nas configuracoes" });
  }

  if (!settings.n8nWebhookUrl) {
    return res.status(400).json({ message: "Informe a URL do webhook do n8n" });
  }

  const sent = await dispatchN8nEvent(settings.companyId, "order.created", {
    kind: "test",
    message: "Teste de integracao n8n/HubRegional realizado com sucesso."
  });

  if (!sent.ok) {
    return res.status(502).json({
      ok: false,
      message: sent.error ?? "Falha ao enviar teste para n8n"
    });
  }

  return res.json({
    ok: true,
    message: "Teste enviado com sucesso para o n8n",
    detail: sent.response
  });
}
