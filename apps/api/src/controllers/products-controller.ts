import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";

const schema = z.object({
  name: z.string().min(2),
  description: z.string().min(2),
  price: z.coerce.number().positive(),
  promoPrice: z.coerce.number().positive().optional(),
  imageUrl: z.string().url().optional(),
  categoryId: z.string().min(1),
  active: z.boolean().optional(),
  available: z.boolean().optional()
});

export async function listProducts(req: Request, res: Response) {
  const search = req.query.search?.toString();
  const categoryId = req.query.categoryId?.toString();

  const where: Prisma.ProductWhereInput = {
    ...(search
      ? {
          OR: [
            { name: { contains: search } },
            { description: { contains: search } }
          ]
        }
      : {}),
    ...(categoryId ? { categoryId } : {})
  };

  const products = await prisma.product.findMany({
    where,
    include: { category: true },
    orderBy: { createdAt: "desc" }
  });

  return res.json(products);
}

export async function createProduct(req: Request, res: Response) {
  const body = schema.parse(req.body);
  const product = await prisma.product.create({
    data: {
      ...body,
      price: new Prisma.Decimal(body.price),
      promoPrice: body.promoPrice ? new Prisma.Decimal(body.promoPrice) : undefined
    }
  });

  return res.status(201).json(product);
}

export async function updateProduct(req: Request, res: Response) {
  const body = schema.partial().parse(req.body);
  const { id } = req.params;

  const product = await prisma.product.update({
    where: { id },
    data: {
      ...body,
      ...(body.price ? { price: new Prisma.Decimal(body.price) } : {}),
      ...(body.promoPrice ? { promoPrice: new Prisma.Decimal(body.promoPrice) } : {})
    }
  });

  return res.json(product);
}

export async function deleteProduct(req: Request, res: Response) {
  const { id } = req.params;
  await prisma.product.delete({ where: { id } });
  return res.status(204).send();
}

export async function toggleFavorite(req: Request, res: Response) {
  const schemaFavorite = z.object({ phone: z.string().min(8), productId: z.string() });
  const body = schemaFavorite.parse(req.body);

  const existing = await prisma.favorite.findUnique({
    where: { phone_productId: { phone: body.phone, productId: body.productId } }
  });

  if (existing) {
    await prisma.favorite.delete({ where: { id: existing.id } });
    return res.json({ favorited: false });
  }

  await prisma.favorite.create({ data: body });
  return res.json({ favorited: true });
}
