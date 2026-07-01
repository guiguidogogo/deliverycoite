import crypto from "node:crypto";
import type { Request, Response } from "express";
import { FulfillmentType, OrderSource, PaymentMethod, Prisma, TableStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { companyWhere, getCompanyId } from "../utils/tenant.js";

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

function publicTableUrl(req: Request, table: { number: number }, explicitSubdomain?: string | null) {
  const rootDomain = process.env.ROOT_DOMAIN ?? "hubregional.com.br";
  const subdomain = explicitSubdomain || req.tenant?.subdomain;
  if (subdomain) return `https://${subdomain}.${rootDomain}/mesa/${table.number}`;
  return `https://${rootDomain}/mesa/${table.number}?subdomain=${encodeURIComponent(req.tenant?.subdomain ?? "")}`;
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

function toDecimal(value: number) {
  return new Prisma.Decimal(value.toFixed(2));
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
  return res.json(tables.map((table) => ({
    ...table,
    qrCodeUrl: publicTableUrl(req, table, subdomain)
  })));
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

export async function createTableOrder(req: Request, res: Response) {
  const body = tableOrderSchema.parse(req.body);
  const companyId = getCompanyId(req);
  const table = await prisma.restaurantTable.findFirst({
    where: { id: req.params.id, companyId, active: true },
    select: { id: true, number: true }
  });
  if (!table) return res.status(404).json({ message: "Mesa nao encontrada" });

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

  return res.status(201).json(order);
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
