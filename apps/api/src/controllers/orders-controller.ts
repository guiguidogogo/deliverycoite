import type { Request, Response } from "express";
import { FulfillmentType, OrderStatus, PaymentMethod, Prisma } from "@prisma/client";
import { z } from "zod";
import { publishNewOrder } from "../services/realtime.js";
import { printOrder } from "../services/thermal-printer.js";
import { buildOrderStatusWhatsappMessage, buildWhatsappMessage, dispatchWhatsappMessage } from "../services/whatsapp.js";
import { prisma } from "../utils/prisma.js";
import { formatOrderCode } from "../utils/order-code.js";
import { recordCashPayments } from "../utils/cash-register.js";
import { calculateDeliveryFee } from "../utils/delivery-fee.js";
import { companyWhere, getCompanyId } from "../utils/tenant.js";
import { audit } from "../utils/audit.js";
import { linkCustomerToCompany, normalizeEmail, normalizePhone, recordCompanyCustomerPurchase } from "../utils/customer-linking.js";

function shouldSendStatusWhatsapp(
  settings: Awaited<ReturnType<typeof prisma.setting.findFirstOrThrow>>,
  status: OrderStatus
) {
  const enabledByStatus: Record<OrderStatus, boolean> = {
    RECEIVED: settings.whatsappOnReceived,
    PREPARING: settings.whatsappOnPreparing,
    OUT_FOR_DELIVERY: settings.whatsappOnOutForDelivery,
    DELIVERED: settings.whatsappOnDelivered,
    FINISHED: settings.whatsappOnFinished,
    CANCELED: settings.whatsappOnCanceled
  };

  return settings.menuiaEnabled && enabledByStatus[status];
}

const checkoutSchema = z
  .object({
    customer: z.object({
      name: z.string().min(2),
      phone: z.string().min(8),
      address: z.string(),
      number: z.string(),
      district: z.string(),
      complement: z.string().optional(),
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional()
    }),
    fulfillmentType: z.nativeEnum(FulfillmentType).default(FulfillmentType.DELIVERY),
    paymentMethod: z.nativeEnum(PaymentMethod),
    changeFor: z.coerce.number().optional(),
    couponCode: z.string().optional(),
    notes: z.string().optional(),
    items: z
      .array(
        z.object({
          productId: z.string(),
          quantity: z.coerce.number().int().positive(),
          complements: z.array(z.object({
            complementId: z.string(),
            quantity: z.coerce.number().int().min(1).max(20)
          })).default([])
        })
      )
      .min(1)
  })
  .superRefine((body, ctx) => {
    if (body.fulfillmentType !== FulfillmentType.DELIVERY) return;

    if (body.customer.address.trim().length < 3) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["customer", "address"], message: "Endereco obrigatorio" });
    }
    if (!body.customer.number.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["customer", "number"], message: "Numero obrigatorio" });
    }
    if (body.customer.district.trim().length < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["customer", "district"], message: "Bairro obrigatorio" });
    }
  });

function toDecimal(value: number) {
  return new Prisma.Decimal(value.toFixed(2));
}

function parseTimeToMinutes(value: string) {
  if (!value) return 0;
  const [h, m] = value.split(":").map((part) => Number(part));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function isStoreOpen(openTime: string | null | undefined, closeTime: string | null | undefined, now = new Date()) {
  const safeOpen = openTime || "00:00";
  const safeClose = closeTime || "23:59";
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const openMinutes = parseTimeToMinutes(safeOpen);
  const closeMinutes = parseTimeToMinutes(safeClose);

  if (openMinutes <= closeMinutes) {
    return nowMinutes >= openMinutes && nowMinutes <= closeMinutes;
  }

  return nowMinutes >= openMinutes || nowMinutes <= closeMinutes;
}

export async function createOrder(req: Request, res: Response) {
  const body = checkoutSchema.parse(req.body);

  const settings = await prisma.setting.findFirstOrThrow({
    where: companyWhere(req),
    include: { deliveryFeeTiers: true }
  });

  if (settings.ordersPaused) {
    return res.status(400).json({
      message: settings.ordersPausedReason || "A loja pausou temporariamente o recebimento de pedidos"
    });
  }

  if (body.paymentMethod === PaymentMethod.MERCADO_PAGO) {
    const company = await prisma.company.findUnique({
      where: { id: getCompanyId(req) },
      select: {
        mercadoPagoEnabled: true,
        mercadoPagoPublicKey: true,
        mercadoPagoAccessToken: true
      }
    });
    if (!company?.mercadoPagoEnabled || !company.mercadoPagoPublicKey || !company.mercadoPagoAccessToken) {
      return res.status(400).json({ message: "Mercado Pago nao configurado para esta loja" });
    }
  }

  if (!isStoreOpen(settings.openTime ?? "00:00", settings.closeTime ?? "23:59")) {
    return res.status(400).json({
      message: `Loja fechada no momento. Funcionamento: ${settings.openTime} ate ${settings.closeTime}`
    });
  }

  const productIds = [...new Set(body.items.map((item) => item.productId))];
  const products = await prisma.product.findMany({
    where: { ...companyWhere(req), id: { in: productIds }, active: true, available: true },
    include: {
      complements: {
        include: { complement: true },
        orderBy: { sortOrder: "asc" }
      }
    }
  });

  if (products.length !== productIds.length) {
    return res.status(400).json({ message: "Um ou mais produtos estao indisponiveis" });
  }

  const preparedItems = body.items.map((item) => {
    const product = products.find((candidate) => candidate.id === item.productId)!;
    const selectedById = new Map(item.complements.map((selected) => [selected.complementId, selected.quantity]));
    const availableLinks = product.complements.filter((link) => link.complement.active);

    for (const required of availableLinks.filter((link) => link.required)) {
      if (!selectedById.has(required.complementId)) {
        throw new z.ZodError([{
          code: z.ZodIssueCode.custom,
          path: ["items", item.productId, "complements"],
          message: `O complemento ${required.complement.name} e obrigatorio para ${product.name}`
        }]);
      }
    }

    const selectedComplements = item.complements.map((selected) => {
      const link = availableLinks.find((candidate) => candidate.complementId === selected.complementId);
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
    const complementsPerUnit = selectedComplements.reduce(
      (sum, complement) => sum + complement.price * complement.quantity,
      0
    );

    return {
      ...item,
      product,
      basePrice,
      selectedComplements,
      total: (basePrice + complementsPerUnit) * item.quantity
    };
  });

  const subtotalNumber = preparedItems.reduce((acc, item) => acc + item.total, 0);

  const pickup = body.fulfillmentType === FulfillmentType.PICKUP;
  const {
    latitude: _latitude,
    longitude: _longitude,
    ...customerData
  } = body.customer;
  const phone = normalizePhone(body.customer.phone);
  const email = normalizeEmail((body.customer as any).email);
  const linkedCustomer = await linkCustomerToCompany({
    companyId: getCompanyId(req),
    name: body.customer.name,
    phone,
    email
  });
  const customer = await prisma.customer.upsert({
    where: {
      companyId_phone: {
        companyId: getCompanyId(req),
        phone
      }
    },
    create: {
      companyId: getCompanyId(req),
      globalCustomerId: linkedCustomer.globalCustomer.id,
      companyCustomerId: linkedCustomer.companyCustomer.id,
      ...customerData,
      phone,
      email,
      address: pickup ? "Retirada na loja" : body.customer.address,
      number: pickup ? "S/N" : body.customer.number,
      district: pickup ? "Retirada" : body.customer.district
    },
    update: pickup
      ? {
          name: body.customer.name,
          globalCustomerId: linkedCustomer.globalCustomer.id,
          companyCustomerId: linkedCustomer.companyCustomer.id,
          deletedAt: null,
          deletedBy: null,
          deletionReason: null
        }
      : {
          ...customerData,
          phone,
          email,
          globalCustomerId: linkedCustomer.globalCustomer.id,
          companyCustomerId: linkedCustomer.companyCustomer.id,
          deletedAt: null,
          deletedBy: null,
          deletionReason: null
        }
  });

  let discountNumber = 0;
  let normalizedCouponCode: string | undefined;
  let couponIdUsed: string | null = null;
  if (body.couponCode) {
    const code = body.couponCode.trim().toUpperCase();
    normalizedCouponCode = code;
    const coupon = await prisma.coupon.findFirst({ where: { code, ...companyWhere(req) } });

    if (!coupon || !coupon.active) {
      return res.status(400).json({ message: "Cupom invalido" });
    }

    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
      return res.status(400).json({ message: "Cupom expirado" });
    }

    if (coupon.minOrder && subtotalNumber < Number(coupon.minOrder)) {
      return res.status(400).json({
        message: `Pedido minimo para este cupom: R$ ${Number(coupon.minOrder).toFixed(2)}`
      });
    }

    const totalUses = await prisma.couponRedemption.count({
      where: { couponId: coupon.id, ...companyWhere(req) }
    });
    if (coupon.maxUses && totalUses >= coupon.maxUses) {
      return res.status(400).json({ message: "Cupom atingiu o limite total de uso" });
    }

    const customerUses = await prisma.couponRedemption.count({
      where: { couponId: coupon.id, customerId: customer.id, ...companyWhere(req) }
    });
    if (coupon.maxUsesPerCustomer && customerUses >= coupon.maxUsesPerCustomer) {
      return res.status(400).json({ message: "Voce atingiu o limite deste cupom" });
    }

    const startDay = new Date();
    startDay.setHours(0, 0, 0, 0);
    const endDay = new Date();
    endDay.setHours(23, 59, 59, 999);

    const usesToday = await prisma.couponRedemption.count({
      where: {
        couponId: coupon.id,
        ...companyWhere(req),
        customerId: customer.id,
        usedAt: { gte: startDay, lte: endDay }
      }
    });
    if (coupon.maxUsesPerDay && usesToday >= coupon.maxUsesPerDay) {
      return res.status(400).json({ message: "Limite diario deste cupom atingido" });
    }

    discountNumber =
      coupon.type === "PERCENT"
        ? subtotalNumber * (Number(coupon.value) / 100)
        : Number(coupon.value);
    couponIdUsed = coupon.id;
  }

  const subtotal = toDecimal(subtotalNumber);
  const deliveryQuote =
    body.fulfillmentType === FulfillmentType.PICKUP
      ? { fee: 0, distanceKm: null, requiresLocation: false }
      : calculateDeliveryFee(
          settings,
          body.customer.latitude !== undefined && body.customer.longitude !== undefined
            ? {
                latitude: body.customer.latitude,
                longitude: body.customer.longitude
              }
            : undefined
        );

  if (deliveryQuote.requiresLocation) {
    return res.status(400).json({
      message: "Confirme sua localizacao no mapa para calcular o frete"
    });
  }
  if (deliveryQuote.fee === null) {
    return res.status(400).json({
      message: "Seu endereco esta fora da area de entrega",
      distanceKm: Number(deliveryQuote.distanceKm?.toFixed(2))
    });
  }

  const deliveryFee = toDecimal(deliveryQuote.fee);
  const discount = toDecimal(Math.min(discountNumber, subtotalNumber));
  const totalNumber = subtotalNumber + Number(deliveryFee) - Number(discount);
  const total = toDecimal(totalNumber);

  const order = await prisma.order.create({
    data: {
      companyId: getCompanyId(req),
      customerId: customer.id,
      paymentMethod: body.paymentMethod,
      fulfillmentType: body.fulfillmentType,
      changeFor: body.changeFor ? toDecimal(body.changeFor) : null,
      subtotal,
      deliveryFee,
      deliveryLatitude: pickup ? null : body.customer.latitude,
      deliveryLongitude: pickup ? null : body.customer.longitude,
      deliveryDistanceKm: pickup ? null : deliveryQuote.distanceKm,
      discount,
      total,
      couponCode: normalizedCouponCode,
      customerNotes: body.notes,
      items: {
        create: preparedItems.map((item) => ({
          companyId: getCompanyId(req),
          productId: item.productId,
          quantity: item.quantity,
          price: toDecimal(item.basePrice),
          total: toDecimal(item.total),
          complements: {
            create: item.selectedComplements.map((complement) => ({
              companyId: getCompanyId(req),
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
      items: { include: { product: true, complements: true } }
    }
  });

  await recordCompanyCustomerPurchase({
    companyCustomerId: linkedCustomer.companyCustomer.id,
    orderTotal: total,
    orderDate: order.createdAt
  });

  if (couponIdUsed) {
    await prisma.couponRedemption.create({
      data: {
        companyId: getCompanyId(req),
        couponId: couponIdUsed,
        customerId: customer.id,
        orderId: order.id
      }
    });
  }

  if (body.paymentMethod === PaymentMethod.MERCADO_PAGO) {
    return res.status(201).json({
      orderId: order.id,
      whatsappUrl: null,
      sentByServer: false,
      sendError: null,
      printError: null,
      message: "Pedido aguardando confirmacao do Mercado Pago",
      total: order.total,
      paymentPending: true
    });
  }

  const whatsapp = buildWhatsappMessage(order, settings);
  const sent = await dispatchWhatsappMessage(
    settings,
    settings.whatsappNumber,
    whatsapp.message,
    settings.whatsappNumber
  );

  const updatedOrder = await prisma.order.update({
    where: { id: order.id },
    data: { whatsappLink: sent.whatsappUrl ?? whatsapp.url }
  });

  let printError: string | null = null;
  if (settings.printerEnabled && settings.printerAutoPrint) {
    try {
      await printOrder(order, settings);
    } catch (error) {
      printError = error instanceof Error ? error.message : "Falha na impressao automatica";
    }
  }

  publishNewOrder({
    companyId: getCompanyId(req),
    orderId: updatedOrder.id,
    customer: order.customer.name,
    total: Number(updatedOrder.total)
  });

  return res.status(201).json({
    orderId: updatedOrder.id,
    whatsappUrl: sent.whatsappUrl ?? null,
    sentByServer: sent.channel === "MENUAI",
    sendError: sent.ok ? null : (sent.error ?? "Falha ao enviar via Menuia"),
    printError,
    message: whatsapp.message,
    total: updatedOrder.total
  });
}

export async function listOrders(req: Request, res: Response) {
  const requestedStatus = req.query.status?.toString();
  const status = requestedStatus && Object.values(OrderStatus).includes(requestedStatus as OrderStatus)
    ? requestedStatus as OrderStatus
    : undefined;
  const customer = req.query.customer?.toString();
  const phone = req.query.phone?.toString();
  const dateFrom = req.query.dateFrom?.toString();
  const dateTo = req.query.dateTo?.toString();
  const includeFinished = req.query.includeFinished === "true";

  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const defaultEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const startDate = dateFrom ? new Date(`${dateFrom}T00:00:00-03:00`) : defaultStart;
  const endDate = dateTo ? new Date(`${dateTo}T23:59:59.999-03:00`) : defaultEnd;

  const orders = await prisma.order.findMany({
    where: {
      ...companyWhere(req),
      deletedAt: null,
      status: status ?? (includeFinished ? undefined : { not: "FINISHED" }),
      createdAt: {
        gte: startDate,
        lte: endDate
      },
      customer: {
        ...(customer ? { name: { contains: customer } } : {}),
        ...(phone ? { phone: { contains: phone } } : {})
      }
    },
    include: { customer: true, items: { include: { product: true, complements: true } } },
    orderBy: { createdAt: "desc" }
  });

  return res.json(orders);
}

export async function updateOrderStatus(req: Request, res: Response) {
  const schema = z.object({ status: z.nativeEnum(OrderStatus) });
  const body = schema.parse(req.body);

  const current = await prisma.order.findFirst({
    where: { id: req.params.id, ...companyWhere(req) },
    include: { customer: true }
  });

  if (!current) {
    return res.status(404).json({ message: "Pedido nao encontrado" });
  }

  if (current.status === "FINISHED" && body.status !== "FINISHED") {
    return res.status(400).json({ message: "Pedido finalizado nao pode ser alterado" });
  }

  if (current.fulfillmentType === "PICKUP" && body.status === "OUT_FOR_DELIVERY") {
    return res.status(400).json({ message: "Pedido para retirada nao pode sair para entrega" });
  }

  const order = await prisma.order.update({
    where: { id: req.params.id },
    data: { status: body.status }
  });
  await audit(req, {
    action: body.status === "CANCELED" ? "ORDER_CANCELED" : "ORDER_STATUS_CHANGED",
    entity: "Order",
    entityId: current.id,
    oldValue: { status: current.status },
    newValue: { status: body.status }
  });

  if (body.status === "CANCELED" && current.paidAt) {
    const session = await prisma.cashSession.findFirst({ where: { ...companyWhere(req), closedAt: null } });
    if (session) {
      await prisma.cashEntry.create({
        data: {
          companyId: getCompanyId(req),
          sessionId: session.id,
          type: "EXPENSE",
          amount: toDecimal(Number(current.total)),
          orderId: current.id,
          description: `Estorno por cancelamento do pedido #${formatOrderCode(current.orderNumber)}`
        }
      });
    }
  }

  const settings = await prisma.setting.findFirst({ where: companyWhere(req) });
  const statusWhatsapp =
    settings && shouldSendStatusWhatsapp(settings, body.status)
      ? buildOrderStatusWhatsappMessage(current.customer.phone, current.customer.name, body.status, settings)
      : null;

  let statusSendResult: { ok: boolean; whatsappUrl?: string; error?: string } | null = null;
  if (settings && statusWhatsapp) {
    statusSendResult = await dispatchWhatsappMessage(settings, current.customer.phone, statusWhatsapp.message, current.customer.phone);
  }

  return res.json({
    ...order,
    statusWhatsappUrl: statusSendResult?.whatsappUrl ?? null,
    statusWhatsappSent: statusSendResult?.ok ?? false,
    statusWhatsappError: statusSendResult?.ok ? null : (statusSendResult?.error ?? null),
    statusWhatsappMessage: statusWhatsapp?.message ?? null
  });
}

export async function markOrderViewed(req: Request, res: Response) {
  const existing = await prisma.order.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ message: "Pedido nao encontrado" });
  const order = await prisma.order.update({
    where: { id: existing.id },
    data: { viewedByStaff: true }
  });

  return res.json(order);
}

export async function sendToDelivery(req: Request, res: Response) {
  const settings = await prisma.setting.findFirstOrThrow({ where: companyWhere(req) });
  
  if (!settings.deliveryPhoneNumber) {
    return res.status(400).json({ message: "Numero do motoboy nao configurado" });
  }

  const order = await prisma.order.findFirst({
    where: { id: req.params.id, ...companyWhere(req) },
    include: { customer: true, items: { include: { product: true, complements: true } } }
  });

  if (!order) {
    return res.status(404).json({ message: "Pedido nao encontrado" });
  }

  if (order.fulfillmentType === "PICKUP") {
    return res.status(400).json({ message: "Este pedido e para retirada na loja" });
  }

  // Criar link do Google Maps
  const address = `${order.customer.address}, ${order.customer.number} - ${order.customer.district}`;
  const mapQuery =
    order.deliveryLatitude !== null && order.deliveryLongitude !== null
      ? `${order.deliveryLatitude},${order.deliveryLongitude}`
      : address;
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`;

  // Criar mensagem para o motoboy
  const items = order.items.map((item) => {
    const complements = item.complements
      .map((complement) => `  + ${complement.quantity}x ${complement.name}`)
      .join("\n");
    return `${item.quantity}x ${item.product.name}${complements ? `\n${complements}` : ""}`;
  }).join('\n');
  
  const message = `🛵 *NOVO PEDIDO PARA ENTREGA*\n\n` +
    `📋 *Pedido:* #${formatOrderCode(order.orderNumber)}\n` +
    `👤 *Cliente:* ${order.customer.name}\n` +
    `📱 *Telefone:* ${order.customer.phone}\n\n` +
    `📦 *Itens:*\n${items}\n\n` +
    `📍 *Endereço:*\n${order.customer.address}, ${order.customer.number}\n` +
    `${order.customer.district}\n` +
    `${order.customer.complement ? `Complemento: ${order.customer.complement}\n` : ''}` +
    `${order.deliveryDistanceKm ? `Distancia aproximada: ${order.deliveryDistanceKm.toFixed(2)} km\n` : ""}` +
    `\n💰 *Total:* R$ ${Number(order.total).toFixed(2)}\n` +
    `💳 *Pagamento:* ${order.paymentMethod === 'CASH' ? 'Dinheiro' : order.paymentMethod === 'PIX' ? 'PIX' : order.paymentMethod === 'MERCADO_PAGO' ? 'Mercado Pago' : 'Cartão'}\n` +
    `${order.changeFor ? `💵 *Troco para:* R$ ${Number(order.changeFor).toFixed(2)}\n` : ''}` +
    `\n📍 *Clique para abrir no Google Maps:*\n${googleMapsUrl}`;

  const deliverySend = await dispatchWhatsappMessage(
    settings,
    settings.deliveryPhoneNumber,
    message,
    settings.deliveryPhoneNumber
  );

  if (settings.menuiaEnabled && !deliverySend.ok) {
    return res.status(400).json({ message: deliverySend.error ?? "Falha ao enviar para motoboy via Menuia" });
  }

  // Atualizar pedido
  await prisma.order.update({
    where: { id: order.id },
    data: { 
      sentToDelivery: true,
      deliverySentAt: new Date()
    }
  });

  return res.json({ whatsappUrl: deliverySend.whatsappUrl ?? null, message, sentByServer: deliverySend.channel === "MENUAI" });
}

export async function deleteOrder(req: Request, res: Response) {
  const order = await prisma.order.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });

  if (!order) {
    return res.status(404).json({ message: "Pedido nao encontrado" });
  }

  if (order.status !== "FINISHED" && order.status !== "CANCELED") {
    return res.status(400).json({ message: "Apague somente pedidos finalizados ou cancelados" });
  }

  const reason = z.object({ reason: z.string().min(5).max(300) }).parse(req.body).reason;
  await prisma.$transaction(async (transaction) => {
    await transaction.order.update({
      where: { id: order.id },
      data: { deletedAt: new Date(), deletedBy: req.user!.sub, deletionReason: reason }
    });
    await audit(req, {
      action: "ORDER_SOFT_DELETED", entity: "Order", entityId: order.id,
      oldValue: { status: order.status, total: Number(order.total) }, newValue: { reason }
    }, transaction);
  });
  return res.status(204).send();
}

export async function markOrderPaid(req: Request, res: Response) {
  const schema = z.object({
    method: z.enum(["CASH", "PIX", "DEBIT", "CREDIT"])
  });

  const body = schema.parse(req.body);
  const order = await prisma.order.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });

  if (!order) {
    return res.status(404).json({ message: "Pedido nao encontrado" });
  }

  if (order.status === "CANCELED") {
    return res.status(400).json({ message: "Pedido cancelado nao pode ser pago" });
  }

  if (order.paidAt) {
    return res.status(400).json({ message: "Pedido ja foi marcado como pago" });
  }

  const session = await prisma.cashSession.findFirst({
    where: {
      ...companyWhere(req),
      openedBy: req.user!.sub,
      closedAt: null,
      deletedAt: null,
      locked: false
    }
  });
  if (!session) {
    return res.status(400).json({ message: "Abra seu caixa antes de registrar uma venda" });
  }

  const paymentMethod: PaymentMethod = body.method === "PIX" ? "PIX" : body.method === "CASH" ? "CASH" : "CARD";
  const paymentDetail =
    body.method === "DEBIT"
      ? "Cartao Debito"
      : body.method === "CREDIT"
        ? "Cartao Credito"
        : body.method === "PIX"
          ? "PIX"
          : "Dinheiro";

  const updated = await prisma.order.update({
    where: { id: req.params.id },
    data: {
      paymentMethod,
      paidAt: new Date(),
      paidMethodDetail: paymentDetail,
      notes: [order.notes, `[PAGO: ${paymentDetail} em ${new Date().toLocaleString("pt-BR")}]`]
        .filter(Boolean)
        .join(" "),
      status: order.status === "RECEIVED" ? "PREPARING" : order.status
    }
  });

  await recordCashPayments(session.id, getCompanyId(req), [{
        amount: toDecimal(Number(updated.total)),
        paymentMethod,
        paymentDetail,
        orderId: updated.id,
        description: `Pagamento pedido #${formatOrderCode(updated.orderNumber)} via ${paymentDetail}`
  }]);
  await audit(req, {
    action: "ORDER_PAID", entity: "Order", entityId: updated.id,
    oldValue: { paidAt: order.paidAt }, newValue: { paidAt: updated.paidAt, paymentDetail }
  });

  const orderWithCustomer = await prisma.order.findFirst({
    where: { id: req.params.id, ...companyWhere(req) },
    include: { customer: true }
  });
  const settings = await prisma.setting.findFirst({ where: companyWhere(req) });
  const paymentWhatsapp =
    settings && settings.menuiaEnabled && settings.whatsappOnPaymentConfirmed && orderWithCustomer
      ? buildOrderStatusWhatsappMessage(
          orderWithCustomer.customer.phone,
          orderWithCustomer.customer.name,
          "PAYMENT_CONFIRMED",
          settings
        )
      : null;

  let paymentSendResult: { ok: boolean; whatsappUrl?: string; error?: string } | null = null;
  if (settings && paymentWhatsapp && orderWithCustomer) {
    paymentSendResult = await dispatchWhatsappMessage(
      settings,
      orderWithCustomer.customer.phone,
      paymentWhatsapp.message,
      orderWithCustomer.customer.phone
    );
  }

  return res.json({
    ...updated,
    paid: true,
    paymentDetail,
    paymentWhatsappUrl: paymentSendResult?.whatsappUrl ?? null,
    paymentWhatsappSent: paymentSendResult?.ok ?? false,
    paymentWhatsappError: paymentSendResult?.ok ? null : (paymentSendResult?.error ?? null)
  });
}

export async function printOrderById(req: Request, res: Response) {
  const [settings, order] = await Promise.all([
    prisma.setting.findFirstOrThrow({ where: companyWhere(req) }),
    prisma.order.findFirst({
      where: { id: req.params.id, ...companyWhere(req) },
      include: { customer: true, items: { include: { product: true, complements: true } } }
    })
  ]);

  if (!order) {
    return res.status(404).json({ message: "Pedido nao encontrado" });
  }

  try {
    await printOrder(order, settings);
    return res.json({
      ok: true,
      message: `Pedido #${formatOrderCode(order.orderNumber)} enviado para impressao`
    });
  } catch (error) {
    return res.status(400).json({
      message: error instanceof Error ? error.message : "Falha ao imprimir pedido"
    });
  }
}

export async function getOrderPrintData(req: Request, res: Response) {
  const [settings, order] = await Promise.all([
    prisma.setting.findFirstOrThrow({ where: companyWhere(req) }),
    prisma.order.findFirst({
      where: { id: req.params.id, ...companyWhere(req) },
      include: { customer: true, items: { include: { product: true, complements: true } } }
    })
  ]);
  if (!order) return res.status(404).json({ message: "Pedido nao encontrado" });
  return res.json({
    order,
    print: {
      companyName: settings.companyName,
      printerName: settings.printerName,
      paperWidth: settings.printerPaperWidth === 80 ? 80 : 58,
      enabled: settings.printerEnabled,
      autoPrint: settings.printerAutoPrint
    }
  });
}
