import { DeliveryRouteStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  repeatDriverRouteOfferPush,
  sendDriverPush
} from "../services/expo-push.js";
import {
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsNavigationUrl,
  type RouteOrigin
} from "../utils/google-maps-route.js";
import { prisma } from "../utils/prisma.js";
import { expirePendingRouteOffers, routeOfferExpiresAt } from "../utils/route-offers.js";
import { companyWhere, getCompanyId } from "../utils/tenant.js";
import { optimizeRoute } from "../utils/route-optimizer.js";
import { isOrderEligibleForDeliveryRoute } from "../utils/delivery-order.js";

const optionalText = z.preprocess(
  (value) => typeof value === "string" && !value.trim() ? null : value,
  z.string().trim().nullable().optional()
);

const driverSchema = z.object({
  name: z.string().trim().min(2),
  phone: z.string().trim().min(8),
  whatsapp: z.string().trim().min(8),
  vehicle: z.string().trim().min(2),
  licensePlate: optionalText,
  password: z.string().min(6).optional(),
  active: z.boolean().default(true)
});
const createDriverSchema = driverSchema.extend({
  password: z.string().min(6, "A senha deve ter pelo menos 6 caracteres")
});
const driverSelect = {
  id: true,
  companyId: true,
  name: true,
  phone: true,
  whatsapp: true,
  vehicle: true,
  licensePlate: true,
  active: true,
  available: true,
  lastLatitude: true,
  lastLongitude: true,
  lastLocationAt: true,
  createdAt: true,
  updatedAt: true
};

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function addressOf(order: {
  customer: { address: string; number: string; district: string; complement: string | null };
}) {
  return [
    `${order.customer.address}, ${order.customer.number}`,
    order.customer.district,
    order.customer.complement
  ].filter(Boolean).join(" - ");
}

const routeInclude = {
  driver: { select: driverSelect },
  orders: {
    orderBy: { sequence: "asc" as const },
    include: { order: { include: { customer: true } } }
  }
};

export async function listDrivers(req: Request, res: Response) {
  return res.json(await prisma.driver.findMany({
    where: companyWhere(req),
    select: driverSelect,
    orderBy: [{ active: "desc" }, { name: "asc" }]
  }));
}

export async function createDriver(req: Request, res: Response) {
  const body = createDriverSchema.parse(req.body);
  const driver = await prisma.driver.create({
    data: {
      companyId: getCompanyId(req),
      name: body.name,
      phone: digits(body.phone),
      whatsapp: digits(body.whatsapp),
      vehicle: body.vehicle,
      licensePlate: body.licensePlate?.toUpperCase() ?? null,
      passwordHash: await bcrypt.hash(body.password, 10),
      active: body.active
    },
    select: driverSelect
  });
  return res.status(201).json(driver);
}

export async function updateDriver(req: Request, res: Response) {
  const current = await prisma.driver.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!current) return res.status(404).json({ message: "Motoboy nao encontrado" });
  const body = driverSchema.partial().parse(req.body);
  const { password, ...driverData } = body;
  return res.json(await prisma.driver.update({
    where: { id: current.id },
    data: {
      ...driverData,
      ...(body.phone ? { phone: digits(body.phone) } : {}),
      ...(body.whatsapp ? { whatsapp: digits(body.whatsapp) } : {}),
      ...(body.licensePlate !== undefined ? { licensePlate: body.licensePlate?.toUpperCase() ?? null } : {}),
      ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {})
    },
    select: driverSelect
  }));
}

export async function listReadyDeliveryOrders(req: Request, res: Response) {
  await expirePendingRouteOffers(getCompanyId(req));
  const orders = await prisma.order.findMany({
    where: {
      ...companyWhere(req),
      fulfillmentType: "DELIVERY",
      status: "PREPARING",
      deliveryRouteOrders: {
        none: { route: { status: { in: ["CREATED", "IN_PROGRESS"] } } }
      }
    },
    include: { customer: true },
    orderBy: { createdAt: "asc" }
  });
  return res.json(orders);
}

export async function listDeliveryRoutes(req: Request, res: Response) {
  await expirePendingRouteOffers(getCompanyId(req));
  return res.json(await prisma.deliveryRoute.findMany({
    where: companyWhere(req),
    include: routeInclude,
    orderBy: { createdAt: "desc" },
    take: 100
  }));
}

export async function getDeliveryRoute(req: Request, res: Response) {
  const route = await prisma.deliveryRoute.findFirst({
    where: { id: req.params.id, ...companyWhere(req) },
    include: routeInclude
  });
  if (!route) return res.status(404).json({ message: "Rota nao encontrada" });
  return res.json(route);
}

export async function createDeliveryRoute(req: Request, res: Response) {
  const body = z.object({
    driverId: z.string().min(1),
    orderIds: z.array(z.string().min(1)).min(1).max(20)
  }).parse(req.body);
  const orderIds = [...new Set(body.orderIds)];
  const companyId = getCompanyId(req);

  const [driver, orders, settings, company] = await Promise.all([
    prisma.driver.findFirst({ where: { id: body.driverId, companyId, active: true, available: true } }),
    prisma.order.findMany({
      where: { id: { in: orderIds }, companyId },
      include: {
        customer: true,
        deliveryRouteOrders: {
          where: { route: { status: { in: ["CREATED", "IN_PROGRESS"] } } },
          select: { id: true }
        }
      }
    }),
    prisma.setting.findFirst({ where: { companyId } }),
    prisma.company.findUnique({ where: { id: companyId }, select: { address: true } })
  ]);

  if (!driver) return res.status(404).json({ message: "Motoboy ativo nao encontrado" });
  if (orders.length !== orderIds.length) return res.status(400).json({ message: "Um ou mais pedidos nao pertencem a esta empresa" });
  const invalid = orders.find((order) =>
    !isOrderEligibleForDeliveryRoute({
      fulfillmentType: order.fulfillmentType,
      status: order.status,
      activeRouteCount: order.deliveryRouteOrders.length
    })
  );
  if (invalid) {
    return res.status(400).json({
      message: `Pedido #${String(invalid.orderNumber).padStart(5, "0")} nao esta disponivel para uma nova rota`
    });
  }

  const orderedStops = optimizeRoute(
    orders.map((order) => ({
      id: order.id,
      latitude: order.deliveryLatitude,
      longitude: order.deliveryLongitude
    })),
    settings?.storeLatitude !== null && settings?.storeLatitude !== undefined
      && settings?.storeLongitude !== null && settings?.storeLongitude !== undefined
      ? { latitude: settings.storeLatitude, longitude: settings.storeLongitude }
      : null
  ).map((stop) => {
    const order = orders.find((candidate) => candidate.id === stop.id)!;
    return {
      order,
      address: addressOf(order),
      latitude: order.deliveryLatitude,
      longitude: order.deliveryLongitude
    };
  });

  const origin: RouteOrigin | null = settings?.storeLatitude !== null && settings?.storeLatitude !== undefined
    && settings?.storeLongitude !== null && settings?.storeLongitude !== undefined
    ? { latitude: settings.storeLatitude, longitude: settings.storeLongitude }
    : company?.address?.trim()
      ? { address: company.address }
      : null;
  if (!origin) {
    return res.status(400).json({
      message: "Configure as coordenadas da loja ou o endereco da empresa antes de criar a rota"
    });
  }
  const mapsUrl = buildGoogleMapsDirectionsUrl(orderedStops, origin);
  const navigationUrl = buildGoogleMapsNavigationUrl(orderedStops);
  const lines = orderedStops.map(({ order, address }, index) =>
    `${index + 1}. Pedido #${String(order.orderNumber).padStart(5, "0")} - ${order.customer.name} - ${address}`
  );
  const message = `Nova rota de entrega:\n\n${lines.join("\n")}\n\nIniciar navegacao: ${navigationUrl}`;

  const route = await prisma.$transaction(async (transaction) => {
    const created = await transaction.deliveryRoute.create({
      data: {
        companyId,
        driverId: driver.id,
        googleMapsUrl: mapsUrl,
        whatsappMessage: message,
        offerExpiresAt: routeOfferExpiresAt(),
        orders: {
          create: orderedStops.map((stop, index) => ({
            companyId,
            orderId: stop.order.id,
            sequence: index + 1,
            address: stop.address,
            latitude: stop.latitude,
            longitude: stop.longitude
          }))
        }
      },
      include: routeInclude
    });
    return created;
  });

  const pushMessage = {
    driverId: driver.id,
    companyId,
    title: "Nova rota de entrega",
    body: `Voce recebeu uma nova rota com ${orderedStops.length} pedido(s). Responda em 30 segundos.`,
    data: { routeId: route.id, screen: "route" },
    categoryId: "route-offer"
  };
  const push = await sendDriverPush(pushMessage).catch((error) => ({
    sent: 0,
    errors: [error instanceof Error ? error.message : "Falha ao enviar notificacao push"]
  }));
  repeatDriverRouteOfferPush(route.id, pushMessage, route.offerExpiresAt!);

  return res.status(201).json({
    ...route,
    navigationUrl,
    push,
    whatsappUrl: `https://wa.me/${driver.whatsapp}?text=${encodeURIComponent(message)}`
  });
}

export async function updateDeliveryRouteStatus(req: Request, res: Response) {
  const body = z.object({ status: z.nativeEnum(DeliveryRouteStatus) }).parse(req.body);
  const route = await prisma.deliveryRoute.findFirst({
    where: { id: req.params.id, ...companyWhere(req) },
    include: { orders: { select: { orderId: true } } }
  });
  if (!route) return res.status(404).json({ message: "Rota nao encontrada" });
  if (route.status === "COMPLETED" || route.status === "CANCELED") {
    return res.status(400).json({ message: "Esta rota ja foi encerrada" });
  }
  const allowedTransitions: Record<DeliveryRouteStatus, DeliveryRouteStatus[]> = {
    CREATED: ["IN_PROGRESS", "COMPLETED", "CANCELED"],
    IN_PROGRESS: ["COMPLETED", "CANCELED"],
    COMPLETED: [],
    CANCELED: []
  };
  if (!allowedTransitions[route.status].includes(body.status)) {
    return res.status(400).json({ message: "Transicao de status invalida para esta rota" });
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (transaction) => {
    if (body.status === "IN_PROGRESS") {
      await transaction.order.updateMany({
        where: { id: { in: route.orders.map((item) => item.orderId) }, companyId: getCompanyId(req) },
        data: { status: "OUT_FOR_DELIVERY", sentToDelivery: true, deliverySentAt: now }
      });
    }
    if (body.status === "COMPLETED") {
      await transaction.order.updateMany({
        where: { id: { in: route.orders.map((item) => item.orderId) }, companyId: getCompanyId(req) },
        data: { status: "DELIVERED" }
      });
    }
    if (body.status === "CANCELED") {
      await transaction.order.updateMany({
        where: {
          id: { in: route.orders.map((item) => item.orderId) },
          companyId: getCompanyId(req),
          status: "OUT_FOR_DELIVERY"
        },
        data: { status: "PREPARING", sentToDelivery: false, deliverySentAt: null }
      });
    }
    return transaction.deliveryRoute.update({
      where: { id: route.id },
      data: {
        status: body.status,
        ...(body.status === "IN_PROGRESS" ? { startedAt: now, acceptedAt: now } : {}),
        ...(body.status === "COMPLETED" ? { completedAt: now } : {}),
        ...(body.status === "CANCELED" ? { canceledAt: now } : {})
      },
      include: routeInclude
    });
  });
  return res.json(updated);
}
