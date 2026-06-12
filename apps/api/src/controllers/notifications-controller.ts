import type { Request, Response } from "express";
import { prisma } from "../utils/prisma.js";

export async function listNewOrders(_req: Request, res: Response) {
  const orders = await prisma.order.findMany({
    where: { viewedByStaff: false },
    include: { customer: true, items: { include: { product: true } } },
    orderBy: { createdAt: "desc" }
  });

  return res.json({
    count: orders.length,
    orders
  });
}
