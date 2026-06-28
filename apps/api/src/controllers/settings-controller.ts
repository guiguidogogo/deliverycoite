import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { getCompanyId } from "../utils/tenant.js";
import { optionalImageUrl } from "../utils/image-url.js";

const settingsSchema = z.object({
  companyName: z.string().min(2).optional(),
  logoUrl: optionalImageUrl(),
  promoBannerImageUrl: optionalImageUrl(),
  promoBannerTitle: z.string().max(80).optional(),
  promoBannerText: z.string().max(200).optional(),
  whatsappNumber: z.string().min(8).optional(),
  deliveryPhoneNumber: z.string().min(8).optional(),
  deliveryFee: z.coerce.number().min(0).optional(),
  ordersPaused: z.boolean().optional(),
  ordersPausedReason: z.string().max(180).nullable().optional(),
  storeLatitude: z.number().min(-90).max(90).nullable().optional(),
  storeLongitude: z.number().min(-180).max(180).nullable().optional(),
  deliveryFeeTiers: z.array(z.object({
    maxDistanceKm: z.coerce.number().positive(),
    fee: z.coerce.number().min(0)
  })).max(20).optional(),
  openTime: z.string().optional(),
  closeTime: z.string().optional(),
  autoMessage: z.string().optional(),
  pixKey: z.string().optional(),
  pixQrCodeUrl: z.string().optional(),
  darkModeEnabled: z.boolean().optional(),
  menuiaApiKey: z.string().optional(),
  menuiaStoreId: z.string().optional(),
  menuiaEnabled: z.boolean().optional(),
  whatsappOnReceived: z.boolean().optional(),
  whatsappOnPreparing: z.boolean().optional(),
  whatsappOnOutForDelivery: z.boolean().optional(),
  whatsappOnDelivered: z.boolean().optional(),
  whatsappOnFinished: z.boolean().optional(),
  whatsappOnCanceled: z.boolean().optional(),
  whatsappOnPaymentConfirmed: z.boolean().optional(),
  printerEnabled: z.boolean().optional(),
  printerName: z.string().optional(),
  printerPaperWidth: z.union([z.literal(58), z.literal(80)]).optional(),
  printerAutoPrint: z.boolean().optional()
});

async function ensureDefaultSettings(req: Request) {
  const companyId = getCompanyId(req);
  const existing = await prisma.setting.findFirst({
    where: { companyId },
    include: { deliveryFeeTiers: { orderBy: { sortOrder: "asc" } } }
  });

  if (existing) {
    return existing;
  }

  return prisma.setting.create({
    data: {
      companyId,
      companyName: "Lanchonete Delivery",
      whatsappNumber: process.env.WHATSAPP_NUMBER ?? "5575999999999",
      deliveryFee: new Prisma.Decimal(5),
      openTime: "00:00",
      closeTime: "23:59",
      autoMessage: "Obrigado pelo pedido!"
    },
    include: { deliveryFeeTiers: { orderBy: { sortOrder: "asc" } } }
  });
}

export async function getSettings(req: Request, res: Response) {
  const settings = await ensureDefaultSettings(req);
  return res.json(settings);
}

export async function updateSettings(req: Request, res: Response) {
  const body = settingsSchema.parse(req.body);
  const current = await ensureDefaultSettings(req);
  const { deliveryFeeTiers, ...settingsData } = body;

  const settings = await prisma.$transaction(async (transaction) => {
    const updated = await transaction.setting.update({
      where: { id: current.id },
      data: {
        ...settingsData,
        ...(body.printerName !== undefined ? { printerName: body.printerName.trim() || null } : {}),
        ...(body.deliveryFee !== undefined ? { deliveryFee: new Prisma.Decimal(body.deliveryFee) } : {})
      }
    });

    if (
      settingsData.companyName !== undefined ||
      settingsData.logoUrl !== undefined ||
      settingsData.whatsappNumber !== undefined
    ) {
      await transaction.company.update({
        where: { id: getCompanyId(req) },
        data: {
          ...(settingsData.companyName !== undefined
            ? { tradeName: settingsData.companyName }
            : {}),
          ...(settingsData.logoUrl !== undefined ? { logoUrl: settingsData.logoUrl } : {}),
          ...(settingsData.whatsappNumber !== undefined
            ? { whatsapp: settingsData.whatsappNumber }
            : {})
        }
      });
    }

    if (deliveryFeeTiers !== undefined) {
      await transaction.deliveryFeeTier.deleteMany({ where: { settingId: current.id } });
      if (deliveryFeeTiers.length) {
        const sortedTiers = [...deliveryFeeTiers].sort(
          (left, right) => left.maxDistanceKm - right.maxDistanceKm
        );
        await transaction.deliveryFeeTier.createMany({
          data: sortedTiers.map((tier, index) => ({
            companyId: getCompanyId(req),
            settingId: current.id,
            maxDistanceKm: tier.maxDistanceKm,
            fee: new Prisma.Decimal(tier.fee),
            sortOrder: index
          }))
        });
      }
    }

    return transaction.setting.findUniqueOrThrow({
      where: { id: updated.id },
      include: { deliveryFeeTiers: { orderBy: { sortOrder: "asc" } } }
    });
  });

  return res.json(settings);
}
