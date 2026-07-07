import type { Request, Response } from "express";
import { dispatchWhatsappMessage } from "../services/whatsapp.js";
import { prisma } from "../utils/prisma.js";
import { companyWhere } from "../utils/tenant.js";

export async function getFutureIntegrations(_req: Request, res: Response) {
  return res.json({
    ifood: "planned",
    mercadopago: "planned",
    automaticPix: "planned",
    notes: "Estrutura preparada para receber webhooks e conciliacao de pagamentos."
  });
}

export async function testMenuiaIntegration(req: Request, res: Response) {
  const settings = await prisma.setting.findFirst({ where: companyWhere(req) });

  if (!settings) {
    return res.status(404).json({ message: "Configuracoes nao encontradas" });
  }

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
