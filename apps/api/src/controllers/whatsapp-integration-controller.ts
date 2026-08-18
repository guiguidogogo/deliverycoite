import type { Request, Response } from "express";
import { prisma } from "../utils/prisma.js";
import { getCompanyId } from "../utils/tenant.js";
import {
  createHubWhatsappInstance,
  getHubWhatsappQrCode,
  getHubWhatsappStatus,
  HubWhatsappError,
  isHubWhatsappConfigured,
  logoutHubWhatsapp,
  reconnectHubWhatsapp,
  registerHubWhatsappTenant,
  sendHubWhatsappTest
} from "../services/hub-whatsapp.js";

async function tenantContext(req: Request) {
  const companyId = getCompanyId(req);
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { tradeName: true, companyName: true }
  });
  if (!company) {
    throw Object.assign(new Error("Empresa nao encontrada"), { statusCode: 404 });
  }
  return { companyId, name: company.tradeName || company.companyName };
}

async function ensureInstance(req: Request) {
  const tenant = await tenantContext(req);
  await registerHubWhatsappTenant(tenant.companyId, tenant.name);
  await createHubWhatsappInstance(tenant.companyId);
  return tenant;
}

function isMissingGatewayResource(error: unknown) {
  return error instanceof HubWhatsappError
    && error.statusCode === 404
    && (error.code === "tenant_not_found" || error.code === "instance_not_found");
}

export async function getWhatsappIntegrationStatus(req: Request, res: Response) {
  if (!isHubWhatsappConfigured()) {
    return res.json({ available: false, instance_exists: false, connected: false, status: "unavailable" });
  }

  const tenant = await tenantContext(req);
  try {
    const status = await getHubWhatsappStatus(tenant.companyId);
    return res.json({ available: true, instance_exists: true, ...status });
  } catch (error) {
    if (isMissingGatewayResource(error)) {
      return res.json({ available: true, instance_exists: false, connected: false, status: "not_configured" });
    }
    throw error;
  }
}

export async function connectWhatsappIntegration(req: Request, res: Response) {
  const tenant = await ensureInstance(req);
  const status = await getHubWhatsappStatus(tenant.companyId).catch((error) => {
    if (error instanceof HubWhatsappError && error.statusCode === 502) return null;
    throw error;
  });

  if (status?.connected) {
    return res.json({ available: true, instance_exists: true, ...status });
  }

  const qr = await getHubWhatsappQrCode(tenant.companyId);
  return res.json({ available: true, instance_exists: true, connected: false, ...qr });
}

export async function getWhatsappIntegrationQrCode(req: Request, res: Response) {
  const tenant = await ensureInstance(req);
  const qr = await getHubWhatsappQrCode(tenant.companyId);
  res.setHeader("Cache-Control", "no-store");
  return res.json({ available: true, instance_exists: true, connected: false, ...qr });
}

export async function reconnectWhatsappIntegration(req: Request, res: Response) {
  const tenant = await ensureInstance(req);
  const result = await reconnectHubWhatsapp(tenant.companyId);
  return res.json({ available: true, instance_exists: true, connected: false, ...result });
}

export async function logoutWhatsappIntegration(req: Request, res: Response) {
  const tenant = await tenantContext(req);
  try {
    await logoutHubWhatsapp(tenant.companyId);
  } catch (error) {
    if (!isMissingGatewayResource(error)) throw error;
  }
  return res.status(204).end();
}

export async function testWhatsappIntegration(req: Request, res: Response) {
  const tenant = await tenantContext(req);
  const settings = await prisma.setting.findFirst({
    where: { companyId: tenant.companyId },
    select: { whatsappNumber: true }
  });
  const to = settings?.whatsappNumber?.replace(/\D/g, "") ?? "";
  if (to.length < 8) {
    return res.status(400).json({ message: "Configure o WhatsApp principal da loja antes de testar" });
  }

  const result = await sendHubWhatsappTest(
    tenant.companyId,
    to,
    `Teste da conexao WhatsApp da ${tenant.name} pelo HubRegional.`
  );
  return res.status(202).json({ ok: true, ...result });
}
