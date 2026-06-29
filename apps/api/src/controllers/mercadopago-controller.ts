import type { Request, Response } from "express";
import { PaymentMethod } from "@prisma/client";
import { z } from "zod";
import {
  createMercadoPagoPixPayment,
  createMercadoPagoPreference,
  getMercadoPagoPayment,
  refundMercadoPagoPayment,
  searchMercadoPagoPayments,
  type MercadoPagoPaymentResponse
} from "../services/mercadopago.js";
import { publishNewOrder } from "../services/realtime.js";
import { printOrder } from "../services/thermal-printer.js";
import { buildWhatsappMessage, dispatchWhatsappMessage } from "../services/whatsapp.js";
import { prisma } from "../utils/prisma.js";
import { companyWhere, getCompanyId } from "../utils/tenant.js";
import { formatOrderCode } from "../utils/order-code.js";
import { audit } from "../utils/audit.js";

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

async function applyApprovedMercadoPagoPayment(orderId: string, payment: MercadoPagoPaymentResponse) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { company: true } });
  if (!order) return null;

  const approved = payment.status === "approved";
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      mercadoPagoPaymentId: String(payment.id),
      mercadoPagoStatus: payment.status ?? order.mercadoPagoStatus,
      mercadoPagoStatusDetail: payment.status_detail ?? order.mercadoPagoStatusDetail,
      ...(approved && !order.paidAt
        ? {
            paidAt: new Date(),
            paymentMethod: PaymentMethod.MERCADO_PAGO,
            paidMethodDetail: `Mercado Pago (${payment.payment_type_id ?? payment.payment_method_id ?? "online"})`,
            status: order.status === "RECEIVED" ? "PREPARING" : order.status,
            notes: [order.notes, `[PAGO: Mercado Pago em ${new Date().toLocaleString("pt-BR")}]`]
              .filter(Boolean)
              .join(" ")
          }
        : {})
    }
  });

  if (approved && !order.paidAt) {
    const [settings, paidOrder] = await Promise.all([
      prisma.setting.findFirst({ where: { companyId: order.companyId } }),
      prisma.order.findUnique({
        where: { id: order.id },
        include: { customer: true, items: { include: { product: true, complements: true } } }
      })
    ]);

    if (settings && paidOrder) {
      const whatsapp = buildWhatsappMessage(paidOrder, settings);
      const sent = await dispatchWhatsappMessage(settings, settings.whatsappNumber, whatsapp.message, settings.whatsappNumber);
      await prisma.order.update({
        where: { id: paidOrder.id },
        data: { whatsappLink: sent.whatsappUrl ?? whatsapp.url }
      });

      if (settings.printerEnabled && settings.printerAutoPrint) {
        await printOrder(paidOrder, settings).catch(() => undefined);
      }

      publishNewOrder({
        companyId: paidOrder.companyId,
        orderId: paidOrder.id,
        customer: paidOrder.customer.name,
        total: Number(paidOrder.total)
      });
    }
  }

  return updated;
}

function chooseBestPayment(payments: MercadoPagoPaymentResponse[]) {
  return payments.find((payment) => payment.status === "approved") ?? payments[0] ?? null;
}

async function refreshMercadoPagoOrderStatus(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { company: true } });
  if (!order?.company.mercadoPagoAccessToken) return order;
  if (order.paidAt || order.mercadoPagoStatus === "refunded") return order;

  let payment: MercadoPagoPaymentResponse | null = null;
  if (order.mercadoPagoPaymentId) {
    payment = await getMercadoPagoPayment(order.company.mercadoPagoAccessToken, order.mercadoPagoPaymentId);
  } else if (order.mercadoPagoPreferenceId) {
    const byPreference = await searchMercadoPagoPayments(order.company.mercadoPagoAccessToken, { externalReference: order.id });
    payment = chooseBestPayment(byPreference.results ?? []);

    if (!payment) {
      const byReference = await searchMercadoPagoPayments(order.company.mercadoPagoAccessToken, {
        externalReference: order.id
      });
      payment = chooseBestPayment(byReference.results ?? []);
    }
  }

  if (!payment) return order;
  return applyApprovedMercadoPagoPayment(order.id, payment);
}

export async function getOrderMercadoPagoStatus(req: Request, res: Response) {
  const { orderId } = z.object({ orderId: z.string().min(1) }).parse(req.params);
  const order = await prisma.order.findFirst({
    where: { id: orderId, ...companyWhere(req) },
    select: {
      id: true,
      status: true,
      paidAt: true,
      mercadoPagoStatus: true,
      mercadoPagoStatusDetail: true,
      mercadoPagoPaymentId: true,
      mercadoPagoPreferenceId: true
    }
  });

  if (!order) return res.status(404).json({ message: "Pedido nao encontrado" });

  let current = order;
  if ((order.mercadoPagoPaymentId || order.mercadoPagoPreferenceId) && !order.paidAt && order.mercadoPagoStatus !== "refunded") {
    const refreshed = await refreshMercadoPagoOrderStatus(order.id);
    if (refreshed) {
      current = {
        id: refreshed.id,
        status: refreshed.status,
        paidAt: refreshed.paidAt,
        mercadoPagoStatus: refreshed.mercadoPagoStatus,
        mercadoPagoStatusDetail: refreshed.mercadoPagoStatusDetail,
        mercadoPagoPaymentId: refreshed.mercadoPagoPaymentId,
        mercadoPagoPreferenceId: refreshed.mercadoPagoPreferenceId
      };
    }
  }

  return res.json({
    orderId: current.id,
    orderStatus: current.status,
    paid: Boolean(current.paidAt),
    paidAt: current.paidAt,
    mercadoPagoStatus: current.mercadoPagoStatus,
    mercadoPagoStatusDetail: current.mercadoPagoStatusDetail
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

  await applyApprovedMercadoPagoPayment(order.id, payment);

  return res.status(200).json({ ok: true });
}

export async function refundOrderMercadoPago(req: Request, res: Response) {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, ...companyWhere(req) },
    include: { company: true }
  });

  if (!order) return res.status(404).json({ message: "Pedido nao encontrado" });
  if (order.paymentMethod !== PaymentMethod.MERCADO_PAGO || !order.mercadoPagoPaymentId) {
    return res.status(400).json({ message: "Este pedido nao possui pagamento Mercado Pago" });
  }
  if (order.mercadoPagoStatus === "refunded") {
    return res.status(400).json({ message: "Este pedido ja foi estornado" });
  }
  if (!order.paidAt) {
    return res.status(400).json({ message: "Somente pagamentos confirmados podem ser estornados" });
  }
  if (!order.company.mercadoPagoAccessToken) {
    return res.status(400).json({ message: "Mercado Pago nao configurado para esta empresa" });
  }

  const refund = await refundMercadoPagoPayment(order.company.mercadoPagoAccessToken, order.mercadoPagoPaymentId);
  const updated = await prisma.$transaction(async (transaction) => {
    const row = await transaction.order.update({
      where: { id: order.id },
      data: {
        paidAt: null,
        mercadoPagoStatus: "refunded",
        mercadoPagoStatusDetail: refund.status ?? "refunded",
        status: "CANCELED",
        notes: [order.notes, `[ESTORNO MERCADO PAGO: ${new Date().toLocaleString("pt-BR")}]`]
          .filter(Boolean)
          .join(" ")
      }
    });

    await audit(req, {
      action: "MERCADO_PAGO_REFUND",
      entity: "Order",
      entityId: order.id,
      oldValue: { paidAt: order.paidAt, mercadoPagoStatus: order.mercadoPagoStatus },
      newValue: { refundId: refund.id, status: refund.status }
    }, transaction);

    return row;
  });

  return res.json({ ...updated, refund });
}
