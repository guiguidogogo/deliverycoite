import type { Request, Response } from "express";
import { prisma } from "../utils/prisma.js";
import { getCompanyId } from "../utils/tenant.js";

export async function getPublicCompany(req: Request, res: Response) {
  const company = await prisma.company.findFirst({
    where: { id: getCompanyId(req), active: true },
    select: {
      id: true,
      tradeName: true,
      logoUrl: true,
      phone: true,
      whatsapp: true,
      instagram: true,
      subdomain: true,
      active: true
    }
  });

  if (!company) {
    return res.status(404).json({ message: "Empresa nao encontrada" });
  }

  return res.json(company);
}
