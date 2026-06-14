import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";

const complementSchema = z.object({
  name: z.string().trim().min(2, "Informe um nome com pelo menos 2 caracteres"),
  description: z.string().trim().min(2, "Informe uma descricao com pelo menos 2 caracteres"),
  price: z.preprocess(
    (value) => typeof value === "string" ? value.replace(",", ".") : value,
    z.coerce.number({ invalid_type_error: "Informe um preco valido" }).min(0, "O preco nao pode ser negativo")
  ),
  imageUrl: z.preprocess(
    (value) => typeof value === "string" && !value.trim() ? null : value,
    z.string().url("Informe uma URL de imagem valida").nullable().optional()
  ),
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
