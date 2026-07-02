import crypto from "node:crypto";
import type { Request, Response } from "express";
import { FulfillmentType, OrderSource, PaymentMethod, Prisma, TableSessionStatus, TableStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { companyWhere, getCompanyId } from "../utils/tenant.js";
import { recordCashPayments } from "../utils/cash-register.js";
import { validateAndDecrementStock } from "../utils/stock.js";
import { audit } from "../utils/audit.js";

const areaSchema = z.object({
  name: z.string().min(2, "Nome do setor obrigatorio").max(80),
  active: z.boolean().optional()
});

const tableSchema = z.object({
  number: z.coerce.number().int().positive(),
  name: z.string().max(80).optional().nullable(),
  areaId: z.string().optional().nullable(),
  seats: z.coerce.number().int().min(1).max(50).default(4),
  status: z.nativeEnum(TableStatus).optional(),
  active: z.boolean().optional()
});

const statusSchema = z.object({
  status: z.nativeEnum(TableStatus)
});

const tableSessionRequestSchema = z.object({
  name: z.string().min(2, "Nome obrigatorio").max(120),
  phone: z.string().min(8, "Telefone obrigatorio").max(30),
  email: z.string().email("Email invalido").max(160)
});

const tableOrderSchema = z.object({
  customerName: z.string().min(2).default("Cliente da mesa"),
  notes: z.string().optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.PIX),
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.coerce.number().int().positive(),
    complements: z.array(z.object({
      complementId: z.string(),
      quantity: z.coerce.number().int().min(1).max(20)
    })).default([])
  })).min(1)
});

const closeTableSchema = z.object({
  paymentMethod: z.enum(["CASH", "PIX", "DEBIT", "CREDIT", "CARD"]),
  notes: z.string().optional(),
  discount: z.coerce.number().min(0).default(0),
  discountReason: z.string().max(180).optional(),
  serviceFeeEnabled: z.boolean().optional(),
  serviceFeePercent: z.coerce.number().min(0).max(30).optional(),
  payments: z.array(z.object({
    method: z.enum(["CASH", "PIX", "DEBIT", "CREDIT", "CARD"]),
    amount: z.coerce.number().positive()
  })).optional(),
  billSplit: z.array(z.object({
    name: z.string().min(1).max(80),
    subtotal: z.coerce.number().min(0),
    serviceFee: z.coerce.number().min(0).default(0),
    discount: z.coerce.number().min(0).default(0),
    total: z.coerce.number().min(0),
    items: z.array(z.string().max(180)).default([])
  })).optional()
});

const tablePrintJobSchema = z.object({
  type: z.enum(["PRE_BILL", "RECEIPT"]).default("PRE_BILL"),
  notes: z.string().max(500).optional(),
  discount: z.coerce.number().min(0).default(0),
  serviceFeeEnabled: z.boolean().optional(),
  serviceFeePercent: z.coerce.number().min(0).max(30).optional(),
  payments: z.array(z.object({
    method: z.enum(["CASH", "PIX", "DEBIT", "CREDIT", "CARD"]),
    amount: z.coerce.number().positive()
  })).optional(),
  billSplit: z.array(z.object({
    name: z.string().min(1).max(80),
    subtotal: z.coerce.number().min(0),
    serviceFee: z.coerce.number().min(0).default(0),
    discount: z.coerce.number().min(0).default(0),
    total: z.coerce.number().min(0),
    items: z.array(z.string().max(180)).default([])
  })).optional(),
  paymentDetail: z.string().max(240).optional()
});

const tableMoveSchema = z.object({
  targetTableId: z.string().min(1),
  mode: z.enum(["TRANSFER", "MERGE"]).default("TRANSFER")
});

function publicTableUrl(req: Request, table: { number: number }, explicitSubdomain?: string | null) {
  const rootDomain = process.env.ROOT_DOMAIN ?? "hubregional.com.br";
  const subdomain = explicitSubdomain || req.tenant?.subdomain;
  if (subdomain) return `https://${subdomain}.${rootDomain}/mesa/${table.number}`;
  return `https://${rootDomain}/mesa/${table.number}?subdomain=${encodeURIComponent(req.tenant?.subdomain ?? "")}`;
}

function publicTableSessionUrl(req: Request, token: string, explicitSubdomain?: string | null) {
  const rootDomain = process.env.ROOT_DOMAIN ?? "hubregional.com.br";
  const subdomain = explicitSubdomain || req.tenant?.subdomain;
  if (subdomain) return `https://${subdomain}.${rootDomain}/mesa/sessao/${token}`;
  return `https://${rootDomain}/mesa/sessao/${token}?subdomain=${encodeURIComponent(req.tenant?.subdomain ?? "")}`;
}

function money(value: unknown) {
  return `R$ ${Number(value ?? 0).toFixed(2).replace(".", ",")}`;
}

function separator(width: number) {
  return "-".repeat(width);
}

type TableReceiptOrder = {
  orderNumber: number;
  total: unknown;
  createdAt: Date;
  waiter?: { name: string } | null;
  items: Array<{
    quantity: number;
    total: unknown;
    product: { name: string };
    complements: Array<{ name: string; quantity: number; total: unknown }>;
  }>;
};

function tableReceiptText(params: {
  companyName: string;
  paperWidth: 58 | 80;
  type: "PRE_BILL" | "RECEIPT";
  tableNumber: number;
  areaName?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  orders: TableReceiptOrder[];
  subtotal: number;
  serviceFee: number;
  discount: number;
  total: number;
  payments?: Array<{ method: "CASH" | "PIX" | "DEBIT" | "CREDIT" | "CARD"; amount: number }>;
  billSplit?: Array<{ name: string; subtotal: number; serviceFee?: number; discount?: number; total: number; items?: string[] }>;
  paymentDetail?: string | null;
  notes?: string | null;
}) {
  const width = params.paperWidth === 80 ? 48 : 32;
  const title = params.type === "PRE_BILL" ? "PRE-CONTA" : "RECIBO DE PAGAMENTO";
  const lines = [
    params.companyName.toUpperCase(),
    title,
    `Mesa ${params.tableNumber}${params.areaName ? ` - ${params.areaName}` : ""}`,
    new Date().toLocaleString("pt-BR"),
    params.type === "PRE_BILL" ? "NAO E COMPROVANTE DE PAGAMENTO" : "PAGAMENTO REGISTRADO",
    ...(params.customerName ? [`Cliente: ${params.customerName}`] : []),
    ...(params.customerPhone ? [`Telefone: ${params.customerPhone}`] : []),
    separator(width),
    ...params.orders.flatMap((order) => [
      `Pedido #${String(order.orderNumber).padStart(5, "0")} ${money(order.total)}`,
      order.createdAt.toLocaleString("pt-BR"),
      ...(order.waiter?.name ? [`Garcom: ${order.waiter.name}`] : []),
      ...order.items.flatMap((item) => [
        `${item.quantity}x ${item.product.name} ${money(item.total)}`,
        ...item.complements.map((complement) =>
          `  + ${complement.quantity}x ${complement.name}${Number(complement.total) > 0 ? ` ${money(complement.total)}` : ""}`
        )
      ]),
      separator(width)
    ]),
    `Subtotal: ${money(params.subtotal)}`,
    `Taxa servico: ${money(params.serviceFee)}`,
    `Desconto: ${money(params.discount)}`,
    `TOTAL: ${money(params.total)}`,
    ...(params.payments?.length
      ? [separator(width), ...params.payments.map((payment) => `${paymentDetailFromClose(payment.method)}: ${money(payment.amount)}`)]
      : params.paymentDetail ? [separator(width), `Pagamento: ${params.paymentDetail}`] : []),
    ...(params.billSplit?.length
      ? [
          separator(width),
          "DIVISAO DA CONTA",
          ...params.billSplit.flatMap((person) => [
            `${person.name}: ${money(person.total)}`,
            ...(Number(person.serviceFee ?? 0) > 0 || Number(person.discount ?? 0) > 0
              ? [`  Subtotal ${money(person.subtotal)} | Taxa ${money(person.serviceFee ?? 0)} | Desc ${money(person.discount ?? 0)}`]
              : []),
            ...(person.items ?? []).map((item) => `  - ${item}`)
          ])
        ]
      : []),
    ...(params.notes ? [separator(width), `Obs: ${params.notes}`] : []),
    "",
    "",
    ""
  ];

  return lines.join("\r\n");
}

async function currentCompanySubdomain(req: Request) {
  const company = await prisma.company.findUnique({
    where: { id: getCompanyId(req) },
    select: { subdomain: true }
  });
  return company?.subdomain ?? req.tenant?.subdomain ?? null;
}

function newQrToken() {
  return `mesa_${crypto.randomBytes(18).toString("hex")}`;
}

function newSessionToken() {
  return `sess_${crypto.randomBytes(32).toString("hex")}`;
}

function newShortCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[crypto.randomInt(0, alphabet.length)]).join("");
}

function toDecimal(value: number) {
  return new Prisma.Decimal(value.toFixed(2));
}

function paymentMethodFromClose(value: "CASH" | "PIX" | "DEBIT" | "CREDIT" | "CARD"): PaymentMethod {
  return value === "CASH" ? "CASH" : value === "PIX" ? "PIX" : "CARD";
}

function paymentDetailFromClose(value: "CASH" | "PIX" | "DEBIT" | "CREDIT" | "CARD") {
  return value === "DEBIT"
    ? "Cartao Debito"
    : value === "CREDIT"
      ? "Cartao Credito"
      : value === "CARD"
        ? "Cartao"
        : value === "PIX"
          ? "PIX"
          : "Dinheiro";
}

function buildAccountTotals(
  subtotal: number,
  options: { serviceFeeEnabled?: boolean; serviceFeePercent?: number; discount?: number }
) {
  const serviceFee = options.serviceFeeEnabled ? subtotal * ((options.serviceFeePercent ?? 10) / 100) : 0;
  const discount = Math.min(Math.max(options.discount ?? 0, 0), subtotal + serviceFee);
  return {
    subtotal,
    serviceFee,
    discount,
    total: Math.max(0, subtotal + serviceFee - discount)
  };
}

export async function listDiningAreas(req: Request, res: Response) {
  const areas = await prisma.diningArea.findMany({
    where: companyWhere(req),
    orderBy: { name: "asc" }
  });
  return res.json(areas);
}

export async function createDiningArea(req: Request, res: Response) {
  const body = areaSchema.parse(req.body);
  const area = await prisma.diningArea.create({
    data: {
      companyId: getCompanyId(req),
      name: body.name,
      active: body.active ?? true
    }
  });
  return res.status(201).json(area);
}

export async function updateDiningArea(req: Request, res: Response) {
  const body = areaSchema.partial().parse(req.body);
  const area = await prisma.diningArea.update({
    where: { id: req.params.id, companyId: getCompanyId(req) },
    data: body
  });
  return res.json(area);
}

export async function deleteDiningArea(req: Request, res: Response) {
  await prisma.diningArea.delete({
    where: { id: req.params.id, companyId: getCompanyId(req) }
  });
  return res.status(204).send();
}

export async function listTables(req: Request, res: Response) {
  const [subdomain, tables] = await Promise.all([
    currentCompanySubdomain(req),
    prisma.restaurantTable.findMany({
    where: companyWhere(req),
    include: {
      area: true,
      sessions: {
        where: { status: { in: [TableSessionStatus.PENDING_CONFIRMATION, TableSessionStatus.OPEN, TableSessionStatus.CLOSING_REQUESTED] } },
        orderBy: { openedAt: "desc" },
        take: 1,
        include: {
          openedByUser: { select: { id: true, name: true } },
          orders: {
            where: { deletedAt: null, status: { notIn: ["CANCELED"] } },
            select: { id: true, total: true, items: { select: { quantity: true } } }
          }
        }
      },
      _count: {
        select: {
          orders: {
            where: {
              status: { notIn: ["CANCELED"] },
              deletedAt: null
            }
          }
        }
      }
    },
    orderBy: [{ number: "asc" }]
    })
  ]);
  return res.json(tables.map((table) => {
    const activeSession = table.sessions[0] ?? null;
    const activeOrders = activeSession?.orders ?? [];
    const sessionTotal = activeOrders.reduce((sum, order) => sum + Number(order.total), 0);
    const sessionItems = activeOrders.reduce((sum, order) => sum + order.items.reduce((acc, item) => acc + item.quantity, 0), 0);
    return {
      ...table,
      activeSession: activeSession ? {
        ...activeSession,
        orders: undefined,
        orderCount: activeOrders.length,
        itemCount: sessionItems,
        accountTotal: sessionTotal,
        sessionUrl: publicTableSessionUrl(req, activeSession.token, subdomain)
      } : null,
      accountTotal: sessionTotal,
      orderCount: activeSession ? activeOrders.length : 0,
      itemCount: sessionItems,
      qrCodeUrl: activeSession
        ? publicTableSessionUrl(req, activeSession.token, subdomain)
        : publicTableUrl(req, table, subdomain)
    };
  }));
}

export async function createTable(req: Request, res: Response) {
  const body = tableSchema.parse(req.body);
  if (body.areaId) {
    const area = await prisma.diningArea.findFirst({ where: { id: body.areaId, companyId: getCompanyId(req) } });
    if (!area) return res.status(400).json({ message: "Setor invalido para esta empresa" });
  }

  const table = await prisma.restaurantTable.create({
    data: {
      companyId: getCompanyId(req),
      number: body.number,
      name: body.name || null,
      areaId: body.areaId || null,
      seats: body.seats,
      status: body.status ?? "FREE",
      active: body.active ?? true,
      qrCodeToken: newQrToken()
    },
    include: { area: true }
  });
  const subdomain = await currentCompanySubdomain(req);
  return res.status(201).json({ ...table, qrCodeUrl: publicTableUrl(req, table, subdomain) });
}

export async function updateTable(req: Request, res: Response) {
  const body = tableSchema.partial().parse(req.body);
  if (body.areaId) {
    const area = await prisma.diningArea.findFirst({ where: { id: body.areaId, companyId: getCompanyId(req) } });
    if (!area) return res.status(400).json({ message: "Setor invalido para esta empresa" });
  }

  const table = await prisma.restaurantTable.update({
    where: { id: req.params.id, companyId: getCompanyId(req) },
    data: {
      ...(body.number !== undefined ? { number: body.number } : {}),
      ...(body.name !== undefined ? { name: body.name || null } : {}),
      ...(body.areaId !== undefined ? { areaId: body.areaId || null } : {}),
      ...(body.seats !== undefined ? { seats: body.seats } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.active !== undefined ? { active: body.active } : {})
    },
    include: { area: true }
  });
  const subdomain = await currentCompanySubdomain(req);
  return res.json({ ...table, qrCodeUrl: publicTableUrl(req, table, subdomain) });
}

export async function updateTableStatus(req: Request, res: Response) {
  const body = statusSchema.parse(req.body);
  const companyId = getCompanyId(req);
  const activeSessionForFree = body.status === "FREE"
    ? await prisma.tableSession.findFirst({
        where: {
          companyId,
          tableId: req.params.id,
          status: { in: [TableSessionStatus.PENDING_CONFIRMATION, TableSessionStatus.OPEN, TableSessionStatus.CLOSING_REQUESTED] }
        },
        include: {
          orders: {
            where: { deletedAt: null, status: { notIn: ["CANCELED"] } },
            select: { id: true }
          }
        }
      })
    : null;

  if (activeSessionForFree?.orders.length) {
    return res.status(409).json({ message: "Esta mesa possui comanda aberta. Use Receber e liberar para fechar a conta." });
  }

  const table = await prisma.$transaction(async (tx) => {
    if (body.status === "FREE" && activeSessionForFree) {
      await tx.tableSession.update({
        where: { id: activeSessionForFree.id },
        data: {
          status: TableSessionStatus.CANCELLED,
          closedAt: new Date(),
          closedByUserId: req.user?.sub ?? null,
          lastActivityAt: new Date()
        }
      });
    }

    const updated = await tx.restaurantTable.update({
      where: { id: req.params.id, companyId },
      data: {
        status: body.status,
        openedAt: body.status === "OCCUPIED" ? new Date() : undefined,
        closedAt: body.status === "FREE" ? new Date() : undefined
      }
    });

    if (body.status === "WAITING_PAYMENT") {
      await tx.tableSession.updateMany({
        where: {
          companyId,
          tableId: req.params.id,
          status: TableSessionStatus.OPEN
        },
        data: {
          status: TableSessionStatus.CLOSING_REQUESTED,
          billRequestedAt: new Date(),
          lastActivityAt: new Date()
        }
      });
    }

    return updated;
  });
  const subdomain = await currentCompanySubdomain(req);
  return res.json({ ...table, qrCodeUrl: publicTableUrl(req, table, subdomain) });
}

export async function listTableOrders(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const table = await prisma.restaurantTable.findFirst({
    where: { id: req.params.id, companyId, active: true },
    select: { id: true }
  });
  if (!table) return res.status(404).json({ message: "Mesa nao encontrada" });

  const activeSession = await prisma.tableSession.findFirst({
    where: {
      companyId,
      tableId: table.id,
      status: { in: [TableSessionStatus.OPEN, TableSessionStatus.CLOSING_REQUESTED] }
    },
    orderBy: { openedAt: "desc" }
  });
  if (!activeSession) return res.json([]);

  const orders = await prisma.order.findMany({
    where: {
      companyId,
      tableId: table.id,
      tableSessionId: activeSession.id,
      deletedAt: null,
      status: { notIn: ["CANCELED"] }
    },
    include: {
      customer: true,
      waiter: { select: { id: true, name: true } },
      items: {
        include: {
          product: { select: { id: true, name: true } },
          complements: true
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });

  return res.json(orders);
}

export async function listClosedTableSessions(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const table = await prisma.restaurantTable.findFirst({
    where: { id: req.params.id, companyId, active: true },
    select: { id: true }
  });
  if (!table) return res.status(404).json({ message: "Mesa nao encontrada" });

  const sessions = await prisma.tableSession.findMany({
    where: {
      companyId,
      tableId: table.id,
      status: TableSessionStatus.CLOSED
    },
    select: {
      id: true,
      shortCode: true,
      customerName: true,
      customerPhone: true,
      openedAt: true,
      closedAt: true,
      total: true,
      openedByUser: { select: { name: true } },
      closedByUser: { select: { name: true } },
      orders: {
        where: { deletedAt: null, status: { notIn: ["CANCELED"] } },
        select: {
          id: true,
          orderNumber: true,
          total: true,
          items: { select: { quantity: true } }
        },
        orderBy: { createdAt: "asc" }
      }
    },
    orderBy: { closedAt: "desc" },
    take: 15
  });

  return res.json(sessions.map((session) => ({
    ...session,
    orderCount: session.orders.length,
    itemCount: session.orders.reduce((sum, order) => sum + order.items.reduce((acc, item) => acc + item.quantity, 0), 0)
  })));
}

export async function listAllClosedTableSessions(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const dateFrom = req.query.dateFrom ? new Date(`${req.query.dateFrom}T00:00:00`) : undefined;
  const dateTo = req.query.dateTo ? new Date(`${req.query.dateTo}T23:59:59`) : undefined;
  const tableId = typeof req.query.tableId === "string" && req.query.tableId ? req.query.tableId : undefined;
  const sessions = await prisma.tableSession.findMany({
    where: {
      companyId,
      ...(tableId ? { tableId } : {}),
      status: TableSessionStatus.CLOSED,
      ...(dateFrom || dateTo ? { closedAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {})
    },
    select: {
      id: true,
      shortCode: true,
      customerName: true,
      customerPhone: true,
      openedAt: true,
      closedAt: true,
      total: true,
      table: { select: { id: true, number: true, name: true, area: { select: { name: true } } } },
      openedByUser: { select: { name: true } },
      closedByUser: { select: { name: true } },
      orders: {
        where: { deletedAt: null, status: { notIn: ["CANCELED"] } },
        select: {
          id: true,
          orderNumber: true,
          total: true,
          items: { select: { quantity: true } }
        },
        orderBy: { createdAt: "asc" }
      }
    },
    orderBy: { closedAt: "desc" },
    take: 200
  });

  return res.json(sessions.map((session) => ({
    ...session,
    orderCount: session.orders.length,
    itemCount: session.orders.reduce((sum, order) => sum + order.items.reduce((acc, item) => acc + item.quantity, 0), 0)
  })));
}

export async function openTableSession(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const table = await prisma.restaurantTable.findFirst({
    where: { id: req.params.id, companyId, active: true },
    include: { area: true }
  });
  if (!table) return res.status(404).json({ message: "Mesa nao encontrada" });

  const existing = await prisma.tableSession.findFirst({
    where: {
      companyId,
      tableId: table.id,
      status: { in: [TableSessionStatus.OPEN, TableSessionStatus.CLOSING_REQUESTED] }
    },
    include: { openedByUser: { select: { id: true, name: true } } }
  });
  const subdomain = await currentCompanySubdomain(req);
  if (existing) {
    return res.json({
      ...existing,
      table,
      sessionUrl: publicTableSessionUrl(req, existing.token, subdomain)
    });
  }

  const expiresHours = Number(process.env.TABLE_SESSION_EXPIRES_HOURS ?? 12);
  const expiresAt = Number.isFinite(expiresHours) && expiresHours > 0
    ? new Date(Date.now() + expiresHours * 60 * 60 * 1000)
    : null;

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.tableSession.create({
      data: {
        companyId,
        tableId: table.id,
        token: newSessionToken(),
        shortCode: newShortCode(),
        openedByUserId: req.user?.sub ?? null,
        expiresAt
      },
      include: { openedByUser: { select: { id: true, name: true } } }
    });
    await tx.restaurantTable.update({
      where: { id: table.id },
      data: { status: "OCCUPIED", openedAt: created.openedAt, closedAt: null }
    });
    return created;
  });

  await audit(req, {
    action: "TABLE_SESSION_OPENED",
    entity: "TableSession",
    entityId: session.id,
    newValue: { tableId: table.id, tableNumber: table.number, shortCode: session.shortCode }
  });

  return res.status(201).json({
    ...session,
    table,
    sessionUrl: publicTableSessionUrl(req, session.token, subdomain)
  });
}

export async function approveTableSession(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const session = await prisma.tableSession.findFirst({
    where: {
      id: req.params.sessionId,
      tableId: req.params.id,
      companyId,
      status: TableSessionStatus.PENDING_CONFIRMATION
    },
    include: { table: { include: { area: true } } }
  });
  if (!session) return res.status(404).json({ message: "Solicitacao de mesa nao encontrada" });

  const updated = await prisma.$transaction(async (tx) => {
    const approved = await tx.tableSession.update({
      where: { id: session.id },
      data: {
        status: TableSessionStatus.OPEN,
        openedByUserId: req.user?.sub ?? null,
        openedAt: new Date(),
        lastActivityAt: new Date()
      },
      include: { openedByUser: { select: { id: true, name: true } } }
    });
    await tx.restaurantTable.update({
      where: { id: session.tableId },
      data: { status: "OCCUPIED", openedAt: approved.openedAt, closedAt: null }
    });
    return approved;
  });

  await audit(req, {
    action: "TABLE_SESSION_APPROVED",
    entity: "TableSession",
    entityId: updated.id,
    newValue: {
      tableId: session.tableId,
      tableNumber: session.table.number,
      customerName: session.customerName,
      customerPhone: session.customerPhone
    }
  });

  const subdomain = await currentCompanySubdomain(req);
  return res.json({
    ...updated,
    table: session.table,
    sessionUrl: publicTableSessionUrl(req, updated.token, subdomain)
  });
}

export async function getTableSessionAccount(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const session = await prisma.tableSession.findFirst({
    where: {
      id: req.params.sessionId,
      companyId,
      tableId: req.params.id
    },
    include: {
      table: { include: { area: true } },
      openedByUser: { select: { id: true, name: true } },
      orders: {
        where: { deletedAt: null, status: { notIn: ["CANCELED"] } },
        include: {
          customer: true,
          items: { include: { product: { select: { id: true, name: true } }, complements: true } }
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });
  if (!session) return res.status(404).json({ message: "Atendimento nao encontrado" });
  const settings = await prisma.setting.findFirst({ where: { companyId } });
  const subtotal = session.orders.reduce((sum, order) => sum + Number(order.total), 0);
  const account = buildAccountTotals(subtotal, {
    serviceFeeEnabled: settings?.tableServiceFeeEnabled ?? false,
    serviceFeePercent: Number(settings?.tableServiceFeePercent ?? 10),
    discount: 0
  });
  return res.json({ ...session, total: account.total, account });
}

export async function createTableOrder(req: Request, res: Response) {
  const body = tableOrderSchema.parse(req.body);
  const companyId = getCompanyId(req);
  const table = await prisma.restaurantTable.findFirst({
    where: { id: req.params.id, companyId, active: true },
    select: { id: true, number: true, area: { select: { name: true } } }
  });
  if (!table) return res.status(404).json({ message: "Mesa nao encontrada" });

  const activeSession = await prisma.tableSession.findFirst({
    where: {
      companyId,
      tableId: table.id,
      status: { in: [TableSessionStatus.OPEN, TableSessionStatus.CLOSING_REQUESTED] }
    }
  });
  if (activeSession?.status === TableSessionStatus.CLOSING_REQUESTED) {
    return res.status(409).json({ message: "Conta solicitada. Reabra a conta para fazer novos pedidos." });
  }
  if (!activeSession || activeSession.status !== TableSessionStatus.OPEN) {
    return res.status(409).json({ message: "Abra o atendimento da mesa antes de adicionar produtos." });
  }

  const productIds = [...new Set(body.items.map((item) => item.productId))];
  const products = await prisma.product.findMany({
    where: { companyId, id: { in: productIds }, active: true, available: true },
    include: { complements: { include: { complement: true }, orderBy: { sortOrder: "asc" } } }
  });
  if (products.length !== productIds.length) {
    return res.status(400).json({ message: "Um ou mais produtos estao indisponiveis" });
  }

  const preparedItems = body.items.map((item) => {
    const product = products.find((candidate) => candidate.id === item.productId)!;
    const activeLinks = product.complements.filter((link) => link.complement.active);
    const selectedById = new Map(item.complements.map((selected) => [selected.complementId, selected.quantity]));
    const missingRequired = activeLinks.find((link) => link.required && !selectedById.has(link.complementId));
    if (missingRequired) {
      throw new z.ZodError([{
        code: z.ZodIssueCode.custom,
        path: ["items", item.productId, "complements"],
        message: `O complemento ${missingRequired.complement.name} e obrigatorio para ${product.name}`
      }]);
    }
    const selectedComplements = item.complements.map((selected) => {
      const link = activeLinks.find((candidate) => candidate.complementId === selected.complementId);
      if (!link) {
        throw new z.ZodError([{
          code: z.ZodIssueCode.custom,
          path: ["items", item.productId, "complements"],
          message: "Complemento indisponivel para este produto"
        }]);
      }
      const price = Number(link.complement.price);
      return {
        id: link.complement.id,
        name: link.complement.name,
        quantity: selected.quantity,
        price,
        total: price * selected.quantity * item.quantity
      };
    });
    const basePrice = Number(product.promoPrice ?? product.price);
    const complementsPerUnit = selectedComplements.reduce((sum, complement) => sum + complement.price * complement.quantity, 0);
    return {
      ...item,
      product,
      basePrice,
      selectedComplements,
      total: (basePrice + complementsPerUnit) * item.quantity
    };
  });

  const subtotalNumber = preparedItems.reduce((sum, item) => sum + item.total, 0);
  const customerPhone = `mesa-${table.number}`;
  const customer = await prisma.customer.upsert({
    where: { companyId_phone: { companyId, phone: customerPhone } },
    create: {
      companyId,
      name: body.customerName,
      phone: customerPhone,
      address: `Mesa ${table.number}`,
      number: "S/N",
      district: "Atendimento presencial"
    },
    update: {
      name: body.customerName,
      address: `Mesa ${table.number}`,
      number: "S/N",
      district: "Atendimento presencial",
      deletedAt: null,
      deletedBy: null,
      deletionReason: null
    }
  });

  const order = await prisma.$transaction(async (tx) => {
    await validateAndDecrementStock(tx, companyId, preparedItems.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      complements: item.selectedComplements.map((complement) => ({ complementId: complement.id, quantity: complement.quantity }))
    })));

    return tx.order.create({
      data: {
        companyId,
        customerId: customer.id,
        source: OrderSource.WAITER,
        tableId: table.id,
        tableSessionId: activeSession?.id ?? null,
        waiterId: req.user?.sub ?? null,
        paymentMethod: body.paymentMethod,
        fulfillmentType: FulfillmentType.PICKUP,
        subtotal: toDecimal(subtotalNumber),
        deliveryFee: toDecimal(0),
        discount: toDecimal(0),
        total: toDecimal(subtotalNumber),
        customerNotes: body.notes,
        items: {
          create: preparedItems.map((item) => ({
            companyId,
            productId: item.productId,
            quantity: item.quantity,
            price: toDecimal(item.basePrice),
            total: toDecimal(item.total),
            complements: {
              create: item.selectedComplements.map((complement) => ({
                companyId,
                complementId: complement.id,
                name: complement.name,
                quantity: complement.quantity,
                price: toDecimal(complement.price),
                total: toDecimal(complement.total)
              }))
            }
          }))
        }
      },
      include: {
        customer: true,
        waiter: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true } }, complements: true } }
      }
    });
  });

  await prisma.restaurantTable.update({
    where: { id: table.id },
    data: { status: "OCCUPIED", openedAt: new Date(), closedAt: null }
  });
  if (activeSession) {
    await prisma.tableSession.update({
      where: { id: activeSession.id },
      data: {
        total: { increment: toDecimal(subtotalNumber) },
        lastActivityAt: new Date()
      }
    });
  }

  return res.status(201).json(order);
}

export async function createTablePrintJob(req: Request, res: Response) {
  const body = tablePrintJobSchema.parse(req.body ?? {});
  const companyId = getCompanyId(req);
  const table = await prisma.restaurantTable.findFirst({
    where: { id: req.params.id, companyId, active: true },
    include: { area: true }
  });
  if (!table) return res.status(404).json({ message: "Mesa nao encontrada" });

  const activeSession = await prisma.tableSession.findFirst({
    where: {
      companyId,
      tableId: table.id,
      status: { in: [TableSessionStatus.OPEN, TableSessionStatus.CLOSING_REQUESTED] }
    },
    orderBy: { openedAt: "desc" }
  });
  if (!activeSession) return res.status(400).json({ message: "Nao ha atendimento aberto nesta mesa" });

  const [settings, company, orders] = await Promise.all([
    prisma.setting.findUnique({ where: { companyId } }),
    prisma.company.findUnique({ where: { id: companyId }, select: { tradeName: true, companyName: true } }),
    prisma.order.findMany({
      where: {
        companyId,
        tableId: table.id,
        tableSessionId: activeSession.id,
        deletedAt: null,
        status: { notIn: ["CANCELED"] }
      },
      include: {
        waiter: { select: { name: true } },
        items: { include: { product: { select: { name: true } }, complements: true } }
      },
      orderBy: { createdAt: "asc" }
    })
  ]);
  if (!orders.length) return res.status(400).json({ message: "Nao ha pedidos para imprimir nesta mesa" });

  const subtotal = orders.reduce((sum, order) => sum + Number(order.total), 0);
  const serviceFeeEnabled = body.serviceFeeEnabled ?? settings?.tableServiceFeeEnabled ?? false;
  const serviceFeePercent = body.serviceFeePercent ?? Number(settings?.tableServiceFeePercent ?? 10);
  const account = buildAccountTotals(subtotal, {
    serviceFeeEnabled,
    serviceFeePercent,
    discount: body.discount
  });
  const paperWidth = settings?.printerPaperWidth === 80 ? 80 : 58;
  const companyName = settings?.companyName || company?.tradeName || company?.companyName || "HubRegional";
  const receipt = tableReceiptText({
    companyName,
    paperWidth,
    type: body.type,
    tableNumber: table.number,
    areaName: table.area?.name,
    customerName: activeSession.customerName,
    customerPhone: activeSession.customerPhone,
    orders,
    subtotal: account.subtotal,
    serviceFee: account.serviceFee,
    discount: account.discount,
    total: account.total,
    payments: body.payments,
    billSplit: body.billSplit,
    paymentDetail: body.paymentDetail,
    notes: body.notes
  });

  const job = await prisma.printerJob.create({
    data: {
      companyId,
      type: body.type === "PRE_BILL" ? "TABLE_PRE_BILL" : "TABLE_RECEIPT",
      title: `${body.type === "PRE_BILL" ? "Pre-conta" : "Recibo"} Mesa ${table.number}`,
      referenceId: activeSession.id,
      referenceLabel: `Mesa ${table.number}`,
      receipt,
      createdBy: req.user?.sub ?? null
    },
    select: { id: true, type: true, title: true, createdAt: true }
  });

  return res.status(201).json({
    ...job,
    message: `${body.type === "PRE_BILL" ? "Pre-conta" : "Recibo"} enviada para a fila do Printer Agent`
  });
}

export async function reprintClosedTableSession(req: Request, res: Response) {
  const body = tablePrintJobSchema.parse(req.body ?? {});
  const companyId = getCompanyId(req);
  const table = await prisma.restaurantTable.findFirst({
    where: { id: req.params.id, companyId, active: true },
    include: { area: true }
  });
  if (!table) return res.status(404).json({ message: "Mesa nao encontrada" });

  const session = await prisma.tableSession.findFirst({
    where: {
      id: req.params.sessionId,
      companyId,
      tableId: table.id,
      status: TableSessionStatus.CLOSED
    }
  });
  if (!session) return res.status(404).json({ message: "Atendimento fechado nao encontrado" });

  const [settings, company, orders] = await Promise.all([
    prisma.setting.findUnique({ where: { companyId } }),
    prisma.company.findUnique({ where: { id: companyId }, select: { tradeName: true, companyName: true, printerAgentEnabled: true } }),
    prisma.order.findMany({
      where: {
        companyId,
        tableId: table.id,
        tableSessionId: session.id,
        deletedAt: null,
        status: { notIn: ["CANCELED"] }
      },
      include: {
        waiter: { select: { name: true } },
        items: { include: { product: { select: { name: true } }, complements: true } }
      },
      orderBy: { createdAt: "asc" }
    })
  ]);
  if (!orders.length) return res.status(400).json({ message: "Nao ha pedidos neste atendimento" });

  const subtotal = orders.reduce((sum, order) => sum + Number(order.total), 0);
  const serviceFeeEnabled = body.serviceFeeEnabled ?? settings?.tableServiceFeeEnabled ?? false;
  const serviceFeePercent = body.serviceFeePercent ?? Number(settings?.tableServiceFeePercent ?? 10);
  const account = buildAccountTotals(subtotal, {
    serviceFeeEnabled,
    serviceFeePercent,
    discount: body.discount
  });
  const paperWidth = settings?.printerPaperWidth === 80 ? 80 : 58;
  const companyName = settings?.companyName || company?.tradeName || company?.companyName || "HubRegional";
  const receipt = tableReceiptText({
    companyName,
    paperWidth,
    type: body.type === "PRE_BILL" ? "PRE_BILL" : "RECEIPT",
    tableNumber: table.number,
    areaName: table.area?.name,
    customerName: session.customerName,
    customerPhone: session.customerPhone,
    orders,
    subtotal: account.subtotal,
    serviceFee: account.serviceFee,
    discount: account.discount,
    total: account.total,
    payments: body.payments,
    billSplit: body.billSplit,
    paymentDetail: body.paymentDetail,
    notes: body.notes || `Reimpressao do atendimento fechado em ${session.closedAt?.toLocaleString("pt-BR") ?? "-"}`
  });

  if (!company?.printerAgentEnabled) {
    return res.status(201).json({
      type: body.type,
      title: `${body.type === "PRE_BILL" ? "Pre-conta" : "Recibo"} Mesa ${table.number}`,
      receipt,
      message: "Printer Agent nao esta ativo. Use impressao manual."
    });
  }

  const job = await prisma.printerJob.create({
    data: {
      companyId,
      type: body.type === "PRE_BILL" ? "TABLE_PRE_BILL" : "TABLE_RECEIPT",
      title: `${body.type === "PRE_BILL" ? "Reimpressao pre-conta" : "Reimpressao recibo"} Mesa ${table.number}`,
      referenceId: session.id,
      referenceLabel: `Mesa ${table.number}`,
      receipt,
      createdBy: req.user?.sub ?? null
    },
    select: { id: true, type: true, title: true, createdAt: true }
  });

  return res.status(201).json({
    ...job,
    message: `${job.title} enviada para a fila do Printer Agent`
  });
}

export async function reprintClosedTableSessionFromFinance(req: Request, res: Response) {
  const session = await prisma.tableSession.findFirst({
    where: {
      id: req.params.sessionId,
      companyId: getCompanyId(req),
      status: TableSessionStatus.CLOSED
    },
    select: { tableId: true }
  });
  if (!session) return res.status(404).json({ message: "Atendimento fechado nao encontrado" });
  req.params.id = session.tableId;
  return reprintClosedTableSession(req, res);
}

export async function moveTableAccount(req: Request, res: Response) {
  const body = tableMoveSchema.parse(req.body);
  const companyId = getCompanyId(req);
  if (req.params.id === body.targetTableId) {
    return res.status(400).json({ message: "Escolha uma mesa diferente" });
  }

  const [sourceTable, targetTable] = await Promise.all([
    prisma.restaurantTable.findFirst({ where: { id: req.params.id, companyId, active: true } }),
    prisma.restaurantTable.findFirst({ where: { id: body.targetTableId, companyId, active: true } })
  ]);
  if (!sourceTable) return res.status(404).json({ message: "Mesa de origem nao encontrada" });
  if (!targetTable) return res.status(404).json({ message: "Mesa de destino nao encontrada" });

  const sourceSession = await prisma.tableSession.findFirst({
    where: {
      companyId,
      tableId: sourceTable.id,
      status: { in: [TableSessionStatus.OPEN, TableSessionStatus.CLOSING_REQUESTED] }
    },
    orderBy: { openedAt: "desc" }
  });
  if (!sourceSession) return res.status(400).json({ message: "Mesa de origem nao possui atendimento aberto" });

  const targetSession = await prisma.tableSession.findFirst({
    where: {
      companyId,
      tableId: targetTable.id,
      status: { in: [TableSessionStatus.OPEN, TableSessionStatus.CLOSING_REQUESTED] }
    },
    orderBy: { openedAt: "desc" }
  });

  if (body.mode === "TRANSFER" && targetSession) {
    return res.status(400).json({ message: "Para transferir, escolha uma mesa livre. Para somar comandas, use Juntar mesas." });
  }
  if (body.mode === "MERGE" && !targetSession) {
    return res.status(400).json({ message: "Para juntar mesas, a mesa de destino precisa ter atendimento aberto" });
  }

  const activeSourceOrders = await prisma.order.findMany({
    where: {
      companyId,
      tableId: sourceTable.id,
      tableSessionId: sourceSession.id,
      deletedAt: null,
      status: { notIn: ["CANCELED", "FINISHED"] }
    },
    select: { id: true, total: true, orderNumber: true }
  });
  if (!activeSourceOrders.length) return res.status(400).json({ message: "Nao ha pedidos abertos para mover" });
  const movedTotal = activeSourceOrders.reduce((sum, order) => sum + Number(order.total), 0);
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    if (body.mode === "TRANSFER") {
      await tx.order.updateMany({
        where: { id: { in: activeSourceOrders.map((order) => order.id) }, companyId },
        data: { tableId: targetTable.id }
      });
      const movedSession = await tx.tableSession.update({
        where: { id: sourceSession.id },
        data: { tableId: targetTable.id, lastActivityAt: now }
      });
      await tx.restaurantTable.update({
        where: { id: sourceTable.id },
        data: { status: TableStatus.FREE, openedAt: null, closedAt: now }
      });
      await tx.restaurantTable.update({
        where: { id: targetTable.id },
        data: { status: TableStatus.OCCUPIED, openedAt: targetTable.openedAt ?? sourceTable.openedAt ?? now, closedAt: null }
      });
      return { sessionId: movedSession.id, mode: "TRANSFER" as const };
    }

    await tx.order.updateMany({
      where: { id: { in: activeSourceOrders.map((order) => order.id) }, companyId },
      data: { tableId: targetTable.id, tableSessionId: targetSession!.id }
    });
    await tx.tableSession.update({
      where: { id: targetSession!.id },
      data: { total: { increment: toDecimal(movedTotal) }, lastActivityAt: now }
    });
    await tx.tableSession.update({
      where: { id: sourceSession.id },
      data: {
        status: TableSessionStatus.CANCELLED,
        closedAt: now,
        closedByUserId: req.user?.sub ?? null,
        lastActivityAt: now
      }
    });
    await tx.restaurantTable.update({
      where: { id: sourceTable.id },
      data: { status: TableStatus.FREE, openedAt: null, closedAt: now }
    });
    await tx.restaurantTable.update({
      where: { id: targetTable.id },
      data: { status: TableStatus.OCCUPIED, closedAt: null }
    });
    return { sessionId: targetSession!.id, mode: "MERGE" as const };
  });

  await audit(req, {
    action: result.mode === "TRANSFER" ? "TABLE_TRANSFERRED" : "TABLES_MERGED",
    entity: "RestaurantTable",
    entityId: sourceTable.id,
    oldValue: { sourceTableId: sourceTable.id, sourceTableNumber: sourceTable.number, sourceSessionId: sourceSession.id },
    newValue: {
      targetTableId: targetTable.id,
      targetTableNumber: targetTable.number,
      targetSessionId: result.sessionId,
      orders: activeSourceOrders.map((order) => order.orderNumber),
      total: movedTotal
    }
  });

  return res.json({
    ok: true,
    mode: result.mode,
    sourceTableId: sourceTable.id,
    sourceTableNumber: sourceTable.number,
    targetTableId: targetTable.id,
    targetTableNumber: targetTable.number,
    movedOrders: activeSourceOrders.length,
    movedTotal
  });
}

export async function closeTableAccount(req: Request, res: Response) {
  const body = closeTableSchema.parse(req.body);
  const companyId = getCompanyId(req);
  const table = await prisma.restaurantTable.findFirst({
    where: { id: req.params.id, companyId, active: true },
    select: { id: true, number: true, area: { select: { name: true } } }
  });
  if (!table) return res.status(404).json({ message: "Mesa nao encontrada" });

  const activeSession = await prisma.tableSession.findFirst({
    where: {
      companyId,
      tableId: table.id,
      status: { in: [TableSessionStatus.OPEN, TableSessionStatus.CLOSING_REQUESTED] }
    }
  });
  if (!activeSession) {
    return res.status(400).json({ message: "Nao ha atendimento aberto nesta mesa" });
  }

  const orders = await prisma.order.findMany({
    where: {
      companyId,
      tableId: table.id,
      tableSessionId: activeSession.id,
      deletedAt: null,
      status: { notIn: ["CANCELED"] }
    },
    select: {
      id: true,
      orderNumber: true,
      total: true,
      paidAt: true,
      notes: true,
      createdAt: true,
      waiter: { select: { name: true } },
      items: { include: { product: { select: { name: true } }, complements: true } }
    },
    orderBy: { createdAt: "asc" }
  });
  if (!orders.length) {
    return res.status(400).json({ message: "Nao ha pedidos abertos nesta mesa" });
  }

  const session = await prisma.cashSession.findFirst({
    where: {
      companyId,
      openedBy: req.user!.sub,
      closedAt: null,
      deletedAt: null,
      locked: false
    }
  });
  if (!session) {
    return res.status(400).json({ message: "Abra seu caixa antes de fechar a mesa" });
  }

  const [settings, company] = await Promise.all([
    prisma.setting.findFirst({ where: { companyId } }),
    prisma.company.findUnique({
      where: { id: companyId },
      select: { companyName: true, tradeName: true, printerAgentEnabled: true }
    })
  ]);
  const subtotal = orders.reduce((sum, order) => sum + Number(order.total), 0);
  const serviceFeeEnabled = body.serviceFeeEnabled ?? settings?.tableServiceFeeEnabled ?? false;
  const serviceFeePercent = body.serviceFeePercent ?? Number(settings?.tableServiceFeePercent ?? 10);
  const account = buildAccountTotals(subtotal, {
    serviceFeeEnabled,
    serviceFeePercent,
    discount: body.discount
  });
  const splitPayments = body.payments?.length
    ? body.payments
    : [{ method: body.paymentMethod, amount: account.total }];
  const paidTotal = splitPayments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  if (Math.abs(paidTotal - account.total) > 0.02) {
    return res.status(400).json({ message: `Pagamentos (${paidTotal.toFixed(2)}) nao batem com total (${account.total.toFixed(2)})` });
  }
  const paymentMethod = paymentMethodFromClose(splitPayments[0].method);
  const paymentDetail = splitPayments.length > 1
    ? `Pagamento dividido (${splitPayments.map((payment) => `${paymentDetailFromClose(payment.method)} ${Number(payment.amount).toFixed(2)}`).join(" + ")})`
    : paymentDetailFromClose(splitPayments[0].method);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await Promise.all(orders.map((order) => tx.order.update({
      where: { id: order.id },
      data: {
        paymentMethod,
        paidAt: now,
        paidMethodDetail: paymentDetail,
        status: "FINISHED",
        discount: toDecimal(order.id === orders[0].id ? account.discount : 0),
        notes: [
          order.notes,
          `[FECHAMENTO MESA ${table.number}: ${paymentDetail} em ${now.toLocaleString("pt-BR")} | Subtotal ${subtotal.toFixed(2)} | Servico ${account.serviceFee.toFixed(2)} | Desconto ${account.discount.toFixed(2)} | Total ${account.total.toFixed(2)}${body.discountReason ? ` | Motivo desconto: ${body.discountReason}` : ""}${body.notes ? ` - ${body.notes}` : ""}]`
        ].filter(Boolean).join(" ")
      }
    })));
    if (account.serviceFee > 0) {
      await tx.cashEntry.create({
        data: {
          companyId,
          sessionId: session.id,
          type: "MANUAL_INCOME",
          category: "OTHER_INCOME",
          direction: "IN",
          amount: toDecimal(account.serviceFee),
          operatorId: req.user!.sub,
          description: `Taxa de servico mesa ${table.number}`
        }
      });
    }
    await tx.restaurantTable.update({
      where: { id: table.id },
      data: { status: "FREE", closedAt: now, openedAt: null }
    });
    if (activeSession) {
      await tx.tableSession.update({
        where: { id: activeSession.id },
        data: {
          status: TableSessionStatus.CLOSED,
          closedAt: now,
          closedByUserId: req.user?.sub ?? null,
          total: toDecimal(account.total),
          lastActivityAt: now
        }
      });
    }
  });

  if (splitPayments.length > 1) {
    await prisma.cashEntry.createMany({
      data: splitPayments.map((payment) => ({
        companyId,
        sessionId: session.id,
        type: "MANUAL_INCOME",
        category:
          payment.method === "CASH" ? "SALE_CASH" :
          payment.method === "PIX" ? "SALE_PIX" :
          payment.method === "DEBIT" ? "SALE_DEBIT" : "SALE_CREDIT",
        direction: "IN",
        amount: toDecimal(Number(payment.amount)),
        paymentMethod: paymentMethodFromClose(payment.method),
        paymentDetail: paymentDetailFromClose(payment.method),
        orderId: orders[0].id,
        operatorId: req.user!.sub,
        description: `Fechamento dividido mesa ${table.number} - ${paymentDetailFromClose(payment.method)}`
      }))
    });
  } else {
    await recordCashPayments(session.id, companyId, orders.map((order, index) => ({
      amount: index === 0 ? toDecimal(account.total) : toDecimal(0),
      paymentMethod,
      paymentDetail,
      orderId: order.id,
      description: `Fechamento mesa ${table.number} - pedido #${String(order.orderNumber).padStart(5, "0")} via ${paymentDetail}`
    })).filter((payment) => Number(payment.amount) > 0));
  }

  let printerJob: { id: string; title: string } | null = null;
  if (company?.printerAgentEnabled) {
    const paperWidth = settings?.printerPaperWidth === 80 ? 80 : 58;
    const companyName = settings?.companyName || company.tradeName || company.companyName || "HubRegional";
    const receipt = tableReceiptText({
      companyName,
      paperWidth,
      type: "RECEIPT",
      tableNumber: table.number,
      areaName: table.area?.name,
      customerName: activeSession.customerName,
      customerPhone: activeSession.customerPhone,
      orders,
      subtotal: account.subtotal,
      serviceFee: account.serviceFee,
      discount: account.discount,
      total: account.total,
      payments: splitPayments,
      billSplit: body.billSplit,
      paymentDetail,
      notes: body.notes
    });
    printerJob = await prisma.printerJob.create({
      data: {
        companyId,
        type: "TABLE_RECEIPT",
        title: `Recibo Mesa ${table.number}`,
        referenceId: activeSession.id,
        referenceLabel: `Mesa ${table.number}`,
        receipt,
        createdBy: req.user?.sub ?? null
      },
      select: { id: true, title: true }
    });
  }

  return res.json({
    ok: true,
    tableId: table.id,
    tableNumber: table.number,
    paymentDetail,
    ordersClosed: orders.length,
    subtotal,
    serviceFee: account.serviceFee,
    discount: account.discount,
    total: account.total,
    payments: splitPayments,
    printerJob
  });
}

export async function deleteTable(req: Request, res: Response) {
  await prisma.restaurantTable.update({
    where: { id: req.params.id, companyId: getCompanyId(req) },
    data: { active: false, status: "FREE" }
  });
  return res.status(204).send();
}

export async function getPublicTable(req: Request, res: Response) {
  const number = z.coerce.number().int().positive().parse(req.params.number);
  const table = await prisma.restaurantTable.findFirst({
    where: {
      ...companyWhere(req),
      number,
      active: true
    },
    include: {
      area: true,
      company: {
        select: {
          id: true,
          tradeName: true,
          logoUrl: true,
          subdomain: true,
          active: true
        }
      }
    }
  });
  if (!table) return res.status(404).json({ message: "Mesa nao encontrada para esta loja" });
  return res.json({
    id: table.id,
    number: table.number,
    name: table.name,
    seats: table.seats,
    status: table.status,
    area: table.area,
    company: table.company,
    qrCodeUrl: publicTableUrl(req, table)
  });
}

export async function requestTableSession(req: Request, res: Response) {
  const number = z.coerce.number().int().positive().parse(req.params.number);
  const body = tableSessionRequestSchema.parse(req.body);
  const table = await prisma.restaurantTable.findFirst({
    where: { ...companyWhere(req), number, active: true },
    include: { company: { select: { subdomain: true } } }
  });
  if (!table) return res.status(404).json({ message: "Mesa nao encontrada para esta loja" });

  const existing = await prisma.tableSession.findFirst({
    where: {
      companyId: table.companyId,
      tableId: table.id,
      status: { in: [TableSessionStatus.PENDING_CONFIRMATION, TableSessionStatus.OPEN, TableSessionStatus.CLOSING_REQUESTED] }
    },
    orderBy: { openedAt: "desc" }
  });

  if (existing) {
    return res.json({
      id: existing.id,
      status: existing.status,
      table: { id: table.id, number: table.number, name: table.name },
      sessionUrl: publicTableSessionUrl(req, existing.token, table.company.subdomain),
      message: existing.status === TableSessionStatus.PENDING_CONFIRMATION
        ? "Solicitacao ja enviada. Aguarde o garcom confirmar a abertura da mesa."
        : "Mesa ja possui atendimento aberto."
    });
  }

  const expiresHours = Number(process.env.TABLE_SESSION_EXPIRES_HOURS ?? 12);
  const expiresAt = Number.isFinite(expiresHours) && expiresHours > 0
    ? new Date(Date.now() + expiresHours * 60 * 60 * 1000)
    : null;

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.tableSession.create({
      data: {
        companyId: table.companyId,
        tableId: table.id,
        status: TableSessionStatus.PENDING_CONFIRMATION,
        token: newSessionToken(),
        shortCode: newShortCode(),
        customerName: body.name,
        customerPhone: body.phone,
        customerEmail: body.email,
        expiresAt
      }
    });
    await tx.restaurantTable.update({
      where: { id: table.id },
      data: { status: "RESERVED", openedAt: null, closedAt: null }
    });
    return created;
  });

  return res.status(201).json({
    id: session.id,
    status: session.status,
    table: { id: table.id, number: table.number, name: table.name },
    sessionUrl: publicTableSessionUrl(req, session.token, table.company.subdomain),
    message: "Solicitacao enviada. Aguarde o garcom confirmar a abertura da mesa."
  });
}

export async function getPublicTableSession(req: Request, res: Response) {
  const token = z.string().min(20).parse(req.params.token);
  const session = await prisma.tableSession.findUnique({
    where: { token },
    include: {
      table: { include: { area: true } },
      company: {
        select: {
          id: true,
          tradeName: true,
          logoUrl: true,
          subdomain: true,
          active: true
        }
      },
      orders: {
        where: { deletedAt: null, status: { notIn: ["CANCELED"] } },
        include: {
          items: { include: { product: { select: { id: true, name: true } }, complements: true } }
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });
  if (!session) return res.status(404).json({ message: "Atendimento nao encontrado" });

  const expired = Boolean(session.expiresAt && session.expiresAt < new Date());
  const settings = await prisma.setting.findFirst({ where: { companyId: session.companyId } });
  const subtotal = session.orders.reduce((sum, order) => sum + Number(order.total), 0);
  const account = buildAccountTotals(subtotal, {
    serviceFeeEnabled: settings?.tableServiceFeeEnabled ?? false,
    serviceFeePercent: Number(settings?.tableServiceFeePercent ?? 10),
    discount: 0
  });

  return res.json({
    id: session.id,
    token: session.token,
    status: expired ? "CLOSED" : session.status,
    requiresCode: session.status === TableSessionStatus.OPEN || session.status === TableSessionStatus.CLOSING_REQUESTED,
    customerName: session.customerName,
    customerPhone: session.customerPhone,
    customerEmail: session.customerEmail,
    openedAt: session.openedAt,
    expiresAt: session.expiresAt,
    total: account.total,
    account,
    table: {
      id: session.table.id,
      number: session.table.number,
      name: session.table.name,
      seats: session.table.seats,
      status: session.table.status,
      area: session.table.area
    },
    company: session.company,
    orders: session.orders
  });
}

export async function verifyPublicTableSessionCode(req: Request, res: Response) {
  const token = z.string().min(20).parse(req.params.token);
  const body = z.object({ code: z.string().min(4).max(12) }).parse(req.body);
  const session = await prisma.tableSession.findUnique({ where: { token } });
  if (!session) return res.status(404).json({ message: "Atendimento nao encontrado" });
  if (session.status === TableSessionStatus.PENDING_CONFIRMATION) {
    return res.status(409).json({ message: "Aguardando confirmacao do garcom para abrir a mesa" });
  }
  if (session.status === TableSessionStatus.CLOSED || session.status === TableSessionStatus.CANCELLED) {
    return res.status(409).json({ message: "Atendimento encerrado" });
  }
  if (session.expiresAt && session.expiresAt < new Date()) {
    return res.status(409).json({ message: "Atendimento expirado. Chame o garcom." });
  }
  if (session.shortCode.toUpperCase() !== body.code.trim().toUpperCase()) {
    return res.status(401).json({ message: "Codigo da mesa invalido" });
  }
  await prisma.tableSession.update({
    where: { id: session.id },
    data: { lastActivityAt: new Date() }
  });
  return res.json({ ok: true, sessionId: session.id, token: session.token });
}

export async function callWaiterFromSession(req: Request, res: Response) {
  const token = z.string().min(20).parse(req.params.token);
  const session = await prisma.tableSession.findUnique({
    where: { token },
    include: { table: true }
  });
  if (!session) return res.status(404).json({ message: "Atendimento nao encontrado" });
  if (session.status !== TableSessionStatus.OPEN && session.status !== TableSessionStatus.CLOSING_REQUESTED) {
    return res.status(409).json({ message: "Atendimento encerrado" });
  }
  await prisma.$transaction([
    prisma.restaurantTable.update({
      where: { id: session.tableId },
      data: { status: session.table.status === "FREE" ? "OCCUPIED" : session.table.status, openedAt: session.table.openedAt ?? new Date() }
    }),
    prisma.tableSession.update({
      where: { id: session.id },
      data: { lastActivityAt: new Date(), waiterCalledAt: new Date() }
    })
  ]);
  return res.json({ ok: true, message: `Garcom chamado na mesa ${session.table.number}` });
}

export async function acknowledgeWaiterCall(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const table = await prisma.restaurantTable.findFirst({
    where: { id: req.params.id, companyId, active: true },
    select: { id: true, number: true }
  });
  if (!table) return res.status(404).json({ message: "Mesa nao encontrada" });

  const session = await prisma.tableSession.findFirst({
    where: {
      id: req.params.sessionId,
      companyId,
      tableId: table.id,
      status: { in: [TableSessionStatus.OPEN, TableSessionStatus.CLOSING_REQUESTED] }
    }
  });
  if (!session) return res.status(404).json({ message: "Atendimento ativo nao encontrado" });

  await prisma.tableSession.update({
    where: { id: session.id },
    data: {
      waiterCalledAt: null,
      lastActivityAt: new Date()
    }
  });

  return res.json({ ok: true, message: `Chamado da mesa ${table.number} atendido` });
}

export async function requestBillFromSession(req: Request, res: Response) {
  const token = z.string().min(20).parse(req.params.token);
  const session = await prisma.tableSession.findUnique({
    where: { token },
    include: { table: true }
  });
  if (!session) return res.status(404).json({ message: "Atendimento nao encontrado" });
  if (session.status !== TableSessionStatus.OPEN) {
    return res.status(409).json({ message: session.status === TableSessionStatus.CLOSING_REQUESTED ? "Conta ja solicitada" : "Atendimento encerrado" });
  }
  await prisma.$transaction([
    prisma.tableSession.update({
      where: { id: session.id },
      data: { status: TableSessionStatus.CLOSING_REQUESTED, lastActivityAt: new Date(), billRequestedAt: new Date() }
    }),
    prisma.restaurantTable.update({
      where: { id: session.tableId },
      data: { status: "WAITING_PAYMENT" }
    })
  ]);
  return res.json({ ok: true, message: `Conta solicitada para a mesa ${session.table.number}` });
}

export async function reopenTableSession(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const session = await prisma.tableSession.findFirst({
    where: {
      id: req.params.sessionId,
      tableId: req.params.id,
      companyId,
      status: TableSessionStatus.CLOSING_REQUESTED
    },
    include: { table: { include: { area: true } }, openedByUser: { select: { id: true, name: true } } }
  });
  if (!session) return res.status(404).json({ message: "Conta solicitada nao encontrada para reabrir" });

  const updated = await prisma.$transaction(async (tx) => {
    const reopened = await tx.tableSession.update({
      where: { id: session.id },
      data: {
        status: TableSessionStatus.OPEN,
        billRequestedAt: null,
        lastActivityAt: new Date()
      },
      include: { openedByUser: { select: { id: true, name: true } } }
    });
    await tx.restaurantTable.update({
      where: { id: session.tableId },
      data: { status: "OCCUPIED" }
    });
    return reopened;
  });

  await audit(req, {
    action: "TABLE_SESSION_REOPENED",
    entity: "TableSession",
    entityId: updated.id,
    newValue: { tableId: session.tableId, tableNumber: session.table.number }
  });

  const subdomain = await currentCompanySubdomain(req);
  return res.json({
    ...updated,
    table: session.table,
    sessionUrl: publicTableSessionUrl(req, updated.token, subdomain)
  });
}

export async function callWaiterFromTable(req: Request, res: Response) {
  return res.status(410).json({ message: "Use o QR Code seguro do atendimento para chamar o garcom" });
}

export async function requestBillFromTable(req: Request, res: Response) {
  return res.status(410).json({ message: "Use o QR Code seguro do atendimento para solicitar a conta" });
}
