import type { Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { OrderStatus, PaymentMethod } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { getCompanyId } from "../utils/tenant.js";
import { receiptText } from "../services/thermal-printer.js";
import { formatOrderCode } from "../utils/order-code.js";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function readAgentToken(req: Request) {
  const header = req.headers.authorization?.toString() ?? "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return req.headers["x-printer-token"]?.toString().trim() ?? "";
}

async function getAgentCompany(req: Request) {
  const token = readAgentToken(req);
  if (!token) return null;

  return prisma.company.findFirst({
    where: {
      printerAgentTokenHash: hashToken(token),
      printerAgentEnabled: true,
      active: true
    },
    select: { id: true, tradeName: true, subdomain: true }
  });
}

function orderToPayload(order: Awaited<ReturnType<typeof findPrintableOrders>>[number], receipt: string) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    code: formatOrderCode(order.orderNumber),
    createdAt: order.createdAt,
    total: Number(order.total),
    customer: {
      name: order.customer.name,
      phone: order.customer.phone,
      address: order.customer.address,
      number: order.customer.number,
      district: order.customer.district,
      complement: order.customer.complement
    },
    receipt
  };
}

async function findPrintableOrders(companyId: string, since?: Date) {
  const createdSince = since && !Number.isNaN(since.getTime())
    ? since
    : new Date(Date.now() - 1000 * 60 * 60 * 24);
  return prisma.order.findMany({
    where: {
      companyId,
      deletedAt: null,
      printerQueuedAt: null,
      printerPrintedAt: null,
      createdAt: { gte: createdSince },
      status: { notIn: [OrderStatus.CANCELED, OrderStatus.FINISHED] },
      OR: [
        { paymentMethod: { not: PaymentMethod.MERCADO_PAGO } },
        { paymentMethod: PaymentMethod.MERCADO_PAGO, paidAt: { not: null } }
      ]
    },
    include: {
      customer: true,
      items: { include: { product: true, complements: true } }
    },
    orderBy: { createdAt: "asc" },
    take: 20
  });
}

export async function generatePrinterAgentToken(req: Request, res: Response) {
  const token = `hbp_${randomBytes(32).toString("base64url")}`;
  await prisma.company.update({
    where: { id: getCompanyId(req) },
    data: {
      printerAgentTokenHash: hashToken(token),
      printerAgentEnabled: true
    }
  });

  return res.json({
    token,
    message: "Copie este token agora. Por seguranca, ele nao sera exibido novamente."
  });
}

export async function getPrinterAgentConfig(req: Request, res: Response) {
  const company = await prisma.company.findUnique({
    where: { id: getCompanyId(req) },
    select: {
      printerAgentEnabled: true,
      printerAgentTokenHash: true,
      printerAgentLastSeenAt: true
    }
  });

  return res.json({
    enabled: company?.printerAgentEnabled ?? false,
    hasToken: Boolean(company?.printerAgentTokenHash),
    lastSeenAt: company?.printerAgentLastSeenAt ?? null
  });
}

export async function updatePrinterAgentConfig(req: Request, res: Response) {
  const body = z.object({ enabled: z.boolean() }).parse(req.body);
  const company = await prisma.company.update({
    where: { id: getCompanyId(req) },
    data: { printerAgentEnabled: body.enabled },
    select: {
      printerAgentEnabled: true,
      printerAgentTokenHash: true,
      printerAgentLastSeenAt: true
    }
  });

  return res.json({
    enabled: company.printerAgentEnabled,
    hasToken: Boolean(company.printerAgentTokenHash),
    lastSeenAt: company.printerAgentLastSeenAt
  });
}

export async function listPrinterAgentOrders(req: Request, res: Response) {
  const company = await getAgentCompany(req);
  if (!company) return res.status(401).json({ message: "Token de impressao invalido ou desativado" });
  const sinceParam = req.query.since?.toString();
  const since = sinceParam ? new Date(sinceParam) : undefined;

  const [settings, orders] = await Promise.all([
    prisma.setting.findUnique({ where: { companyId: company.id } }),
    findPrintableOrders(company.id, since)
  ]);

  const safeSettings = settings ?? {
    companyName: company.tradeName,
    printerPaperWidth: 58
  };

  await prisma.company.update({
    where: { id: company.id },
    data: { printerAgentLastSeenAt: new Date() }
  });

  if (orders.length) {
    await prisma.order.updateMany({
      where: {
        companyId: company.id,
        id: { in: orders.map((order) => order.id) },
        printerQueuedAt: null
      },
      data: { printerQueuedAt: new Date() }
    });
  }

  return res.json({
    company: { id: company.id, tradeName: company.tradeName, subdomain: company.subdomain },
    orders: orders.map((order) => orderToPayload(order, receiptText(order, safeSettings)))
  });
}

export async function markPrinterAgentOrderPrinted(req: Request, res: Response) {
  const company = await getAgentCompany(req);
  if (!company) return res.status(401).json({ message: "Token de impressao invalido ou desativado" });

  const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
  const body = z.object({
    ok: z.boolean().default(true),
    error: z.string().max(500).optional()
  }).parse(req.body ?? {});

  const order = await prisma.order.findFirst({
    where: { id, companyId: company.id },
    select: { id: true, printerPrintedAt: true, printerPrintCount: true }
  });
  if (!order) return res.status(404).json({ message: "Pedido nao encontrado" });

  const updated = await prisma.order.update({
    where: { id },
    data: body.ok
      ? {
          printerPrintedAt: order.printerPrintedAt ?? new Date(),
          printerPrintCount: { increment: 1 },
          printerLastError: null
        }
      : {
          printerLastError: body.error ?? "Falha informada pelo agente de impressao"
        },
    select: { id: true, printerPrintedAt: true, printerPrintCount: true, printerLastError: true }
  });

  return res.json(updated);
}

export async function getPrinterAgentTestReceipt(req: Request, res: Response) {
  const company = await getAgentCompany(req);
  if (!company) return res.status(401).json({ message: "Token de impressao invalido ou desativado" });

  await prisma.company.update({
    where: { id: company.id },
    data: { printerAgentLastSeenAt: new Date() }
  });

  return res.json({
    receipt: [
      company.tradeName.toUpperCase(),
      "TESTE DE IMPRESSAO",
      new Date().toLocaleString("pt-BR"),
      "--------------------------------",
      "HubRegional Printer Agent",
      "Conexao realizada com sucesso.",
      "",
      ""
    ].join("\r\n")
  });
}
