import type { Request, Response } from "express";
import { getCompanyOpenStatus } from "../services/business-hours.js";
import { prisma } from "../utils/prisma.js";
import { getCompanyId } from "../utils/tenant.js";

export async function getPublicCompany(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const company = await prisma.company.findFirst({
    where: { id: companyId, active: true },
    select: {
      id: true,
      tradeName: true,
      logoUrl: true,
      faviconUrl: true,
      primaryColor: true,
      secondaryColor: true,
      phone: true,
      whatsapp: true,
      instagram: true,
      subdomain: true,
      active: true,
      category: true,
      city: true,
      isOpen: true,
      deliveryFee: true,
      deliveryTimeMin: true,
      rating: true
    }
  });

  if (!company) {
    return res.status(404).json({ message: "Empresa nao encontrada" });
  }

  const openStatus = await getCompanyOpenStatus(companyId);

  return res.json({
    ...company,
    isOpen: openStatus.isOpen,
    openStatus
  });
}
