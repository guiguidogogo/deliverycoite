import crypto from "node:crypto";
import { EventStatus, Prisma, TicketStatus } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { companyWhere, getCompanyId } from "../utils/tenant.js";

const optionalText = z.preprocess(
  (value) => typeof value === "string" && !value.trim() ? null : value,
  z.string().trim().nullable().optional()
);

const eventSchema = z.object({
  title: z.string().trim().min(2, "Informe o nome do evento"),
  description: optionalText,
  bannerUrl: optionalText,
  location: z.string().trim().min(2, "Informe o local do evento"),
  eventDate: z.coerce.date(),
  startTime: z.string().trim().min(1, "Informe o horario inicial"),
  endTime: optionalText,
  status: z.nativeEnum(EventStatus).default("DRAFT")
});

const ticketTypeSchema = z.object({
  name: z.string().trim().min(2, "Informe o tipo de ingresso"),
  description: optionalText,
  price: z.coerce.number().min(0, "Preco invalido"),
  quantityTotal: z.coerce.number().int().min(1, "Quantidade invalida"),
  lotName: optionalText,
  saleStart: z.coerce.date().nullable().optional(),
  saleEnd: z.coerce.date().nullable().optional(),
  active: z.boolean().default(true)
});

const ticketOrderSchema = z.object({
  customerName: z.string().trim().min(2, "Informe seu nome"),
  customerPhone: z.string().trim().min(8, "Informe seu telefone"),
  customerEmail: z.preprocess(
    (value) => typeof value === "string" && !value.trim() ? null : value,
    z.string().trim().email("Email invalido").nullable().optional()
  ),
  items: z.array(z.object({
    ticketTypeId: z.string().min(1),
    quantity: z.coerce.number().int().min(1).max(20)
  })).min(1, "Selecione pelo menos um ingresso")
});

function serializeEvent<T extends { ticketTypes?: Array<{ price: Prisma.Decimal }>; ticketOrders?: Array<{ total: Prisma.Decimal }>; }>(event: T) {
  return {
    ...event,
    ticketTypes: event.ticketTypes?.map((ticketType) => ({
      ...ticketType,
      price: Number(ticketType.price)
    })),
    ticketOrders: event.ticketOrders?.map((order) => ({
      ...order,
      total: Number(order.total)
    }))
  };
}

function ticketCode() {
  return crypto.randomBytes(5).toString("hex").toUpperCase();
}

function qrCode() {
  return `hub_ticket_${crypto.randomBytes(18).toString("hex")}`;
}

export async function listPublicEvents(req: Request, res: Response) {
  const events = await prisma.event.findMany({
    where: {
      companyId: getCompanyId(req),
      status: "PUBLISHED"
    },
    include: {
      ticketTypes: {
        where: { active: true },
        orderBy: [{ saleStart: "asc" }, { price: "asc" }]
      }
    },
    orderBy: [{ eventDate: "asc" }, { startTime: "asc" }]
  });

  return res.json(events.map(serializeEvent));
}

export async function getPublicEvent(req: Request, res: Response) {
  const event = await prisma.event.findFirst({
    where: { id: req.params.id, companyId: getCompanyId(req), status: "PUBLISHED" },
    include: {
      ticketTypes: {
        where: { active: true },
        orderBy: [{ saleStart: "asc" }, { price: "asc" }]
      }
    }
  });
  if (!event) return res.status(404).json({ message: "Evento nao encontrado" });
  return res.json(serializeEvent(event));
}

export async function createPublicTicketOrder(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const body = ticketOrderSchema.parse(req.body);

  const result = await prisma.$transaction(async (tx) => {
    const event = await tx.event.findFirst({
      where: { id: req.params.id, companyId, status: "PUBLISHED" },
      select: { id: true, title: true }
    });
    if (!event) throw new Error("Evento nao encontrado");

    const ids = [...new Set(body.items.map((item) => item.ticketTypeId))];
    const ticketTypes = await tx.ticketType.findMany({
      where: { id: { in: ids }, eventId: event.id, active: true }
    });

    if (ticketTypes.length !== ids.length) {
      throw new Error("Ingresso indisponivel");
    }

    const now = new Date();
    let total = new Prisma.Decimal(0);
    const ticketsToCreate: Array<{ ticketTypeId: string; code: string; qrCode: string; status: TicketStatus }> = [];

    for (const item of body.items) {
      const ticketType = ticketTypes.find((candidate) => candidate.id === item.ticketTypeId)!;
      if (ticketType.saleStart && ticketType.saleStart > now) throw new Error(`${ticketType.name} ainda nao esta a venda`);
      if (ticketType.saleEnd && ticketType.saleEnd < now) throw new Error(`${ticketType.name} encerrou as vendas`);
      if (ticketType.quantitySold + item.quantity > ticketType.quantityTotal) throw new Error(`${ticketType.name} sem quantidade suficiente`);

      total = total.plus(ticketType.price.mul(item.quantity));
      for (let index = 0; index < item.quantity; index += 1) {
        ticketsToCreate.push({
          ticketTypeId: ticketType.id,
          code: ticketCode(),
          qrCode: qrCode(),
          status: "RESERVED"
        });
      }
      await tx.ticketType.update({
        where: { id: ticketType.id },
        data: { quantitySold: { increment: item.quantity } }
      });
    }

    const order = await tx.ticketOrder.create({
      data: {
        companyId,
        eventId: event.id,
        customerName: body.customerName,
        customerPhone: body.customerPhone.replace(/\D/g, ""),
        customerEmail: body.customerEmail?.toLowerCase() ?? null,
        total,
        status: "RESERVED",
        paymentStatus: "PENDING",
        tickets: { create: ticketsToCreate }
      },
      include: {
        event: { select: { title: true, eventDate: true, location: true } },
        tickets: { include: { ticketType: true } }
      }
    });

    return order;
  });

  return res.status(201).json({
    ...result,
    total: Number(result.total),
    tickets: result.tickets.map((ticket) => ({
      ...ticket,
      ticketType: { ...ticket.ticketType, price: Number(ticket.ticketType.price) }
    }))
  });
}

export async function listAdminEvents(req: Request, res: Response) {
  const events = await prisma.event.findMany({
    where: companyWhere(req),
    include: {
      ticketTypes: { orderBy: { createdAt: "asc" } },
      _count: { select: { ticketOrders: true } }
    },
    orderBy: { eventDate: "desc" }
  });
  return res.json(events.map(serializeEvent));
}

export async function getAdminEvent(req: Request, res: Response) {
  const event = await prisma.event.findFirst({
    where: { id: req.params.id, ...companyWhere(req) },
    include: {
      ticketTypes: { orderBy: { createdAt: "asc" } },
      ticketOrders: {
        include: { tickets: { include: { ticketType: true } } },
        orderBy: { createdAt: "desc" }
      }
    }
  });
  if (!event) return res.status(404).json({ message: "Evento nao encontrado" });
  return res.json(serializeEvent(event));
}

export async function createAdminEvent(req: Request, res: Response) {
  const body = eventSchema.parse(req.body);
  const event = await prisma.event.create({
    data: {
      ...body,
      companyId: getCompanyId(req)
    },
    include: { ticketTypes: true }
  });
  return res.status(201).json(serializeEvent(event));
}

export async function updateAdminEvent(req: Request, res: Response) {
  const existing = await prisma.event.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ message: "Evento nao encontrado" });
  const body = eventSchema.partial().parse(req.body);
  const event = await prisma.event.update({
    where: { id: existing.id },
    data: body,
    include: { ticketTypes: true }
  });
  return res.json(serializeEvent(event));
}

export async function createAdminTicketType(req: Request, res: Response) {
  const event = await prisma.event.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!event) return res.status(404).json({ message: "Evento nao encontrado" });
  const body = ticketTypeSchema.parse(req.body);
  const ticketType = await prisma.ticketType.create({
    data: {
      ...body,
      eventId: event.id,
      price: new Prisma.Decimal(body.price)
    }
  });
  return res.status(201).json({ ...ticketType, price: Number(ticketType.price) });
}

export async function updateAdminTicketType(req: Request, res: Response) {
  const event = await prisma.event.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!event) return res.status(404).json({ message: "Evento nao encontrado" });
  const existing = await prisma.ticketType.findFirst({ where: { id: req.params.ticketTypeId, eventId: event.id } });
  if (!existing) return res.status(404).json({ message: "Ingresso nao encontrado" });
  const body = ticketTypeSchema.partial().parse(req.body);
  const ticketType = await prisma.ticketType.update({
    where: { id: existing.id },
    data: {
      ...body,
      ...(body.price !== undefined ? { price: new Prisma.Decimal(body.price) } : {})
    }
  });
  return res.json({ ...ticketType, price: Number(ticketType.price) });
}

export async function listAdminTicketOrders(req: Request, res: Response) {
  const orders = await prisma.ticketOrder.findMany({
    where: companyWhere(req),
    include: {
      event: { select: { title: true, eventDate: true } },
      tickets: { include: { ticketType: true } }
    },
    orderBy: { createdAt: "desc" }
  });
  return res.json(orders.map((order) => ({
    ...order,
    total: Number(order.total),
    tickets: order.tickets.map((ticket) => ({
      ...ticket,
      ticketType: { ...ticket.ticketType, price: Number(ticket.ticketType.price) }
    }))
  })));
}

export async function validateTicket(req: Request, res: Response) {
  const body = z.object({ code: z.string().trim().min(4) }).parse(req.body);
  const ticket = await prisma.ticket.findFirst({
    where: {
      OR: [{ code: body.code }, { qrCode: body.code }],
      ticketOrder: { companyId: getCompanyId(req) }
    },
    include: {
      ticketType: true,
      ticketOrder: { include: { event: true } }
    }
  });
  if (!ticket) return res.status(404).json({ message: "Ingresso nao encontrado" });
  if (ticket.status === "USED") return res.status(409).json({ message: "Ingresso ja utilizado", ticket });
  if (ticket.status === "CANCELLED") return res.status(409).json({ message: "Ingresso cancelado", ticket });

  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data: { status: "USED", usedAt: new Date() },
    include: {
      ticketType: true,
      ticketOrder: { include: { event: true } }
    }
  });
  return res.json({
    ...updated,
    ticketType: { ...updated.ticketType, price: Number(updated.ticketType.price) },
    ticketOrder: { ...updated.ticketOrder, total: Number(updated.ticketOrder.total) }
  });
}
