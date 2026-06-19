import type { Request, Response } from "express";
import { prisma } from "../utils/prisma.js";
import { companyWhere } from "../utils/tenant.js";

export async function listNewOrders(req: Request, res: Response) {
  const orders = await prisma.order.findMany({
    where: { ...companyWhere(req), viewedByStaff: false },
    include: { customer: true, items: { include: { product: true } } },
    orderBy: { createdAt: "desc" }
  });

  return res.json({
    count: orders.length,
    orders
  });
}
