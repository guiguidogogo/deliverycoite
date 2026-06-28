import type { Request, Response } from "express";
import { PaymentMethod } from "@prisma/client";
import { z } from "zod";
import { createMercadoPagoPixPayment, createMercadoPagoPreference, getMercadoPagoPayment } from "../services/mercadopago.js";
import { prisma } from "../utils/prisma.js";
import { companyWhere, getCompanyId } from "../utils/tenant.js";
import { formatOrderCode } from "../utils/order-code.js";

function requestBaseUrl(req: Request) {
  const proto = req.get("x-forwarded-proto")?.split(",")[0] || req.protocol || "https";
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}`;
}

function appendQuery(url: string, params: Record<string, string>) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${new URLSearchParams(params).toString()}`;
}

function storeBaseUrl(req: Request, subdomain: string) {
  const rootDomain = process.env.ROOT_DOMAIN || "hubregional.com.br";
  const proto = req.get("x-forwarded-proto")?.split(",")[0] || req.protocol || "https";
  const host = req.get("host") || "";
  if (host.includes("localhost") || host.includes("127.0.0.1") || host.includes("sslip.io")) {
    return `${proto}://${host}/?subdomain=${encodeURIComponent(subdomain)}`;
  }
  return `https://${subdomain}.${rootDomain}`;
}

export async function getMercadoPagoPublicConfig(req: Request, res: Response) {
  const company = await prisma.company.findUnique({
    where: { id: getCompanyId(req) },
    select: { mercadoPagoEnabled: true, mercadoPagoPublicKey: true }
  });
  const enabled = Boolean(company?.mercadoPagoEnabled && company.mercadoPagoPublicKey);
  return res.json({
    enabled,
    publicKey: enabled ? company?.mercadoPagoPublicKey ?? null : null
  });
}

export async function createOrderMercadoPagoPreference(req: Request, res: Response) {
  const { orderId } = z.object({ orderId: z.string().min(1) }).parse(req.params);
  const order = await prisma.order.findFirst({
    where: { id: orderId, ...companyWhere(req) },
    include: { customer: true, company: true }
  });

  if (!order) return res.status(404).json({ message: "Pedido nao encontrado" });
  if (order.status === "CANCELED") return res.status(400).json({ message: "Pedido cancelado nao pode ser pago" });
  if (order.paidAt) return res.status(400).json({ message: "Pedido ja esta pago" });
  if (!order.company.mercadoPagoEnabled || !order.company.mercadoPagoAccessToken) {
    return res.status(400).json({ message: "Mercado Pago nao configurado para esta empresa" });
  }

  const baseUrl = requestBaseUrl(req);
  const storeUrl = storeBaseUrl(req, order.company.subdomain);
  const preference = await createMercadoPagoPreference({
    accessToken: order.company.mercadoPagoAccessToken,
    orderId: order.id,
    companyId: order.companyId,
    orderNumber: order.orderNumber,
    description: `${order.company.tradeName} - Pedido #${formatOrderCode(order.orderNumber)}`,
    amount: Number(order.total),
    payer: {
      name: order.customer.name,
      email: order.customer.email,
      phone: order.customer.phone
    },
    notificationUrl: `${baseUrl}/api/mercadopago/webhook`,
    successUrl: appendQuery(storeUrl, { mp_status: "success", order: order.id }),
    failureUrl: appendQuery(storeUrl, { mp_status: "failure", order: order.id }),
    pendingUrl: appendQuery(storeUrl, { mp_status: "pending", order: order.id })
  });

  await prisma.order.update({
    where: { id: order.id },
    data: {
      mercadoPagoPreferenceId: preference.id,
      mercadoPagoStatus: "preference_created"
    }
  });

  return res.status(201).json({
    preferenceId: preference.id,
    initPoint: preference.init_point ?? null,
    sandboxInitPoint: preference.sandbox_init_point ?? null
  });
}

export async function createOrderMercadoPagoPix(req: Request, res: Response) {
  const { orderId } = z.object({ orderId: z.string().min(1) }).parse(req.params);
  const order = await prisma.order.findFirst({
    where: { id: orderId, ...companyWhere(req) },
    include: { customer: true, company: true }
  });

  if (!order) return res.status(404).json({ message: "Pedido nao encontrado" });
  if (order.status === "CANCELED") return res.status(400).json({ message: "Pedido cancelado nao pode ser pago" });
  if (order.paidAt) return res.status(400).json({ message: "Pedido ja esta pago" });
  if (!order.company.mercadoPagoEnabled || !order.company.mercadoPagoAccessToken) {
    return res.status(400).json({ message: "Mercado Pago nao configurado para esta empresa" });
  }

  const baseUrl = requestBaseUrl(req);
  const payment = await createMercadoPagoPixPayment({
    accessToken: order.company.mercadoPagoAccessToken,
    orderId: order.id,
    companyId: order.companyId,
    orderNumber: order.orderNumber,
    description: `${order.company.tradeName} - Pedido #${formatOrderCode(order.orderNumber)}`,
    amount: Number(order.total),
    payer: {
      name: order.customer.name,
      email: order.customer.email,
      phone: order.customer.phone
    },
    notificationUrl: `${baseUrl}/api/mercadopago/webhook`
  });

  await prisma.order.update({
    where: { id: order.id },
    data: {
      mercadoPagoPaymentId: String(payment.id),
      mercadoPagoStatus: payment.status ?? "pending",
      mercadoPagoStatusDetail: payment.status_detail ?? null
    }
  });

  const transactionData = payment.point_of_interaction?.transaction_data;
  return res.status(201).json({
    paymentId: String(payment.id),
    status: payment.status ?? null,
    statusDetail: payment.status_detail ?? null,
    qrCode: transactionData?.qr_code ?? null,
    qrCodeBase64: transactionData?.qr_code_base64 ?? null,
    ticketUrl: transactionData?.ticket_url ?? null
  });
}

export async function mercadoPagoWebhook(req: Request, res: Response) {
  const paymentId =
    req.query["data.id"]?.toString() ||
    req.query.id?.toString() ||
    req.body?.data?.id?.toString() ||
    req.body?.id?.toString();
  const eventType = req.query.type?.toString() || req.body?.type?.toString() || req.body?.topic?.toString();

  if (!paymentId || (eventType && !["payment", "merchant_order"].includes(eventType))) {
    return res.status(200).json({ ok: true, ignored: true });
  }

  const existingByPayment = await prisma.order.findFirst({
    where: { mercadoPagoPaymentId: paymentId },
    include: { company: true }
  });

  let accessToken = existingByPayment?.company.mercadoPagoAccessToken;
  let payment = accessToken ? await getMercadoPagoPayment(accessToken, paymentId) : null;
  let orderId = payment?.external_reference || payment?.metadata?.order_id || existingByPayment?.id;

  if (!orderId) {
    return res.status(200).json({ ok: true, ignored: true, reason: "order_not_found_in_payment" });
  }

  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { company: true } });
  if (!order?.company.mercadoPagoAccessToken) {
    return res.status(200).json({ ok: true, ignored: true, reason: "company_without_token" });
  }

  if (!payment) {
    payment = await getMercadoPagoPayment(order.company.mercadoPagoAccessToken, paymentId);
  }

  const approved = payment.status === "approved";
  await prisma.order.update({
    where: { id: order.id },
    data: {
      mercadoPagoPaymentId: String(payment.id),
      mercadoPagoStatus: payment.status ?? null,
      mercadoPagoStatusDetail: payment.status_detail ?? null,
      ...(approved && !order.paidAt
        ? {
            paidAt: new Date(),
            paymentMethod: PaymentMethod.MERCADO_PAGO,
            paidMethodDetail: `Mercado Pago (${payment.payment_type_id ?? payment.payment_method_id ?? "online"})`,
            status: order.status === "RECEIVED" ? "PREPARING" : order.status
          }
        : {})
    }
  });

  return res.status(200).json({ ok: true });
}
