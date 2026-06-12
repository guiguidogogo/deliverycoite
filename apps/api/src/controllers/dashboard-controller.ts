import type { Request, Response } from "express";
import { OrderStatus } from "@prisma/client";
import dayjs from "dayjs";
import { prisma } from "../utils/prisma.js";

export async function getDashboard(_req: Request, res: Response) {
  const startDay = dayjs().startOf("day").toDate();
  const endDay = dayjs().endOf("day").toDate();
  const startMonth = dayjs().startOf("month").toDate();
  const paidStatuses: OrderStatus[] = ["DELIVERED", "FINISHED"];

  const [ordersToday, salesToday, salesMonth, pendingOrders, deliveredOrders] = await Promise.all([
    prisma.order.count({ where: { createdAt: { gte: startDay, lte: endDay } } }),
    prisma.order.aggregate({
      where: { createdAt: { gte: startDay, lte: endDay }, status: { in: paidStatuses } },
      _sum: { total: true }
    }),
    prisma.order.aggregate({
      where: { createdAt: { gte: startMonth }, status: { in: paidStatuses } },
      _sum: { total: true }
    }),
    prisma.order.count({ where: { status: { in: ["RECEIVED", "PREPARING", "OUT_FOR_DELIVERY"] } } }),
    prisma.order.findMany({
      where: { status: "DELIVERED", createdAt: { gte: startMonth } },
      include: { items: true }
    })
  ]);

  const soldMap = new Map<string, number>();
  deliveredOrders.forEach((order) => {
    order.items.forEach((item) => {
      soldMap.set(item.productId, (soldMap.get(item.productId) ?? 0) + item.quantity);
    });
  });

  const topIds = [...soldMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
  const topProducts = await prisma.product.findMany({ where: { id: { in: topIds } } });

  const topSelling = topIds.map((id) => ({
    product: topProducts.find((p) => p.id === id)?.name ?? "Produto removido",
    quantity: soldMap.get(id) ?? 0
  }));

  const avgTicket = ordersToday > 0 ? Number(salesToday._sum.total ?? 0) / ordersToday : 0;

  return res.json({
    ordersToday,
    salesToday: Number(salesToday._sum.total ?? 0),
    salesMonth: Number(salesMonth._sum.total ?? 0),
    avgTicket,
    topSelling,
    pendingOrders
  });
}
