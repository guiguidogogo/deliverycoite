import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { getCompanyId } from "../utils/tenant.js";
import { audit } from "../utils/audit.js";
import { getHubWhatsappStatus } from "../services/hub-whatsapp.js";

const createSchema = z.object({
  name: z.string().trim().min(3).max(100),
  message: z.string().trim().min(3).max(4000),
  batchSize: z.coerce.number().int().min(1).max(20).default(5),
  intervalMinutes: z.coerce.number().int().min(1).max(1440).default(5),
  customerIds: z.array(z.string()).max(5000).optional(),
  allCustomers: z.boolean().default(false),
  consentConfirmed: z.literal(true),
  startAt: z.coerce.date().optional()
});

export async function listWhatsappCampaigns(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  return res.json(await prisma.whatsappCampaign.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      recipients: {
        where: { status: "FAILED" },
        select: { id: true, customerName: true, phone: true, errorMessage: true },
        take: 5
      }
    }
  }));
}

export async function createWhatsappCampaign(req: Request, res: Response) {
  const body = createSchema.parse(req.body);
  const companyId = getCompanyId(req);
  if (!body.allCustomers && !body.customerIds?.length) {
    return res.status(400).json({ message: "Selecione ao menos um cliente" });
  }
  const whatsappStatus = await getHubWhatsappStatus(companyId);
  if (!whatsappStatus.connected) {
    return res.status(409).json({ message: "Conecte o WhatsApp desta empresa antes de iniciar a campanha" });
  }

  const customers = await prisma.customer.findMany({
    where: {
      companyId,
      deletedAt: null,
      phone: { not: "" },
      ...(!body.allCustomers ? { id: { in: body.customerIds } } : {})
    },
    select: { id: true, name: true, phone: true },
    take: 5000
  });
  const unique = [...new Map(customers
    .map((customer) => ({ ...customer, phone: customer.phone.replace(/\D/g, "") }))
    .filter((customer) => customer.phone.length >= 10)
    .map((customer) => [customer.phone, customer])).values()];
  if (!unique.length) return res.status(400).json({ message: "Nenhum cliente possui WhatsApp valido" });

  const nextBatchAt = body.startAt && body.startAt > new Date() ? body.startAt : new Date();
  const campaign = await prisma.$transaction(async (transaction) => {
    const created = await transaction.whatsappCampaign.create({
      data: {
        companyId,
        name: body.name,
        message: body.message,
        batchSize: body.batchSize,
        intervalMinutes: body.intervalMinutes,
        nextBatchAt,
        totalRecipients: unique.length,
        createdBy: req.user!.sub,
        recipients: {
          create: unique.map((customer) => ({
            companyId,
            customerId: customer.id,
            customerName: customer.name,
            phone: customer.phone
          }))
        }
      }
    });
    await audit(req, {
      action: "WHATSAPP_CAMPAIGN_CREATED",
      entity: "WhatsappCampaign",
      entityId: created.id,
      newValue: { recipients: unique.length, batchSize: body.batchSize, intervalMinutes: body.intervalMinutes }
    }, transaction);
    return created;
  });
  return res.status(201).json(campaign);
}

export async function updateWhatsappCampaignStatus(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const body = z.object({ status: z.enum(["RUNNING", "PAUSED", "CANCELED"]) }).parse(req.body);
  const campaign = await prisma.whatsappCampaign.findFirst({ where: { id: req.params.id, companyId } });
  if (!campaign) return res.status(404).json({ message: "Campanha nao encontrada" });
  if (campaign.status === "COMPLETED" || campaign.status === "CANCELED") {
    return res.status(400).json({ message: "Esta campanha ja foi encerrada" });
  }
  const updated = await prisma.$transaction(async (transaction) => {
    if (body.status === "CANCELED") {
      await transaction.whatsappCampaignRecipient.updateMany({
        where: { campaignId: campaign.id, status: "PENDING" },
        data: { status: "CANCELED" }
      });
    }
    const result = await transaction.whatsappCampaign.update({
      where: { id: campaign.id },
      data: { status: body.status, ...(body.status === "RUNNING" ? { nextBatchAt: new Date() } : {}) }
    });
    await audit(req, {
      action: `WHATSAPP_CAMPAIGN_${body.status}`,
      entity: "WhatsappCampaign",
      entityId: campaign.id
    }, transaction);
    return result;
  });
  return res.json(updated);
}
