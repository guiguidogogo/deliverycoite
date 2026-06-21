import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import { z } from "zod";
import { env } from "../utils/env.js";
import { prisma } from "../utils/prisma.js";

const routeInclude = {
  company: { select: { tradeName: true, subdomain: true } },
  orders: {
    orderBy: { sequence: "asc" as const },
    include: {
      order: {
        include: {
          customer: true,
          items: { include: { product: true, complements: true } }
        }
      }
    }
  }
};

function driverContext(req: Request) {
  if (!req.driver) throw new Error("Contexto do motoboy ausente");
  return req.driver;
}

export async function driverLogin(req: Request, res: Response) {
  const body = z.object({
    phone: z.string().min(8),
    password: z.string().min(6),
    subdomain: z.string().trim().min(2).optional()
  }).parse(req.body);
  const phone = body.phone.replace(/\D/g, "");
  const candidates = await prisma.driver.findMany({
    where: {
      phone,
      active: true,
      ...(req.tenant?.bound && req.companyId ? { companyId: req.companyId } : {}),
      company: {
        active: true,
        ...(body.subdomain ? { subdomain: body.subdomain.toLowerCase() } : {})
      }
    },
    include: { company: { select: { id: true, tradeName: true, subdomain: true } } },
    take: 10
  });
  const matches = (await Promise.all(candidates.map(async (driver) => ({
    driver,
    valid: Boolean(driver.passwordHash) && await bcrypt.compare(body.password, driver.passwordHash!)
  })))).filter((candidate) => candidate.valid);

  if (!matches.length) return res.status(401).json({ message: "Credenciais invalidas" });
  if (matches.length > 1 && !body.subdomain) {
    return res.status(409).json({ message: "Informe o subdominio da empresa" });
  }
  const driver = matches[0].driver;
  const token = jwt.sign({
    driverId: driver.id,
    companyId: driver.companyId,
    type: "driver"
  }, env.jwtSecret, { subject: driver.id, expiresIn: "30d" });
  return res.json({
    token,
    driver: {
      id: driver.id,
      name: driver.name,
      phone: driver.phone,
      vehicle: driver.vehicle,
      licensePlate: driver.licensePlate,
      available: driver.available,
      company: driver.company
    }
  });
}

export async function getDriverProfile(req: Request, res: Response) {
  const context = driverContext(req);
  const driver = await prisma.driver.findFirst({
    where: { id: context.id, companyId: context.companyId },
    include: { company: { select: { tradeName: true, subdomain: true } } }
  });
  if (!driver) return res.status(404).json({ message: "Motoboy nao encontrado" });
  const { passwordHash: _passwordHash, ...safeDriver } = driver;
  return res.json(safeDriver);
}

export async function updateDriverAvailability(req: Request, res: Response) {
  const context = driverContext(req);
  const body = z.object({ available: z.boolean() }).parse(req.body);
  return res.json(await prisma.driver.update({
    where: { id: context.id },
    data: { available: body.available }
  }));
}

export async function updateDriverLocation(req: Request, res: Response) {
  const context = driverContext(req);
  const body = z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180)
  }).parse(req.body);
  await prisma.driver.update({
    where: { id: context.id },
    data: {
      lastLatitude: body.latitude,
      lastLongitude: body.longitude,
      lastLocationAt: new Date()
    }
  });
  return res.status(204).send();
}

export async function registerDriverDevice(req: Request, res: Response) {
  const context = driverContext(req);
  const body = z.object({
    expoToken: z.string().startsWith("ExponentPushToken").or(z.string().startsWith("ExpoPushToken")),
    platform: z.string().max(20).optional()
  }).parse(req.body);
  const device = await prisma.driverDeviceToken.upsert({
    where: { expoToken: body.expoToken },
    update: {
      driverId: context.id,
      companyId: context.companyId,
      platform: body.platform,
      active: true
    },
    create: {
      driverId: context.id,
      companyId: context.companyId,
      expoToken: body.expoToken,
      platform: body.platform
    }
  });
  return res.status(201).json(device);
}

export async function listDriverRoutes(req: Request, res: Response) {
  const context = driverContext(req);
  const history = req.query.history === "true";
  const routes = await prisma.deliveryRoute.findMany({
    where: {
      driverId: context.id,
      companyId: context.companyId,
      status: history ? { in: ["COMPLETED", "CANCELED"] } : { in: ["CREATED", "IN_PROGRESS"] }
    },
    include: routeInclude,
    orderBy: { createdAt: "desc" },
    take: history ? 100 : 20
  });
  return res.json(routes);
}

export async function getDriverRoute(req: Request, res: Response) {
  const context = driverContext(req);
  const route = await prisma.deliveryRoute.findFirst({
    where: { id: req.params.id, driverId: context.id, companyId: context.companyId },
    include: routeInclude
  });
  if (!route) return res.status(404).json({ message: "Rota nao encontrada" });
  return res.json(route);
}

export async function acceptDriverRoute(req: Request, res: Response) {
  const context = driverContext(req);
  const route = await prisma.deliveryRoute.findFirst({
    where: { id: req.params.id, driverId: context.id, companyId: context.companyId, status: "CREATED" },
    include: { orders: { select: { orderId: true } } }
  });
  if (!route) return res.status(404).json({ message: "Rota pendente nao encontrada" });
  const updated = await prisma.$transaction(async (transaction) => {
    await transaction.order.updateMany({
      where: { id: { in: route.orders.map((item) => item.orderId) }, companyId: context.companyId },
      data: { status: "OUT_FOR_DELIVERY", sentToDelivery: true, deliverySentAt: new Date() }
    });
    return transaction.deliveryRoute.update({
      where: { id: route.id },
      data: { status: "IN_PROGRESS", acceptedAt: new Date(), startedAt: new Date(), declinedAt: null },
      include: routeInclude
    });
  });
  return res.json(updated);
}

export async function declineDriverRoute(req: Request, res: Response) {
  const context = driverContext(req);
  const route = await prisma.deliveryRoute.findFirst({
    where: { id: req.params.id, driverId: context.id, companyId: context.companyId, status: "CREATED" }
  });
  if (!route) return res.status(404).json({ message: "Rota pendente nao encontrada" });
  return res.json(await prisma.deliveryRoute.update({
    where: { id: route.id },
    data: { status: "CANCELED", declinedAt: new Date(), canceledAt: new Date() }
  }));
}

export async function markDriverOrderDelivered(req: Request, res: Response) {
  const context = driverContext(req);
  const routeOrder = await prisma.deliveryRouteOrder.findFirst({
    where: {
      routeId: req.params.routeId,
      orderId: req.params.orderId,
      companyId: context.companyId,
      route: { driverId: context.id, status: "IN_PROGRESS" }
    },
    include: { order: true }
  });
  if (!routeOrder) return res.status(404).json({ message: "Pedido da rota nao encontrado" });
  if (routeOrder.order.status === "CANCELED" || routeOrder.order.status === "FINISHED") {
    return res.status(400).json({ message: "Pedido nao pode ser marcado como entregue" });
  }
  const order = await prisma.order.update({
    where: { id: routeOrder.orderId },
    data: { status: "DELIVERED" }
  });
  const remaining = await prisma.deliveryRouteOrder.count({
    where: {
      routeId: req.params.routeId,
      order: { status: { not: "DELIVERED" } }
    }
  });
  if (remaining === 0) {
    await prisma.deliveryRoute.update({
      where: { id: req.params.routeId },
      data: { status: "COMPLETED", completedAt: new Date() }
    });
  }
  return res.json({ order, routeCompleted: remaining === 0 });
}

export async function completeDriverRoute(req: Request, res: Response) {
  const context = driverContext(req);
  const route = await prisma.deliveryRoute.findFirst({
    where: { id: req.params.id, driverId: context.id, companyId: context.companyId, status: "IN_PROGRESS" },
    include: { orders: { include: { order: true } } }
  });
  if (!route) return res.status(404).json({ message: "Rota em andamento nao encontrada" });
  if (route.orders.some((item) => item.order.status !== "DELIVERED")) {
    return res.status(400).json({ message: "Marque todos os pedidos como entregues antes de concluir" });
  }
  return res.json(await prisma.deliveryRoute.update({
    where: { id: route.id },
    data: { status: "COMPLETED", completedAt: new Date() }
  }));
}
