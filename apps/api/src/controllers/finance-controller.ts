import { CashEntryType, PaymentMethod, Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { formatOrderCode } from "../utils/order-code.js";
import { recordCashPayments } from "../utils/cash-register.js";
import { companyWhere, getCompanyId } from "../utils/tenant.js";

const money = (value: number) => new Prisma.Decimal(value.toFixed(2));

async function syncPaidOrders(sessionId: string, companyId: string) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const lastClosedSession = await prisma.cashSession.findFirst({
    where: { companyId, closedAt: { not: null } },
    orderBy: { closedAt: "desc" },
    select: { closedAt: true }
  });
  const paidSince =
    lastClosedSession?.closedAt && lastClosedSession.closedAt > startOfToday
      ? lastClosedSession.closedAt
      : startOfToday;

  const paidOrders = await prisma.order.findMany({
    where: {
      companyId,
      paidAt: { gte: paidSince },
      status: { not: "CANCELED" }
    },
    select: {
      id: true,
      orderNumber: true,
      total: true,
      paymentMethod: true,
      paidMethodDetail: true
    }
  });

  if (!paidOrders.length) return;

  await recordCashPayments(
    sessionId,
    companyId,
    paidOrders.map((order) => ({
      amount: order.total,
      paymentMethod: order.paymentMethod,
      orderId: order.id,
      description: `Pagamento pedido #${formatOrderCode(order.orderNumber)} via ${
        order.paidMethodDetail ?? order.paymentMethod
      }`
    }))
  );
}

const openSchema = z.object({
  openingAmount: z.coerce.number().min(0),
  notes: z.string().optional()
});

const entrySchema = z.object({
  type: z.enum(["WITHDRAWAL", "EXPENSE", "MANUAL_INCOME"]),
  amount: z.coerce.number().positive(),
  description: z.string().optional()
});

const closeSchema = z.object({
  closingAmount: z.coerce.number().min(0),
  notes: z.string().optional()
});

async function buildSummary(req: Request) {
  const currentSession = await prisma.cashSession.findFirst({
    where: { ...companyWhere(req), closedAt: null },
    include: { entries: { orderBy: { createdAt: "asc" } } },
    orderBy: { openedAt: "desc" }
  });

  if (!currentSession) {
    return {
      session: null,
      totals: {
        cashOrders: 0,
        pixOrders: 0,
        cardOrders: 0,
        withdrawals: 0,
        expenses: 0,
        manualIncome: 0,
        expectedCash: 0
      }
    };
  }

  await syncPaidOrders(currentSession.id, getCompanyId(req));

  const entries = await prisma.cashEntry.findMany({
    where: { ...companyWhere(req), sessionId: currentSession.id },
    orderBy: { createdAt: "asc" }
  });

  const paymentEntries = entries.filter(
    (entry) => entry.type === CashEntryType.MANUAL_INCOME && entry.paymentMethod
  );
  const cashOrders = paymentEntries
    .filter((item) => item.paymentMethod === PaymentMethod.CASH)
    .reduce((acc, item) => acc + Number(item.amount), 0);
  const pixOrders = paymentEntries
    .filter((item) => item.paymentMethod === PaymentMethod.PIX)
    .reduce((acc, item) => acc + Number(item.amount), 0);
  const cardOrders = paymentEntries
    .filter((item) => item.paymentMethod === PaymentMethod.CARD)
    .reduce((acc, item) => acc + Number(item.amount), 0);

  const withdrawals = entries
    .filter((entry) => entry.type === CashEntryType.WITHDRAWAL)
    .reduce((acc, entry) => acc + Number(entry.amount), 0);

  const expenses = entries
    .filter((entry) => entry.type === CashEntryType.EXPENSE)
    .reduce((acc, entry) => acc + Number(entry.amount), 0);

  const manualIncome = entries
    .filter((entry) => entry.type === CashEntryType.MANUAL_INCOME && !entry.paymentMethod)
    .reduce((acc, entry) => acc + Number(entry.amount), 0);

  const expectedCash =
    Number(currentSession.openingAmount) + cashOrders + manualIncome - withdrawals - expenses;

  const orderIds = entries
    .map((entry) => entry.orderId)
    .filter((orderId): orderId is string => Boolean(orderId));
  const orders = orderIds.length
    ? await prisma.order.findMany({
        where: { ...companyWhere(req), id: { in: orderIds } },
        select: { id: true, orderNumber: true }
      })
    : [];
  const orderCodes = new Map(orders.map((order) => [order.id, formatOrderCode(order.orderNumber)]));

  return {
    session: currentSession,
    totals: {
      cashOrders,
      pixOrders,
      cardOrders,
      withdrawals,
      expenses,
      manualIncome,
      expectedCash
    },
    history: entries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      amount: Number(entry.amount),
      paymentMethod: entry.paymentMethod,
      orderId: entry.orderId,
      orderCode: entry.orderId ? orderCodes.get(entry.orderId) ?? null : null,
      description: entry.description,
      createdAt: entry.createdAt
    }))
  };
}

export async function getFinanceSummary(req: Request, res: Response) {
  const summary = await buildSummary(req);
  return res.json(summary);
}

export async function openCashSession(req: Request, res: Response) {
  const body = openSchema.parse(req.body);

  const hasOpenSession = await prisma.cashSession.findFirst({ where: { ...companyWhere(req), closedAt: null } });
  if (hasOpenSession) {
    return res.status(400).json({ message: "Ja existe um caixa aberto" });
  }

  const openedBy = req.user?.sub ?? "unknown";

  const session = await prisma.cashSession.create({
    data: {
      companyId: getCompanyId(req),
      openedBy,
      openingAmount: money(body.openingAmount),
      notes: body.notes,
      entries: {
        create: {
          companyId: getCompanyId(req),
          type: CashEntryType.OPENING,
          amount: money(body.openingAmount),
          description: "Abertura de caixa"
        }
      }
    },
    include: { entries: true }
  });

  await syncPaidOrders(session.id, getCompanyId(req));

  return res.status(201).json(session);
}

export async function createCashEntry(req: Request, res: Response) {
  const body = entrySchema.parse(req.body);

  const currentSession = await prisma.cashSession.findFirst({ where: { ...companyWhere(req), closedAt: null } });
  if (!currentSession) {
    return res.status(400).json({ message: "Nenhum caixa aberto" });
  }

  const entry = await prisma.cashEntry.create({
    data: {
      companyId: getCompanyId(req),
      sessionId: currentSession.id,
      type: body.type,
      amount: money(body.amount),
      description: body.description
    }
  });

  return res.status(201).json(entry);
}

export async function closeCashSession(req: Request, res: Response) {
  const body = closeSchema.parse(req.body);

  const currentSession = await prisma.cashSession.findFirst({ where: { ...companyWhere(req), closedAt: null } });
  if (!currentSession) {
    return res.status(400).json({ message: "Nenhum caixa aberto" });
  }

  const session = await prisma.cashSession.update({
    where: { id: currentSession.id },
    data: {
      closedAt: new Date(),
      closingAmount: money(body.closingAmount),
      notes: body.notes ?? currentSession.notes
    }
  });

  await prisma.cashEntry.create({
    data: {
      companyId: getCompanyId(req),
      sessionId: session.id,
      type: CashEntryType.CLOSING,
      amount: money(body.closingAmount),
      description: "Fechamento de caixa"
    }
  });

  return res.json(session);
}

export async function listCashSessions(req: Request, res: Response) {
  const dateFrom = req.query.dateFrom?.toString();
  const dateTo = req.query.dateTo?.toString();

  const sessions = await prisma.cashSession.findMany({
    where: {
      ...companyWhere(req),
      ...(dateFrom || dateTo
        ? {
            openedAt: {
              ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00`) } : {}),
              ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59`) } : {})
            }
          }
        : {})
    },
    include: { entries: { orderBy: { createdAt: "asc" } } },
    orderBy: { openedAt: "desc" }
  });

  return res.json(sessions);
}
