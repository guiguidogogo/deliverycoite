import type { Request, Response } from "express";
import dayjs from "dayjs";
import { prisma } from "../utils/prisma.js";
import { companyWhere } from "../utils/tenant.js";

export async function getDashboard(req: Request, res: Response) {
  const startDay = dayjs().startOf("day").toDate();
  const endDay = dayjs().endOf("day").toDate();
  const startMonth = dayjs().startOf("month").toDate();
  const recognizedRevenue = {
    ...companyWhere(req),
    status: { not: "CANCELED" as const },
    OR: [
      { paidAt: { not: null } },
      { status: { in: ["DELIVERED" as const, "FINISHED" as const] } }
    ]
  };

  const [ordersToday, paidOrdersToday, salesToday, salesMonth, pendingOrders, soldOrders] = await Promise.all([
    prisma.order.count({ where: { ...companyWhere(req), createdAt: { gte: startDay, lte: endDay } } }),
    prisma.order.count({
      where: {
        createdAt: { gte: startDay, lte: endDay },
        ...recognizedRevenue
      }
    }),
    prisma.order.aggregate({
      where: {
        createdAt: { gte: startDay, lte: endDay },
        ...recognizedRevenue
      },
      _sum: { total: true }
    }),
    prisma.order.aggregate({
      where: {
        createdAt: { gte: startMonth },
        ...recognizedRevenue
      },
      _sum: { total: true }
    }),
    prisma.order.count({ where: { ...companyWhere(req), status: { in: ["RECEIVED", "PREPARING", "OUT_FOR_DELIVERY"] } } }),
    prisma.order.findMany({
      where: {
        createdAt: { gte: startMonth },
        ...recognizedRevenue
      },
      include: { items: true }
    })
  ]);

  const soldMap = new Map<string, number>();
  soldOrders.forEach((order) => {
    order.items.forEach((item) => {
      soldMap.set(item.productId, (soldMap.get(item.productId) ?? 0) + item.quantity);
    });
  });

  const topIds = [...soldMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
  const topProducts = await prisma.product.findMany({ where: { ...companyWhere(req), id: { in: topIds } } });

  const topSelling = topIds.map((id) => ({
    product: topProducts.find((p) => p.id === id)?.name ?? "Produto removido",
    quantity: soldMap.get(id) ?? 0
  }));

  const avgTicket = paidOrdersToday > 0 ? Number(salesToday._sum.total ?? 0) / paidOrdersToday : 0;

  return res.json({
    ordersToday,
    salesToday: Number(salesToday._sum.total ?? 0),
    salesMonth: Number(salesMonth._sum.total ?? 0),
    avgTicket,
    topSelling,
    pendingOrders
  });
}
