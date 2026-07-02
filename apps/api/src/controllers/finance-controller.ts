import { CashEntryType, PaymentMethod, Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { formatOrderCode } from "../utils/order-code.js";
import { recordCashPayments } from "../utils/cash-register.js";
import { companyWhere, getCompanyId } from "../utils/tenant.js";
import { accessMetadata, audit } from "../utils/audit.js";

const money = (value: number) => new Prisma.Decimal(value.toFixed(2));

const entryCategories = [
  "SALE_CASH", "SALE_PIX", "SALE_CREDIT", "SALE_DEBIT", "ACCOUNT_RECEIPT",
  "REVERSED_WITHDRAWAL", "OTHER_INCOME", "WITHDRAWAL", "EMERGENCY_PURCHASE",
  "EMPLOYEE_ADVANCE", "SUPPLIER_PAYMENT", "INITIAL_CHANGE", "OTHER_EXPENSE"
] as const;

function dateRange(req: Request, field: "createdAt" | "openedAt" = "createdAt") {
  const from = req.query.dateFrom?.toString();
  const to = req.query.dateTo?.toString();
  return from || to ? {
    [field]: {
      ...(from ? { gte: new Date(`${from}T00:00:00-03:00`) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59.999-03:00`) } : {})
    }
  } : {};
}

async function currentUser(req: Request) {
  return prisma.user.findUniqueOrThrow({
    where: { id: req.user!.sub },
    select: { id: true, name: true }
  });
}

async function currentSession(req: Request) {
  return prisma.cashSession.findFirst({
    where: {
      ...companyWhere(req),
      openedBy: req.user!.sub,
      closedAt: null,
      deletedAt: null
    },
    orderBy: { openedAt: "desc" }
  });
}

async function syncPaidOrders(sessionId: string, companyId: string) {
  const paidOrders = await prisma.order.findMany({
    where: {
      companyId,
      paidAt: { not: null },
      status: { not: "CANCELED" }
    },
    select: {
      id: true, orderNumber: true, total: true, paymentMethod: true, paidMethodDetail: true
    }
  });
  await recordCashPayments(sessionId, companyId, paidOrders.map((order) => ({
    amount: order.total,
    paymentMethod: order.paymentMethod,
    paymentDetail: order.paidMethodDetail,
    orderId: order.id,
    description: `Pagamento pedido #${formatOrderCode(order.orderNumber)} via ${order.paidMethodDetail ?? order.paymentMethod}`
  })));
}

function summarizeEntries(openingAmount: number, entries: Array<{
  type: CashEntryType;
  amount: Prisma.Decimal;
  paymentMethod: PaymentMethod | null;
  paymentDetail: string | null;
  direction: string;
  deletedAt: Date | null;
  orderId: string | null;
  category: string | null;
}>) {
  const active = entries.filter((entry) => !entry.deletedAt);
  const sum = (predicate: (entry: typeof active[number]) => boolean) =>
    active.filter(predicate).reduce((total, entry) => total + Number(entry.amount), 0);
  const cash = sum((entry) => entry.paymentMethod === "CASH" && entry.direction === "IN");
  const pix = sum((entry) => entry.paymentMethod === "PIX" && entry.direction === "IN");
  const credit = sum((entry) => entry.paymentDetail === "Cartao Credito" && entry.direction === "IN");
  const debit = sum((entry) => entry.paymentDetail === "Cartao Debito" && entry.direction === "IN");
  const cardOther = sum((entry) => entry.paymentMethod === "CARD" && !entry.paymentDetail && entry.direction === "IN");
  const withdrawals = sum((entry) => entry.category === "WITHDRAWAL" && entry.direction === "OUT");
  const expenses = sum((entry) => entry.direction === "OUT" && entry.type !== "CLOSING");
  const otherIncome = sum((entry) => entry.direction === "IN" && !entry.paymentMethod && entry.type !== "OPENING");
  const totalSales = cash + pix + credit + debit + cardOther;
  const expectedCash = openingAmount + cash + otherIncome - expenses;
  return { cash, pix, credit, debit, cardOther, totalSales, withdrawals, expenses, otherIncome, expectedCash };
}

async function buildSummary(req: Request) {
  const session = await currentSession(req);
  if (!session) return { session: null, totals: null, history: [] };
  await syncPaidOrders(session.id, getCompanyId(req));
  const entries = await prisma.cashEntry.findMany({
    where: { companyId: getCompanyId(req), sessionId: session.id },
    orderBy: { createdAt: "desc" }
  });
  const totals = summarizeEntries(Number(session.openingAmount), entries);
  const orderIds = entries.flatMap((entry) => entry.orderId ? [entry.orderId] : []);
  const orders = await prisma.order.findMany({
    where: { companyId: getCompanyId(req), id: { in: orderIds } },
    select: { id: true, orderNumber: true }
  });
  const codes = new Map(orders.map((order) => [order.id, formatOrderCode(order.orderNumber)]));
  return {
    session: {
      ...session,
      openingAmount: Number(session.openingAmount)
    },
    totals,
    history: entries.map((entry) => ({
      ...entry,
      amount: Number(entry.amount),
      orderCode: entry.orderId ? codes.get(entry.orderId) ?? null : null
    }))
  };
}

export async function getFinanceSummary(req: Request, res: Response) {
  return res.json(await buildSummary(req));
}

export async function getFinanceDashboard(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const week = new Date(today); week.setDate(week.getDate() - 6);
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  const sixMonths = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const [orders, entries, openCount, closedCount, payables] = await Promise.all([
    prisma.order.findMany({
      where: { companyId, paidAt: { gte: sixMonths }, status: { not: "CANCELED" }, deletedAt: null },
      select: { total: true, paidAt: true, paymentMethod: true, paidMethodDetail: true }
    }),
    prisma.cashEntry.findMany({
      where: { companyId, createdAt: { gte: month }, deletedAt: null },
      select: { amount: true, direction: true, createdAt: true }
    }),
    prisma.cashSession.count({ where: { companyId, closedAt: null, deletedAt: null } }),
    prisma.cashSession.count({ where: { companyId, closedAt: { not: null }, openedAt: { gte: month }, deletedAt: null } }),
    prisma.accountPayable.findMany({ where: { companyId, deletedAt: null, status: { not: "PAID" } } })
  ]);
  const sales = (since: Date) => orders.filter((order) => order.paidAt && order.paidAt >= since)
    .reduce((total, order) => total + Number(order.total), 0);
  const expenses = (since: Date) => entries.filter((entry) => entry.direction === "OUT" && entry.createdAt >= since)
    .reduce((total, entry) => total + Number(entry.amount), 0);
  const salesToday = sales(today);
  const salesMonth = sales(month);
  const expensesToday = expenses(today);
  const expensesMonth = expenses(month);
  const daily = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(week); day.setDate(week.getDate() + index);
    const next = new Date(day); next.setDate(day.getDate() + 1);
    return {
      date: day.toISOString().slice(0, 10),
      sales: orders.filter((order) => order.paidAt && order.paidAt >= day && order.paidAt < next)
        .reduce((total, order) => total + Number(order.total), 0)
    };
  });
  const paymentMethods = orders.reduce<Record<string, number>>((acc, order) => {
    const key = order.paidMethodDetail ?? order.paymentMethod;
    acc[key] = (acc[key] ?? 0) + Number(order.total);
    return acc;
  }, {});
  const monthly = Array.from({ length: 6 }, (_, index) => {
    const start = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return {
      month: start.toISOString().slice(0, 7),
      sales: orders.filter((order) => order.paidAt && order.paidAt >= start && order.paidAt < end)
        .reduce((total, order) => total + Number(order.total), 0)
    };
  });
  return res.json({
    revenueToday: salesToday,
    revenueWeek: sales(week),
    revenueMonth: salesMonth,
    averageTicket: orders.length ? salesMonth / orders.length : 0,
    ordersToday: orders.filter((order) => order.paidAt && order.paidAt >= today).length,
    estimatedProfit: salesMonth - expensesMonth,
    expensesToday,
    expensesMonth,
    currentBalance: salesMonth - expensesMonth,
    openCashRegisters: openCount,
    closedCashRegisters: closedCount,
    overduePayables: payables.filter((item) => item.dueDate < now).length,
    dueSoonPayables: payables.filter((item) => item.dueDate >= now && item.dueDate <= new Date(now.getTime() + 3 * 86400000)).length,
    daily,
    monthly,
    paymentMethods
  });
}

export async function openCashSession(req: Request, res: Response) {
  const body = z.object({
    openingAmount: z.coerce.number().min(0),
    notes: z.string().max(500).optional()
  }).parse(req.body);
  const operator = await currentUser(req);
  if (await currentSession(req)) return res.status(400).json({ message: "Este operador ja possui um caixa aberto" });
  const metadata = accessMetadata(req);
  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.cashSession.create({
      data: {
        companyId: getCompanyId(req),
        openedBy: operator.id,
        operatorName: operator.name,
        openingAmount: money(body.openingAmount),
        openingIp: metadata.ip,
        openingDevice: metadata.device,
        notes: body.notes,
        entries: {
          create: {
            companyId: getCompanyId(req),
            type: "OPENING",
            category: "INITIAL_CHANGE",
            direction: "IN",
            amount: money(body.openingAmount),
            operatorId: operator.id,
            operatorName: operator.name,
            reason: "Abertura de caixa",
            description: body.notes
          }
        }
      }
    });
    await audit(req, { action: "CASH_OPENED", entity: "CashSession", entityId: created.id, newValue: { openingAmount: body.openingAmount, notes: body.notes } }, tx);
    return created;
  });
  return res.status(201).json(session);
}

export async function createCashEntry(req: Request, res: Response) {
  const body = z.object({
    category: z.enum(entryCategories),
    amount: z.coerce.number().positive(),
    reason: z.string().min(3).max(160),
    description: z.string().max(500).optional()
  }).parse(req.body);
  const session = await currentSession(req);
  if (!session || session.locked) return res.status(400).json({ message: "Nenhum caixa aberto e disponivel para este operador" });
  const operator = await currentUser(req);
  const outCategories = new Set(["WITHDRAWAL", "EMERGENCY_PURCHASE", "EMPLOYEE_ADVANCE", "SUPPLIER_PAYMENT", "INITIAL_CHANGE", "OTHER_EXPENSE"]);
  const direction = outCategories.has(body.category) ? "OUT" : "IN";
  const type: CashEntryType = body.category === "WITHDRAWAL" ? "WITHDRAWAL" : direction === "OUT" ? "EXPENSE" : "MANUAL_INCOME";
  const entry = await prisma.$transaction(async (tx) => {
    const created = await tx.cashEntry.create({
      data: {
        companyId: getCompanyId(req), sessionId: session.id, type, category: body.category,
        direction, amount: money(body.amount), operatorId: operator.id, operatorName: operator.name,
        reason: body.reason, description: body.description
      }
    });
    await audit(req, { action: "CASH_ENTRY_CREATED", entity: "CashEntry", entityId: created.id, newValue: { ...body, direction } }, tx);
    return created;
  });
  return res.status(201).json(entry);
}

export async function deleteCashEntry(req: Request, res: Response) {
  const body = z.object({ reason: z.string().min(5).max(300) }).parse(req.body);
  const entry = await prisma.cashEntry.findFirst({
    where: { id: req.params.id, companyId: getCompanyId(req), deletedAt: null },
    include: { session: true }
  });
  if (!entry) return res.status(404).json({ message: "Movimentacao nao encontrada" });
  if (entry.session.closedAt || entry.session.locked) return res.status(400).json({ message: "Caixa fechado nao permite alteracoes" });
  if (entry.type === "OPENING" || entry.type === "CLOSING" || entry.orderId) {
    return res.status(400).json({ message: "Esta movimentacao nao pode ser excluida" });
  }
  await prisma.$transaction(async (tx) => {
    await tx.cashEntry.update({
      where: { id: entry.id },
      data: { deletedAt: new Date(), deletedBy: req.user!.sub, deletionReason: body.reason }
    });
    await audit(req, { action: "CASH_ENTRY_DELETED", entity: "CashEntry", entityId: entry.id, oldValue: { amount: Number(entry.amount), category: entry.category }, newValue: { deletionReason: body.reason } }, tx);
  });
  return res.status(204).send();
}

export async function closeCashSession(req: Request, res: Response) {
  const body = z.object({
    closingAmount: z.coerce.number().min(0),
    justification: z.string().max(500).optional()
  }).parse(req.body);
  const session = await currentSession(req);
  if (!session) return res.status(400).json({ message: "Nenhum caixa aberto para este operador" });
  await syncPaidOrders(session.id, getCompanyId(req));
  const entries = await prisma.cashEntry.findMany({ where: { sessionId: session.id, companyId: getCompanyId(req) } });
  const totals = summarizeEntries(Number(session.openingAmount), entries);
  const difference = body.closingAmount - totals.expectedCash;
  if (Math.abs(difference) >= 0.01 && (!body.justification || body.justification.trim().length < 5)) {
    return res.status(400).json({ message: "Informe uma justificativa para a divergencia do caixa" });
  }
  const metadata = accessMetadata(req);
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.cashSession.update({
      where: { id: session.id },
      data: {
        closedAt: new Date(), closingAmount: money(body.closingAmount), expectedAmount: money(totals.expectedCash),
        difference: money(difference), closingNotes: body.justification, closedBy: req.user!.sub,
        closingIp: metadata.ip, closingDevice: metadata.device, locked: true
      }
    });
    await tx.cashEntry.create({
      data: {
        companyId: getCompanyId(req), sessionId: session.id, type: "CLOSING", category: "CLOSING",
        direction: "OUT", amount: money(body.closingAmount), operatorId: req.user!.sub,
        operatorName: session.operatorName, reason: "Fechamento de caixa", description: body.justification
      }
    });
    await audit(req, { action: "CASH_CLOSED", entity: "CashSession", entityId: session.id, newValue: { ...totals, counted: body.closingAmount, difference, justification: body.justification } }, tx);
    return result;
  });
  return res.json(updated);
}

export async function reopenCashSession(req: Request, res: Response) {
  const body = z.object({ reason: z.string().min(10).max(500) }).parse(req.body);
  const session = await prisma.cashSession.findFirst({ where: { id: req.params.id, companyId: getCompanyId(req), deletedAt: null } });
  if (!session) return res.status(404).json({ message: "Caixa nao encontrado" });
  if (!session.closedAt) return res.status(400).json({ message: "Caixa ja esta aberto" });
  if (await prisma.cashSession.findFirst({ where: { companyId: getCompanyId(req), openedBy: session.openedBy, closedAt: null, deletedAt: null } })) {
    return res.status(400).json({ message: "O operador ja possui outro caixa aberto" });
  }
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.cashSession.update({
      where: { id: session.id },
      data: {
        closedAt: null, closingAmount: null, expectedAmount: null, difference: null, closingNotes: null,
        closedBy: null, locked: false, reopenedAt: new Date(), reopenedBy: req.user!.sub, reopenReason: body.reason
      }
    });
    await audit(req, { action: "CASH_REOPENED", entity: "CashSession", entityId: session.id, oldValue: { closedAt: session.closedAt }, newValue: { reason: body.reason } }, tx);
    return result;
  });
  return res.json(updated);
}

export async function listCashSessions(req: Request, res: Response) {
  const operatorId = req.query.operatorId?.toString();
  const sessions = await prisma.cashSession.findMany({
    where: {
      companyId: getCompanyId(req), deletedAt: null, ...dateRange(req, "openedAt"),
      ...(operatorId ? { openedBy: operatorId } : {})
    },
    include: { entries: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } },
    orderBy: { openedAt: "desc" }
  });
  return res.json(sessions.map((session) => ({
    ...session,
    openingAmount: Number(session.openingAmount),
    closingAmount: session.closingAmount ? Number(session.closingAmount) : null,
    expectedAmount: session.expectedAmount ? Number(session.expectedAmount) : null,
    difference: session.difference ? Number(session.difference) : null,
    totals: summarizeEntries(Number(session.openingAmount), session.entries)
  })));
}

export async function listAuditLogs(req: Request, res: Response) {
  const action = req.query.action?.toString();
  const userId = req.query.userId?.toString();
  const entity = req.query.entity?.toString();
  return res.json(await prisma.auditLog.findMany({
    where: {
      companyId: getCompanyId(req),
      ...dateRange(req),
      ...(action ? { action } : {}),
      ...(userId ? { userId } : {}),
      ...(entity ? { entity } : {})
    },
    orderBy: { createdAt: "desc" },
    take: 500
  }));
}

export async function listPdvAuditLogs(req: Request, res: Response) {
  const tableId = req.query.tableId?.toString();
  const pdvActions = [
    "TABLE_SESSION_OPENED",
    "TABLE_SESSION_APPROVED",
    "TABLE_SESSION_REOPENED",
    "TABLE_ORDER_CREATED",
    "TABLE_ACCOUNT_CLOSED",
    "TABLE_TRANSFERRED",
    "TABLES_MERGED",
    "TABLE_DEACTIVATED",
    "ORDER_CANCELED",
    "ORDER_STATUS_CHANGED"
  ];
  const logs = await prisma.auditLog.findMany({
    where: {
      companyId: getCompanyId(req),
      ...dateRange(req),
      action: { in: pdvActions }
    },
    orderBy: { createdAt: "desc" },
    take: 300
  });

  const filtered = tableId
    ? logs.filter((log) => {
        const oldValue = log.oldValue && typeof log.oldValue === "object" ? log.oldValue as Record<string, unknown> : {};
        const newValue = log.newValue && typeof log.newValue === "object" ? log.newValue as Record<string, unknown> : {};
        return oldValue.tableId === tableId || newValue.tableId === tableId || log.entityId === tableId;
      })
    : logs;

  return res.json(filtered);
}

const payableSchema = z.object({
  description: z.string().min(3), category: z.string().min(2),
  amount: z.coerce.number().positive(), dueDate: z.coerce.date(), notes: z.string().optional()
});
const receivableSchema = z.object({
  customerName: z.string().min(2), description: z.string().optional(),
  amount: z.coerce.number().positive(), dueDate: z.coerce.date(), notes: z.string().optional()
});

export async function listPayables(req: Request, res: Response) {
  const now = new Date();
  const rows = await prisma.accountPayable.findMany({ where: { companyId: getCompanyId(req), deletedAt: null }, orderBy: { dueDate: "asc" } });
  return res.json(rows.map((row) => ({ ...row, amount: Number(row.amount), effectiveStatus: row.status === "PENDING" && row.dueDate < now ? "OVERDUE" : row.status })));
}
export async function createPayable(req: Request, res: Response) {
  const body = payableSchema.parse(req.body);
  const row = await prisma.accountPayable.create({ data: { ...body, amount: money(body.amount), companyId: getCompanyId(req), createdBy: req.user!.sub } });
  await audit(req, { action: "PAYABLE_CREATED", entity: "AccountPayable", entityId: row.id, newValue: body });
  return res.status(201).json(row);
}
export async function payPayable(req: Request, res: Response) {
  const row = await prisma.accountPayable.findFirst({ where: { id: req.params.id, companyId: getCompanyId(req), deletedAt: null } });
  if (!row) return res.status(404).json({ message: "Conta nao encontrada" });
  const session = await currentSession(req);
  if (!session) return res.status(400).json({ message: "Abra seu caixa antes de pagar uma conta" });
  await prisma.$transaction(async (tx) => {
    await tx.accountPayable.update({ where: { id: row.id }, data: { status: "PAID", paidAt: new Date() } });
    await tx.cashEntry.create({ data: {
      companyId: getCompanyId(req), sessionId: session.id, type: "EXPENSE", category: "SUPPLIER_PAYMENT",
      direction: "OUT", amount: row.amount, operatorId: req.user!.sub, reason: `Pagamento: ${row.description}`
    } });
    await audit(req, { action: "PAYABLE_PAID", entity: "AccountPayable", entityId: row.id, oldValue: { status: row.status }, newValue: { status: "PAID" } }, tx);
  });
  return res.status(204).send();
}

export async function listReceivables(req: Request, res: Response) {
  const now = new Date();
  const rows = await prisma.accountReceivable.findMany({ where: { companyId: getCompanyId(req), deletedAt: null }, orderBy: { dueDate: "asc" } });
  return res.json(rows.map((row) => ({ ...row, amount: Number(row.amount), effectiveStatus: row.status === "OPEN" && row.dueDate < now ? "OVERDUE" : row.status })));
}
export async function createReceivable(req: Request, res: Response) {
  const body = receivableSchema.parse(req.body);
  const row = await prisma.accountReceivable.create({ data: { ...body, amount: money(body.amount), companyId: getCompanyId(req), createdBy: req.user!.sub } });
  await audit(req, { action: "RECEIVABLE_CREATED", entity: "AccountReceivable", entityId: row.id, newValue: body });
  return res.status(201).json(row);
}
export async function receiveReceivable(req: Request, res: Response) {
  const row = await prisma.accountReceivable.findFirst({ where: { id: req.params.id, companyId: getCompanyId(req), deletedAt: null } });
  if (!row) return res.status(404).json({ message: "Conta nao encontrada" });
  const session = await currentSession(req);
  if (!session) return res.status(400).json({ message: "Abra seu caixa antes de receber uma conta" });
  await prisma.$transaction(async (tx) => {
    await tx.accountReceivable.update({ where: { id: row.id }, data: { status: "RECEIVED", receivedAt: new Date() } });
    await tx.cashEntry.create({ data: {
      companyId: getCompanyId(req), sessionId: session.id, type: "MANUAL_INCOME", category: "ACCOUNT_RECEIPT",
      direction: "IN", amount: row.amount, operatorId: req.user!.sub, reason: `Recebimento: ${row.customerName}`
    } });
    await audit(req, { action: "RECEIVABLE_RECEIVED", entity: "AccountReceivable", entityId: row.id, oldValue: { status: row.status }, newValue: { status: "RECEIVED" } }, tx);
  });
  return res.status(204).send();
}
