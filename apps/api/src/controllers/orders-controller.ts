import type { Request, Response } from "express";
import { ClosedOrderPolicy, FulfillmentType, OrderSource, OrderStatus, PaymentMethod, Prisma, TableSessionStatus } from "@prisma/client";
import { z } from "zod";
import { publishNewOrder } from "../services/realtime.js";
import { printOrder } from "../services/thermal-printer.js";
import { buildOrderStatusWhatsappMessage, buildWhatsappMessage, dispatchWhatsappMessage } from "../services/whatsapp.js";
import { getMercadoPagoPayment, searchMercadoPagoPayments, type MercadoPagoPaymentResponse } from "../services/mercadopago.js";
import { prisma } from "../utils/prisma.js";
import { formatOrderCode } from "../utils/order-code.js";
import { recordCashPayments } from "../utils/cash-register.js";
import { calculateDeliveryFee } from "../utils/delivery-fee.js";
import { companyWhere, getCompanyId } from "../utils/tenant.js";
import { audit } from "../utils/audit.js";
import { linkCustomerToCompany, normalizeEmail, normalizePhone, recordCompanyCustomerPurchase } from "../utils/customer-linking.js";
import { restoreStockFromOrderItems, validateAndDecrementStock } from "../utils/stock.js";
import { getCompanyOpenStatus } from "../services/business-hours.js";

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
      email: z.string().email().optional().or(z.literal("")),
      address: z.string(),
      number: z.string(),
      district: z.string(),
      complement: z.string().optional(),
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional()
    }),
    fulfillmentType: z.nativeEnum(FulfillmentType).default(FulfillmentType.DELIVERY),
    source: z.nativeEnum(OrderSource).default(OrderSource.DELIVERY),
    tableId: z.string().optional(),
    tableSessionToken: z.string().optional(),
    paymentMethod: z.nativeEnum(PaymentMethod),
    scheduledFor: z.coerce.date().optional(),
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
    if ((body.source === OrderSource.TABLE || body.source === OrderSource.TABLE_QR) && !body.tableId && !body.tableSessionToken) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tableId"], message: "Mesa obrigatoria" });
    }

    if (body.fulfillmentType !== FulfillmentType.DELIVERY || body.source === OrderSource.TABLE || body.source === OrderSource.TABLE_QR) return;

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

function chooseApprovedMercadoPagoPayment(payments: MercadoPagoPaymentResponse[]) {
  return payments.find((payment) => payment.status === "approved") ?? null;
}

async function reconcileMercadoPagoPendingOrders(
  orders: Array<{
    id: string;
    paymentMethod: PaymentMethod;
    paidAt: Date | null;
    mercadoPagoStatus: string | null;
    mercadoPagoPaymentId: string | null;
    mercadoPagoPreferenceId: string | null;
    company: { mercadoPagoAccessToken: string | null };
  }>
) {
  const pending = orders.filter((order) =>
    order.paymentMethod === PaymentMethod.MERCADO_PAGO
    && !order.paidAt
    && order.mercadoPagoStatus !== "refunded"
    && order.company.mercadoPagoAccessToken
  );
  if (!pending.length) return;

  await Promise.all(pending.map(async (order) => {
    const accessToken = order.company.mercadoPagoAccessToken;
    if (!accessToken) return;

    let payment: MercadoPagoPaymentResponse | null = null;
    if (order.mercadoPagoPaymentId) {
      payment = await getMercadoPagoPayment(accessToken, order.mercadoPagoPaymentId).catch(() => null);
    }
    if (!payment && order.mercadoPagoPreferenceId) {
      const search = await searchMercadoPagoPayments(accessToken, { externalReference: order.id }).catch(() => null);
      payment = chooseApprovedMercadoPagoPayment(search?.results ?? []);
    }
    if (payment?.status !== "approved") return;

    await prisma.order.update({
      where: { id: order.id },
      data: {
        mercadoPagoPaymentId: String(payment.id),
        mercadoPagoStatus: payment.status,
        mercadoPagoStatusDetail: payment.status_detail ?? null,
        paidAt: new Date(),
        paymentMethod: PaymentMethod.MERCADO_PAGO,
        paidMethodDetail: `Mercado Pago (${payment.payment_type_id ?? payment.payment_method_id ?? "online"})`,
        status: "PREPARING",
        notes: { set: `[PAGO: Mercado Pago em ${new Date().toLocaleString("pt-BR")}]` }
      }
    });
  }));
}

function toDecimal(value: number) {
  return new Prisma.Decimal(value.toFixed(2));
}

export async function createOrder(req: Request, res: Response) {
  const body = checkoutSchema.parse(req.body);
  const companyId = getCompanyId(req);
  const tableOrder = body.source === OrderSource.TABLE || body.source === OrderSource.TABLE_QR;

  const settings = await prisma.setting.findFirstOrThrow({
    where: { companyId },
    include: { deliveryFeeTiers: true }
  });

  if (settings.ordersPaused) {
    return res.status(400).json({
      message: settings.ordersPausedReason || "A loja pausou temporariamente o recebimento de pedidos"
    });
  }

  if (body.paymentMethod === PaymentMethod.MERCADO_PAGO) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
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

  const openStatus = await getCompanyOpenStatus(companyId);
  if (!tableOrder && !openStatus.isOpen) {
    if (settings.closedOrderPolicy === ClosedOrderPolicy.BLOCK_WHEN_CLOSED) {
      return res.status(400).json({
        message: `Esta loja esta fechada no momento. ${openStatus.message}.`,
        openStatus
      });
    }

    if (settings.closedOrderPolicy === ClosedOrderPolicy.SCHEDULE_ONLY_WHEN_CLOSED && !body.scheduledFor) {
      return res.status(400).json({
        message: `Esta loja esta fechada no momento. Agende para o proximo horario disponivel. ${openStatus.message}.`,
        openStatus
      });
    }
  }

  const productIds = [...new Set(body.items.map((item) => item.productId))];
  const products = await prisma.product.findMany({
    where: { companyId, id: { in: productIds }, active: true, available: true },
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
  const tableSession = body.tableSessionToken
    ? await prisma.tableSession.findUnique({
        where: { token: body.tableSessionToken },
        include: { table: { select: { id: true, number: true, name: true, companyId: true, active: true } } }
      })
    : null;
  if (body.source === OrderSource.TABLE_QR) {
    if (!tableSession || tableSession.companyId !== companyId || !tableSession.table.active) {
      return res.status(400).json({ message: "Atendimento de mesa invalido" });
    }
    if (tableSession.status !== TableSessionStatus.OPEN) {
      return res.status(409).json({
        message: tableSession.status === TableSessionStatus.CLOSING_REQUESTED
          ? "A conta ja foi solicitada. Chame o garcom para incluir novos itens."
          : "Atendimento encerrado"
      });
    }
    if (tableSession.expiresAt && tableSession.expiresAt < new Date()) {
      return res.status(409).json({ message: "Atendimento expirado. Chame o garcom." });
    }
  }

  const table = tableSession
    ? tableSession.table
    : body.tableId
    ? await prisma.restaurantTable.findFirst({
        where: { id: body.tableId, companyId, active: true },
        select: { id: true, number: true, name: true }
      })
    : null;
  if (tableOrder && !table) {
    return res.status(400).json({ message: "Mesa invalida para esta loja" });
  }
  const email = normalizeEmail(body.customer.email);
  const linkedCustomer = await linkCustomerToCompany({
    companyId,
    name: body.customer.name,
    phone,
    email
  });
  const customer = await prisma.customer.upsert({
    where: {
      companyId_phone: {
        companyId,
        phone
      }
    },
    create: {
      companyId,
      globalCustomerId: linkedCustomer.globalCustomer.id,
      companyCustomerId: linkedCustomer.companyCustomer.id,
      ...customerData,
      phone,
      email,
      address: pickup || tableOrder ? (tableOrder ? `Mesa ${table?.number}` : "Retirada na loja") : body.customer.address,
      number: pickup || tableOrder ? "S/N" : body.customer.number,
      district: pickup || tableOrder ? (tableOrder ? "Atendimento na mesa" : "Retirada") : body.customer.district
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
    const coupon = await prisma.coupon.findFirst({ where: { code, companyId } });

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
      where: { couponId: coupon.id, companyId }
    });
    if (coupon.maxUses && totalUses >= coupon.maxUses) {
      return res.status(400).json({ message: "Cupom atingiu o limite total de uso" });
    }

    const customerUses = await prisma.couponRedemption.count({
      where: { couponId: coupon.id, customerId: customer.id, companyId }
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
        companyId,
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
    body.fulfillmentType === FulfillmentType.PICKUP || tableOrder
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
        source: body.source,
        tableId: table?.id ?? null,
        tableSessionId: tableSession?.id ?? null,
        waiterId: body.source === OrderSource.WAITER ? req.user?.sub ?? null : null,
        paymentMethod: body.paymentMethod,
        fulfillmentType: tableOrder ? FulfillmentType.PICKUP : body.fulfillmentType,
        scheduledFor: body.scheduledFor ?? null,
        changeFor: body.changeFor ? toDecimal(body.changeFor) : null,
        subtotal,
        deliveryFee,
        deliveryLatitude: pickup || tableOrder ? null : body.customer.latitude,
        deliveryLongitude: pickup || tableOrder ? null : body.customer.longitude,
        deliveryDistanceKm: pickup || tableOrder ? null : deliveryQuote.distanceKm,
        discount,
        total,
        couponCode: normalizedCouponCode,
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
        items: { include: { product: true, complements: true } }
      }
    });
  });

  if (table) {
    await prisma.restaurantTable.update({
      where: { id: table.id },
      data: { status: "OCCUPIED", openedAt: new Date(), closedAt: null }
    });
  }
  if (tableSession) {
    await prisma.tableSession.update({
      where: { id: tableSession.id },
      data: {
        total: { increment: total },
        lastActivityAt: new Date()
      }
    });
  }

  await recordCompanyCustomerPurchase({
    companyCustomerId: linkedCustomer.companyCustomer.id,
    orderTotal: total,
    orderDate: order.createdAt
  });

  if (couponIdUsed) {
    await prisma.couponRedemption.create({
      data: {
        companyId,
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
    companyId,
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

  const where: Prisma.OrderWhereInput = {
    ...companyWhere(req),
    deletedAt: null,
    status: status ?? (includeFinished ? undefined : { not: OrderStatus.FINISHED }),
    createdAt: {
      gte: startDate,
      lte: endDate
    },
    customer: {
      ...(customer ? { name: { contains: customer } } : {}),
      ...(phone ? { phone: { contains: phone } } : {})
    }
  };

  const reconciliationRows = await prisma.order.findMany({
    where: {
      ...where,
      paymentMethod: PaymentMethod.MERCADO_PAGO,
      paidAt: null
    },
    select: {
      id: true,
      paymentMethod: true,
      paidAt: true,
      mercadoPagoStatus: true,
      mercadoPagoPaymentId: true,
      mercadoPagoPreferenceId: true,
      company: { select: { mercadoPagoAccessToken: true } }
    }
  });

  await reconcileMercadoPagoPendingOrders(reconciliationRows);

  const orders = await prisma.order.findMany({
    where,
    include: { customer: true, table: { include: { area: true } }, waiter: { select: { id: true, name: true } }, items: { include: { product: true, complements: true } } },
    orderBy: { createdAt: "desc" }
  });

  return res.json(orders);
}

export async function updateOrderStatus(req: Request, res: Response) {
  const schema = z.object({
    status: z.nativeEnum(OrderStatus),
    reason: z.string().trim().max(240).optional()
  });
  const body = schema.parse(req.body);

  const current = await prisma.order.findFirst({
    where: { id: req.params.id, ...companyWhere(req) },
    include: {
      customer: true,
      items: { include: { complements: true } }
    }
  });

  if (!current) {
    return res.status(404).json({ message: "Pedido nao encontrado" });
  }

  if (current.status === "FINISHED" && body.status !== "FINISHED") {
    return res.status(400).json({ message: "Pedido finalizado nao pode ser alterado" });
  }

  if (current.status === "CANCELED") {
    return res.status(400).json({ message: "Pedido cancelado nao pode ser alterado" });
  }

  if (body.status === "CANCELED" && !body.reason) {
    return res.status(400).json({ message: "Informe o motivo do cancelamento" });
  }

  const order = await prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id: req.params.id },
      data: {
        status: body.status,
        ...(body.status === "CANCELED" && body.reason
          ? { notes: [current.notes, `[CANCELADO: ${body.reason}]`].filter(Boolean).join(" ") }
          : {})
      }
    });

    if (body.status === "CANCELED") {
      await restoreStockFromOrderItems(tx, getCompanyId(req), current.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        complements: item.complements.map((complement) => ({
          complementId: complement.complementId,
          quantity: complement.quantity
        }))
      })));
    }

    await audit(req, {
      action: body.status === "CANCELED" ? "ORDER_CANCELED" : "ORDER_STATUS_CHANGED",
      entity: "Order",
      entityId: current.id,
      oldValue: { status: current.status },
      newValue: {
        status: body.status,
        reason: body.reason ?? null,
        stockRestored: body.status === "CANCELED"
      }
    }, tx);

    return updated;
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
  const shouldNotifyStatus =
    !!settings
    && !(current.fulfillmentType === "PICKUP" && body.status === "OUT_FOR_DELIVERY")
    && shouldSendStatusWhatsapp(settings, body.status);
  const statusWhatsapp =
    settings && shouldNotifyStatus
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
