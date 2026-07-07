import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

export async function ensureCompanySettings(companyId: string) {
  const include = { deliveryFeeTiers: { orderBy: { sortOrder: "asc" } } } as const;
  const safeCompanyId = companyId.trim();

  const existing = await prisma.setting.findFirst({
    where: { companyId: safeCompanyId },
    include
  });
  if (existing) return existing;

  try {
    return await prisma.setting.create({
      data: {
        companyId: safeCompanyId,
        companyName: "Lanchonete Delivery",
        whatsappNumber: process.env.WHATSAPP_NUMBER ?? "5575999999999",
        deliveryFee: new Prisma.Decimal(5),
        openTime: "00:00",
        closeTime: "23:59",
        autoMessage: "Obrigado pelo pedido!"
      },
      include
    });
  } catch {
    const fallback = await prisma.setting.findFirst({
      where: { companyId: safeCompanyId },
      include
    });
    if (fallback) return fallback;
    throw new Error(`Nao foi possivel carregar as configuracoes da empresa ${safeCompanyId}`);
  }
}
