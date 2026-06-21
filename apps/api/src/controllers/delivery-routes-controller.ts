import { DeliveryRouteStatus } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { companyWhere, getCompanyId } from "../utils/tenant.js";
import { optimizeRoute } from "../utils/route-optimizer.js";

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
  active: z.boolean().default(true)
});

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

function locationOf(stop: { address: string; latitude: number | null; longitude: number | null }) {
  return stop.latitude !== null && stop.longitude !== null
    ? `${stop.latitude},${stop.longitude}`
    : stop.address;
}

function googleMapsUrl(
  stops: Array<{ address: string; latitude: number | null; longitude: number | null }>,
  origin?: { latitude: number; longitude: number } | string | null
) {
  const destination = locationOf(stops[stops.length - 1]);
  const waypoints = stops.slice(0, -1).map(locationOf);
  const params = new URLSearchParams({
    api: "1",
    destination,
    travelmode: "driving"
  });
  if (origin) {
    params.set("origin", typeof origin === "string" ? origin : `${origin.latitude},${origin.longitude}`);
  }
  if (waypoints.length) params.set("waypoints", waypoints.join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

const routeInclude = {
  driver: true,
  orders: {
    orderBy: { sequence: "asc" as const },
    include: { order: { include: { customer: true } } }
  }
};

export async function listDrivers(req: Request, res: Response) {
  return res.json(await prisma.driver.findMany({
    where: companyWhere(req),
    orderBy: [{ active: "desc" }, { name: "asc" }]
  }));
}

export async function createDriver(req: Request, res: Response) {
  const body = driverSchema.parse(req.body);
  const driver = await prisma.driver.create({
    data: {
      ...body,
      companyId: getCompanyId(req),
      phone: digits(body.phone),
      whatsapp: digits(body.whatsapp),
      licensePlate: body.licensePlate?.toUpperCase() ?? null
    }
  });
  return res.status(201).json(driver);
}

export async function updateDriver(req: Request, res: Response) {
  const current = await prisma.driver.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!current) return res.status(404).json({ message: "Motoboy nao encontrado" });
  const body = driverSchema.partial().parse(req.body);
  return res.json(await prisma.driver.update({
    where: { id: current.id },
    data: {
      ...body,
      ...(body.phone ? { phone: digits(body.phone) } : {}),
      ...(body.whatsapp ? { whatsapp: digits(body.whatsapp) } : {}),
      ...(body.licensePlate !== undefined ? { licensePlate: body.licensePlate?.toUpperCase() ?? null } : {})
    }
  }));
}

export async function listReadyDeliveryOrders(req: Request, res: Response) {
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
    prisma.driver.findFirst({ where: { id: body.driverId, companyId, active: true } }),
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
    order.fulfillmentType !== "DELIVERY"
    || order.status !== "PREPARING"
    || order.deliveryRouteOrders.length > 0
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

  const origin = settings?.storeLatitude !== null && settings?.storeLatitude !== undefined
    && settings?.storeLongitude !== null && settings?.storeLongitude !== undefined
    ? { latitude: settings.storeLatitude, longitude: settings.storeLongitude }
    : company?.address ?? null;
  const mapsUrl = googleMapsUrl(orderedStops, origin);
  const lines = orderedStops.map(({ order, address }, index) =>
    `${index + 1}. Pedido #${String(order.orderNumber).padStart(5, "0")} - ${order.customer.name} - ${address}`
  );
  const message = `Nova rota de entrega:\n\n${lines.join("\n")}\n\nAbrir rota: ${mapsUrl}`;

  const route = await prisma.$transaction(async (transaction) => {
    const created = await transaction.deliveryRoute.create({
      data: {
        companyId,
        driverId: driver.id,
        googleMapsUrl: mapsUrl,
        whatsappMessage: message,
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
    await transaction.order.updateMany({
      where: { id: { in: orderIds }, companyId },
      data: {
        status: "OUT_FOR_DELIVERY",
        sentToDelivery: true,
        deliverySentAt: new Date()
      }
    });
    return created;
  });

  return res.status(201).json({
    ...route,
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
        ...(body.status === "IN_PROGRESS" ? { startedAt: now } : {}),
        ...(body.status === "COMPLETED" ? { completedAt: now } : {}),
        ...(body.status === "CANCELED" ? { canceledAt: now } : {})
      },
      include: routeInclude
    });
  });
  return res.json(updated);
}
