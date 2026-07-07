import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { getCompanyId } from "../utils/tenant.js";
import { optionalImageUrl } from "../utils/image-url.js";
import { ensureCompanySettings, getCompanyDeliveryFeeTiers } from "../utils/settings.js";

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
  faviconUrl: optionalImageUrl(),
  primaryColor: optionalText.pipe(z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()),
  secondaryColor: optionalText.pipe(z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()),
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
  autoMessage: optionalText,
  pixKey: optionalText,
  pixQrCodeUrl: optionalText,
  darkModeEnabled: z.boolean().optional(),
  menuiaApiKey: optionalText,
  menuiaStoreId: optionalText,
  menuiaEnabled: z.boolean().optional(),
  n8nEnabled: z.boolean().optional(),
  n8nWebhookUrl: optionalText,
  n8nSecret: optionalText,
  n8nEventsOrderCreated: z.boolean().optional(),
  n8nEventsOrderPaid: z.boolean().optional(),
  n8nEventsOrderStatusChanged: z.boolean().optional(),
  n8nEventsTableSession: z.boolean().optional(),
  n8nEventsCustomerCreated: z.boolean().optional(),
  n8nEventsTicketOrder: z.boolean().optional(),
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
  return ensureCompanySettings(getCompanyId(req));
}

export async function getSettings(req: Request, res: Response) {
  const settings = await ensureDefaultSettings(req);
  const deliveryFeeTiers = await getCompanyDeliveryFeeTiers(getCompanyId(req));
  const company = await prisma.company.findUnique({
    where: { id: getCompanyId(req) },
    select: {
      logoUrl: true,
      faviconUrl: true,
      primaryColor: true,
      secondaryColor: true,
      mercadoPagoPublicKey: true,
      mercadoPagoAccessToken: true,
      mercadoPagoEnabled: true
    }
  });

  const isAdminRequest = Boolean(req.user);
  return res.json({
    ...settings,
    deliveryFeeTiers,
    logoUrl: company?.logoUrl ?? null,
    faviconUrl: company?.faviconUrl ?? null,
    primaryColor: company?.primaryColor ?? null,
    secondaryColor: company?.secondaryColor ?? null,
    mercadoPagoPublicKey: company?.mercadoPagoPublicKey ?? null,
    ...(isAdminRequest ? { mercadoPagoAccessToken: company?.mercadoPagoAccessToken ?? null } : {}),
    mercadoPagoEnabled: company?.mercadoPagoEnabled ?? false,
    n8nEnabled: settings.n8nEnabled,
    n8nWebhookUrl: settings.n8nWebhookUrl,
    ...(isAdminRequest ? { n8nSecret: settings.n8nSecret ?? null } : {})
  });
}

export async function updateSettings(req: Request, res: Response) {
  const body = settingsSchema.parse(req.body);
  const current = await ensureDefaultSettings(req);
  const { deliveryFeeTiers, mercadoPagoEnabled, mercadoPagoPublicKey, mercadoPagoAccessToken, n8nEnabled, n8nWebhookUrl, n8nSecret, ...settingsData } = body;

  const settings = await prisma.$transaction(async (transaction) => {
    const updated = await transaction.setting.update({
      where: { id: current.id },
      data: {
        ...settingsData,
        ...(body.printerName !== undefined ? { printerName: body.printerName.trim() || null } : {}),
        ...(body.deliveryFee !== undefined ? { deliveryFee: new Prisma.Decimal(body.deliveryFee) } : {})
      }
    });

    if (n8nEnabled !== undefined || n8nWebhookUrl !== undefined || n8nSecret !== undefined) {
      await transaction.setting.update({
        where: { id: current.id },
        data: {
          ...(n8nEnabled !== undefined ? { n8nEnabled } : {}),
          ...(n8nWebhookUrl !== undefined ? { n8nWebhookUrl: n8nWebhookUrl.trim() || null } : {}),
          ...(n8nSecret !== undefined ? { n8nSecret: n8nSecret.trim() || null } : {})
        }
      });
    }

    if (
      settingsData.companyName !== undefined ||
      settingsData.logoUrl !== undefined ||
      settingsData.faviconUrl !== undefined ||
      settingsData.primaryColor !== undefined ||
      settingsData.secondaryColor !== undefined ||
      settingsData.whatsappNumber !== undefined
    ) {
      await transaction.company.update({
        where: { id: getCompanyId(req) },
        data: {
          ...(settingsData.companyName !== undefined
            ? { tradeName: settingsData.companyName }
            : {}),
          ...(settingsData.logoUrl !== undefined ? { logoUrl: settingsData.logoUrl } : {}),
          ...(settingsData.faviconUrl !== undefined ? { faviconUrl: settingsData.faviconUrl } : {}),
          ...(settingsData.primaryColor !== undefined ? { primaryColor: settingsData.primaryColor } : {}),
          ...(settingsData.secondaryColor !== undefined ? { secondaryColor: settingsData.secondaryColor } : {}),
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
      where: { id: updated.id }
    });
    const savedDeliveryFeeTiers = await transaction.deliveryFeeTier.findMany({
      where: { settingId: updated.id },
      orderBy: { sortOrder: "asc" }
    });

    const savedCompany = await transaction.company.findUnique({
      where: { id: getCompanyId(req) },
      select: {
        mercadoPagoPublicKey: true,
        mercadoPagoAccessToken: true,
        mercadoPagoEnabled: true
      }
    });

    return {
      ...savedSettings,
      deliveryFeeTiers: savedDeliveryFeeTiers,
      mercadoPagoPublicKey: savedCompany?.mercadoPagoPublicKey ?? null,
      mercadoPagoAccessToken: savedCompany?.mercadoPagoAccessToken ?? null,
      mercadoPagoEnabled: savedCompany?.mercadoPagoEnabled ?? false,
      n8nEnabled: savedSettings.n8nEnabled,
      n8nWebhookUrl: savedSettings.n8nWebhookUrl,
      n8nSecret: savedSettings.n8nSecret
    };
  });

  return res.json(settings);
}
