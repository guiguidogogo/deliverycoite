import type { Prisma, PrismaClient } from "@prisma/client";
import type { Request } from "express";
import { prisma } from "./prisma.js";
import { getCompanyId } from "./tenant.js";

type AuditClient = Prisma.TransactionClient | PrismaClient;

function requestIp(req: Request) {
  return (req.headers["x-forwarded-for"]?.toString().split(",")[0] || req.ip || "").trim() || null;
}

export async function audit(
  req: Request,
  input: {
    action: string;
    entity: string;
    entityId?: string | null;
    oldValue?: unknown;
    newValue?: unknown;
  },
  client: AuditClient = prisma
) {
  const user = req.user?.sub
    ? await client.user.findUnique({ where: { id: req.user.sub }, select: { name: true } })
    : null;

  return client.auditLog.create({
    data: {
      companyId: getCompanyId(req),
      userId: req.user?.sub,
      userName: user?.name,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      oldValue: input.oldValue === undefined ? undefined : input.oldValue as Prisma.InputJsonValue,
      newValue: input.newValue === undefined ? undefined : input.newValue as Prisma.InputJsonValue,
      ipAddress: requestIp(req),
      device: req.headers["user-agent"]?.slice(0, 500)
    }
  });
}

export function accessMetadata(req: Request) {
  return {
    ip: requestIp(req),
    device: req.headers["user-agent"]?.slice(0, 500) ?? null
  };
}
