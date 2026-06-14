import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";

const complementSchema = z.object({
  name: z.string().min(2),
  description: z.string().min(2),
  price: z.coerce.number().min(0),
  imageUrl: z.string().url().nullable().optional(),
  active: z.boolean().optional()
});

export async function listComplements(_req: Request, res: Response) {
  const complements = await prisma.complement.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }]
  });

  return res.json(complements);
}

export async function createComplement(req: Request, res: Response) {
  const body = complementSchema.parse(req.body);
  const complement = await prisma.complement.create({
    data: {
      ...body,
      imageUrl: body.imageUrl || null,
      price: new Prisma.Decimal(body.price)
    }
  });

  return res.status(201).json(complement);
}

export async function updateComplement(req: Request, res: Response) {
  const body = complementSchema.partial().parse(req.body);
  const complement = await prisma.complement.update({
    where: { id: req.params.id },
    data: {
      ...body,
      ...(body.price !== undefined ? { price: new Prisma.Decimal(body.price) } : {}),
      ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl || null } : {})
    }
  });

  return res.json(complement);
}

export async function deleteComplement(req: Request, res: Response) {
  await prisma.complement.delete({ where: { id: req.params.id } });
  return res.status(204).send();
}
