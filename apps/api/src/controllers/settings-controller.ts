import type { Request, Response } from "express";
import { ClosedOrderPolicy, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { getCompanyId } from "../utils/tenant.js";
import { optionalImageUrl } from "../utils/image-url.js";

const optionalText = z.preprocess(
  (value) => typeof value === "string" && !value.trim() ? undefined : value,
  z.string().trim().optional()
);

const optionalMinText = (min: number) =>
  z.preprocess(
    (value) => typeof value === "string" && !value.trim() ? undefined : value,
    z.string().trim().min(min).optional()
  );

const settingsSchema = z.object({
  companyName: optionalMinText(2),
  logoUrl: optionalImageUrl(),
  promoBannerImageUrl: optionalImageUrl(),
  promoBannerTitle: optionalText.pipe(z.string().max(80).optional()),
  promoBannerText: optionalText.pipe(z.string().max(200).optional()),
  whatsappNumber: optionalMinText(8),
  deliveryPhoneNumber: optionalMinText(8),
  deliveryFee: z.coerce.number().min(0).optional(),
  ordersPaused: z.boolean().optional(),
  ordersPausedReason: z.string().max(180).nullable().optional(),
  storeLatitude: z.number().min(-90).max(90).nullable().optional(),
  storeLongitude: z.number().min(-180).max(180).nullable().optional(),
  deliveryFeeTiers: z.array(z.object({
    maxDistanceKm: z.coerce.number().positive(),
    fee: z.coerce.number().min(0)
  })).max(20).optional(),
  openTime: optionalText,
  closeTime: optionalText,
  timezone: optionalText,
  closedOrderPolicy: z.nativeEnum(ClosedOrderPolicy).optional(),
  autoMessage: optionalText,
  pixKey: optionalText,
  pixQrCodeUrl: optionalText,
  darkModeEnabled: z.boolean().optional(),
  menuiaApiKey: optionalText,
  menuiaStoreId: optionalText,
  menuiaEnabled: z.boolean().optional(),
  whatsappOnReceived: z.boolean().optional(),
  whatsappOnPreparing: z.boolean().optional(),
  whatsappOnOutForDelivery: z.boolean().optional(),
  whatsappOnDelivered: z.boolean().optional(),
  whatsappOnFinished: z.boolean().optional(),
  whatsappOnCanceled: z.boolean().optional(),
  whatsappOnPaymentConfirmed: z.boolean().optional(),
  printerEnabled: z.boolean().optional(),
  printerName: optionalText,
  printerPaperWidth: z.union([z.literal(58), z.literal(80)]).optional(),
  printerAutoPrint: z.boolean().optional(),
  tableServiceFeeEnabled: z.boolean().optional(),
  tableServiceFeePercent: z.coerce.number().min(0).max(30).optional(),
  mercadoPagoEnabled: z.boolean().optional(),
  mercadoPagoPublicKey: optionalText,
  mercadoPagoAccessToken: optionalText
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
      timezone: "America/Bahia",
      closedOrderPolicy: ClosedOrderPolicy.BLOCK_WHEN_CLOSED,
      autoMessage: "Obrigado pelo pedido!"
    },
    include: { deliveryFeeTiers: { orderBy: { sortOrder: "asc" } } }
  });
}

export async function getSettings(req: Request, res: Response) {
  const settings = await ensureDefaultSettings(req);
  const company = await prisma.company.findUnique({
    where: { id: getCompanyId(req) },
    select: {
      mercadoPagoPublicKey: true,
      mercadoPagoAccessToken: true,
      mercadoPagoEnabled: true,
      businessType: true,
      category: true
    }
  });

  const isAdminRequest = Boolean(req.user);
  return res.json({
    ...settings,
    mercadoPagoPublicKey: company?.mercadoPagoPublicKey ?? null,
    ...(isAdminRequest ? { mercadoPagoAccessToken: company?.mercadoPagoAccessToken ?? null } : {}),
    mercadoPagoEnabled: company?.mercadoPagoEnabled ?? false,
    businessType: company?.businessType ?? "FOOD",
    category: company?.category ?? null
  });
}

export async function updateSettings(req: Request, res: Response) {
  const body = settingsSchema.parse(req.body);
  const current = await ensureDefaultSettings(req);
  const { deliveryFeeTiers, mercadoPagoEnabled, mercadoPagoPublicKey, mercadoPagoAccessToken, ...settingsData } = body;

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

    if (
      mercadoPagoEnabled !== undefined ||
      mercadoPagoPublicKey !== undefined ||
      mercadoPagoAccessToken !== undefined
    ) {
      await transaction.company.update({
        where: { id: getCompanyId(req) },
        data: {
          ...(mercadoPagoEnabled !== undefined ? { mercadoPagoEnabled } : {}),
          ...(mercadoPagoPublicKey !== undefined
            ? { mercadoPagoPublicKey: mercadoPagoPublicKey.trim() || null }
            : {}),
          ...(mercadoPagoAccessToken !== undefined
            ? { mercadoPagoAccessToken: mercadoPagoAccessToken.trim() || null }
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

    const savedSettings = await transaction.setting.findUniqueOrThrow({
      where: { id: updated.id },
      include: { deliveryFeeTiers: { orderBy: { sortOrder: "asc" } } }
    });

    const savedCompany = await transaction.company.findUnique({
      where: { id: getCompanyId(req) },
      select: {
        mercadoPagoPublicKey: true,
        mercadoPagoAccessToken: true,
        mercadoPagoEnabled: true,
        businessType: true,
        category: true
      }
    });

    return {
      ...savedSettings,
      mercadoPagoPublicKey: savedCompany?.mercadoPagoPublicKey ?? null,
      mercadoPagoAccessToken: savedCompany?.mercadoPagoAccessToken ?? null,
      mercadoPagoEnabled: savedCompany?.mercadoPagoEnabled ?? false,
      businessType: savedCompany?.businessType ?? "FOOD",
      category: savedCompany?.category ?? null
    };
  });

  return res.json(settings);
}
