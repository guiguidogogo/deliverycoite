import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { companyWhere, getCompanyId } from "../utils/tenant.js";

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const schema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  active: z.boolean().optional()
});

export async function listCategories(req: Request, res: Response) {
  const categories = await prisma.category.findMany({ where: companyWhere(req), orderBy: { name: "asc" } });
  return res.json(categories);
}

export async function createCategory(req: Request, res: Response) {
  const body = schema.parse(req.body);
  const category = await prisma.category.create({
    data: {
      ...body,
      companyId: getCompanyId(req),
      slug: slugify(body.name)
    }
  });

  return res.status(201).json(category);
}

export async function updateCategory(req: Request, res: Response) {
  const body = schema.partial().parse(req.body);
  const { id } = req.params;

  const existing = await prisma.category.findFirst({ where: { id, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ message: "Categoria nao encontrada" });
  const category = await prisma.category.update({
    where: { id: existing.id },
    data: {
      ...body,
      ...(body.name ? { slug: slugify(body.name) } : {})
    }
  });

  return res.json(category);
}

export async function deleteCategory(req: Request, res: Response) {
  const { id } = req.params;
  const existing = await prisma.category.findFirst({ where: { id, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ message: "Categoria nao encontrada" });
  await prisma.category.delete({ where: { id: existing.id } });
  return res.status(204).send();
}
