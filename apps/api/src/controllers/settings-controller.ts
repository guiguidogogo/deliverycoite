import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";

const settingsSchema = z.object({
  companyName: z.string().min(2).optional(),
  logoUrl: z.string().url().optional(),
  whatsappNumber: z.string().min(8).optional(),
  deliveryPhoneNumber: z.string().min(8).optional(),
  deliveryFee: z.coerce.number().min(0).optional(),
  openTime: z.string().optional(),
  closeTime: z.string().optional(),
  autoMessage: z.string().optional(),
  pixKey: z.string().optional(),
  pixQrCodeUrl: z.string().optional(),
  darkModeEnabled: z.boolean().optional(),
  menuiaApiKey: z.string().optional(),
  menuiaStoreId: z.string().optional(),
  menuiaEnabled: z.boolean().optional()
});

async function ensureDefaultSettings() {
  const existing = await prisma.setting.findFirst();

  if (existing) {
    return existing;
  }

  return prisma.setting.create({
    data: {
      companyName: "Lanchonete Delivery",
      whatsappNumber: process.env.WHATSAPP_NUMBER ?? "5575999999999",
      deliveryFee: new Prisma.Decimal(5),
      openTime: "00:00",
      closeTime: "23:59",
      autoMessage: "Obrigado pelo pedido!"
    }
  });
}

export async function getSettings(_req: Request, res: Response) {
  const settings = await ensureDefaultSettings();
  return res.json(settings);
}

export async function updateSettings(req: Request, res: Response) {
  const body = settingsSchema.parse(req.body);
  const current = await ensureDefaultSettings();

  const settings = await prisma.setting.update({
    where: { id: current.id },
    data: {
      ...body,
      ...(body.deliveryFee !== undefined ? { deliveryFee: new Prisma.Decimal(body.deliveryFee) } : {})
    }
  });

  return res.json(settings);
}
