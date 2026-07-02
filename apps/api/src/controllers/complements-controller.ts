import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { companyWhere, getCompanyId } from "../utils/tenant.js";
import { optionalImageUrl } from "../utils/image-url.js";

const complementSchema = z.object({
  name: z.string().trim().min(2, "Informe um nome com pelo menos 2 caracteres"),
  description: z.string().trim().min(2, "Informe uma descricao com pelo menos 2 caracteres"),
  price: z.preprocess(
    (value) => typeof value === "string" ? value.replace(",", ".") : value,
    z.coerce.number({ invalid_type_error: "Informe um preco valido" }).min(0, "O preco nao pode ser negativo")
  ),
  imageUrl: optionalImageUrl("Informe uma URL de imagem valida"),
  active: z.boolean().optional(),
  trackStock: z.boolean().optional(),
  stockQuantity: z.coerce.number().min(0).optional(),
  lowStockAlert: z.coerce.number().min(0).optional().nullable()
});

export async function listComplements(req: Request, res: Response) {
  const complements = await prisma.complement.findMany({
    where: companyWhere(req),
    orderBy: [{ active: "desc" }, { name: "asc" }]
  });

  return res.json(complements);
}

export async function createComplement(req: Request, res: Response) {
  const body = complementSchema.parse(req.body);
  const complement = await prisma.complement.create({
    data: {
      ...body,
      companyId: getCompanyId(req),
      imageUrl: body.imageUrl || null,
      price: new Prisma.Decimal(body.price),
      trackStock: body.trackStock ?? false,
      stockQuantity: new Prisma.Decimal(body.stockQuantity ?? 0),
      lowStockAlert: body.lowStockAlert !== undefined && body.lowStockAlert !== null ? new Prisma.Decimal(body.lowStockAlert) : null
    }
  });

  return res.status(201).json(complement);
}

export async function updateComplement(req: Request, res: Response) {
  const body = complementSchema.partial().parse(req.body);
  const existing = await prisma.complement.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ message: "Complemento nao encontrado" });
  const complement = await prisma.complement.update({
    where: { id: existing.id },
    data: {
      ...body,
      ...(body.price !== undefined ? { price: new Prisma.Decimal(body.price) } : {}),
      ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl || null } : {}),
      ...(body.stockQuantity !== undefined ? { stockQuantity: new Prisma.Decimal(body.stockQuantity) } : {}),
      ...(body.lowStockAlert !== undefined ? { lowStockAlert: body.lowStockAlert !== null ? new Prisma.Decimal(body.lowStockAlert) : null } : {})
    }
  });

  return res.json(complement);
}

export async function deleteComplement(req: Request, res: Response) {
  const existing = await prisma.complement.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ message: "Complemento nao encontrado" });
  await prisma.complement.delete({ where: { id: existing.id } });
  return res.status(204).send();
}
