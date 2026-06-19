import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { companyWhere } from "../utils/tenant.js";

export async function lookupCustomer(req: Request, res: Response) {
  const phone = req.query.phone?.toString().trim() ?? "";
  if (phone.replace(/\D/g, "").length < 8) {
    return res.status(400).json({ message: "Telefone invalido" });
  }

  const digits = phone.replace(/\D/g, "");
  const candidates = Array.from(new Set([phone, digits, `+${digits}`]));
  const customer = await prisma.customer.findFirst({
    where: { phone: { in: candidates }, ...companyWhere(req) },
    select: { name: true }
  });

  return res.json(customer ?? null);
}

const customerUpdateSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().min(8).optional(),
  email: z.string().email().nullable().optional(),
  address: z.string().min(3).optional(),
  number: z.string().min(1).optional(),
  district: z.string().min(2).optional(),
  complement: z.string().nullable().optional()
});

export async function listCustomers(req: Request, res: Response) {
  const search = req.query.search?.toString();

  const customers = await prisma.customer.findMany({
    where: {
      ...companyWhere(req),
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { phone: { contains: search } },
              { email: { contains: search } }
            ]
          }
        : {})
    },
    include: {
      _count: {
        select: { orders: true, addresses: true }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  return res.json(customers);
}

export async function updateCustomer(req: Request, res: Response) {
  const body = customerUpdateSchema.parse(req.body);
  const customerId = req.params.id;

  const existing = await prisma.customer.findFirst({ where: { id: customerId, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ message: "Cliente nao encontrado" });
  const customer = await prisma.customer.update({
    where: { id: existing.id },
    data: body
  });

  return res.json(customer);
}

export async function deleteCustomer(req: Request, res: Response) {
  const customerId = req.params.id;

  const existing = await prisma.customer.findFirst({
    where: { id: customerId, ...companyWhere(req) },
    select: { id: true }
  });

  if (!existing) {
    return res.status(404).json({ message: "Cliente nao encontrado" });
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.deleteMany({ where: { customerId } });
    await tx.customerAddress.deleteMany({ where: { customerId } });
    await tx.customer.delete({ where: { id: customerId } });
  });

  return res.status(204).send();
}
