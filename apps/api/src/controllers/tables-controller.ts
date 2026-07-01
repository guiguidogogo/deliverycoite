import crypto from "node:crypto";
import type { Request, Response } from "express";
import { FulfillmentType, OrderSource, PaymentMethod, Prisma, TableSessionStatus, TableStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { companyWhere, getCompanyId } from "../utils/tenant.js";
import { recordCashPayments } from "../utils/cash-register.js";
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
  })).optional()
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
        include: { openedByUser: { select: { id: true, name: true } } }
      },
      _count: {
        select: {
          orders: {
            where: {
              status: { notIn: ["FINISHED", "CANCELED"] },
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
    return {
      ...table,
      activeSession: activeSession ? {
        ...activeSession,
        sessionUrl: publicTableSessionUrl(req, activeSession.token, subdomain)
      } : null,
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
  const table = await prisma.restaurantTable.update({
    where: { id: req.params.id, companyId: getCompanyId(req) },
    data: {
      status: body.status,
      openedAt: body.status === "OCCUPIED" ? new Date() : undefined,
      closedAt: body.status === "FREE" ? new Date() : undefined
    }
  });
  const subdomain = await currentCompanySubdomain(req);
  return res.json({ ...table, qrCodeUrl: publicTableUrl(req, table, subdomain) });
}

export async function listTableOrders(req: Request, res: Response) {
  const table = await prisma.restaurantTable.findFirst({
    where: { id: req.params.id, companyId: getCompanyId(req), active: true },
    select: { id: true }
  });
  if (!table) return res.status(404).json({ message: "Mesa nao encontrada" });

  const orders = await prisma.order.findMany({
    where: {
      companyId: getCompanyId(req),
      tableId: table.id,
      deletedAt: null,
      status: { notIn: ["FINISHED", "CANCELED"] }
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
    select: { id: true, number: true }
  });
  if (!table) return res.status(404).json({ message: "Mesa nao encontrada" });

  const activeSession = await prisma.tableSession.findFirst({
    where: {
      companyId,
      tableId: table.id,
      status: { in: [TableSessionStatus.OPEN, TableSessionStatus.CLOSING_REQUESTED] }
    }
  });

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

  const order = await prisma.order.create({
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

export async function closeTableAccount(req: Request, res: Response) {
  const body = closeTableSchema.parse(req.body);
  const companyId = getCompanyId(req);
  const table = await prisma.restaurantTable.findFirst({
    where: { id: req.params.id, companyId, active: true },
    select: { id: true, number: true }
  });
  if (!table) return res.status(404).json({ message: "Mesa nao encontrada" });

  const activeSession = await prisma.tableSession.findFirst({
    where: {
      companyId,
      tableId: table.id,
      status: { in: [TableSessionStatus.OPEN, TableSessionStatus.CLOSING_REQUESTED] }
    }
  });

  const orders = await prisma.order.findMany({
    where: {
      companyId,
      tableId: table.id,
      ...(activeSession ? { tableSessionId: activeSession.id } : {}),
      deletedAt: null,
      status: { notIn: ["CANCELED"] }
    },
    select: {
      id: true,
      orderNumber: true,
      total: true,
      paidAt: true,
      notes: true
    },
    orderBy: { createdAt: "asc" }
  });
  if (!orders.length) {
    return res.status(400).json({ message: "Nao ha pedidos abertos nesta mesa" });
  }
  if (orders.some((order) => order.paidAt)) {
    return res.status(400).json({ message: "Esta mesa possui pedido ja pago. Finalize os pedidos individualmente por enquanto." });
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

  const settings = await prisma.setting.findFirst({ where: { companyId } });
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
    payments: splitPayments
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
      data: { lastActivityAt: new Date() }
    })
  ]);
  return res.json({ ok: true, message: `Garcom chamado na mesa ${session.table.number}` });
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
      data: { status: TableSessionStatus.CLOSING_REQUESTED, lastActivityAt: new Date() }
    }),
    prisma.restaurantTable.update({
      where: { id: session.tableId },
      data: { status: "WAITING_PAYMENT" }
    })
  ]);
  return res.json({ ok: true, message: `Conta solicitada para a mesa ${session.table.number}` });
}

export async function callWaiterFromTable(req: Request, res: Response) {
  return res.status(410).json({ message: "Use o QR Code seguro do atendimento para chamar o garcom" });
}

export async function requestBillFromTable(req: Request, res: Response) {
  return res.status(410).json({ message: "Use o QR Code seguro do atendimento para solicitar a conta" });
}
