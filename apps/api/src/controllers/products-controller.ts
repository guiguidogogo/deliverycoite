import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";

const schema = z.object({
  name: z.string().min(2),
  description: z.string().min(2),
  price: z.coerce.number().positive(),
  promoPrice: z.coerce.number().positive().optional(),
  imageUrl: z.string().url().nullable().optional(),
  categoryId: z.string().min(1),
  active: z.boolean().optional(),
  available: z.boolean().optional(),
  complementLinks: z.array(z.object({
    complementId: z.string().min(1),
    required: z.boolean().default(false),
    sortOrder: z.coerce.number().int().min(0).default(0)
  })).optional()
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
    include: {
      category: true,
      complements: {
        include: { complement: true },
        orderBy: { sortOrder: "asc" }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  return res.json(products);
}

export async function createProduct(req: Request, res: Response) {
  const body = schema.parse(req.body);
  const { complementLinks, ...productData } = body;
  const product = await prisma.product.create({
    data: {
      ...productData,
      imageUrl: productData.imageUrl || null,
      price: new Prisma.Decimal(body.price),
      promoPrice: body.promoPrice ? new Prisma.Decimal(body.promoPrice) : undefined,
      complements: complementLinks?.length ? {
        create: complementLinks
      } : undefined
    },
    include: {
      category: true,
      complements: { include: { complement: true }, orderBy: { sortOrder: "asc" } }
    }
  });

  return res.status(201).json(product);
}

export async function updateProduct(req: Request, res: Response) {
  const body = schema.partial().parse(req.body);
  const { id } = req.params;
  const { complementLinks, ...productData } = body;

  const product = await prisma.$transaction(async (tx) => {
    if (complementLinks !== undefined) {
      await tx.productComplement.deleteMany({ where: { productId: id } });
    }

    return tx.product.update({
      where: { id },
      data: {
        ...productData,
        ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl || null } : {}),
        ...(body.price !== undefined ? { price: new Prisma.Decimal(body.price) } : {}),
        ...(body.promoPrice !== undefined
          ? { promoPrice: body.promoPrice ? new Prisma.Decimal(body.promoPrice) : null }
          : {}),
        ...(complementLinks?.length ? { complements: { create: complementLinks } } : {})
      },
      include: {
        category: true,
        complements: { include: { complement: true }, orderBy: { sortOrder: "asc" } }
      }
    });
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
