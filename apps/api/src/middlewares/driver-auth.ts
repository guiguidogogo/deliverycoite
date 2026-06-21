import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../utils/env.js";
import { prisma } from "../utils/prisma.js";

type DriverToken = {
  driverId: string;
  companyId: string;
  type: "driver";
};

declare global {
  namespace Express {
    interface Request {
      driver?: {
        id: string;
        companyId: string;
      };
    }
  }
}

export async function driverAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Token do motoboy nao informado" });
  }

  try {
    const payload = jwt.verify(header.slice(7), env.jwtSecret) as DriverToken;
    if (payload.type !== "driver" || !payload.driverId || !payload.companyId) {
      return res.status(401).json({ message: "Token do motoboy invalido" });
    }
    const driver = await prisma.driver.findFirst({
      where: {
        id: payload.driverId,
        companyId: payload.companyId,
        active: true,
        company: { active: true }
      },
      select: { id: true, companyId: true }
    });
    if (!driver) return res.status(401).json({ message: "Motoboy inativo ou inexistente" });
    if (req.tenant?.bound && req.companyId && req.companyId !== driver.companyId) {
      return res.status(403).json({ message: "Motoboy nao pertence a empresa deste subdominio" });
    }
    req.driver = driver;
    req.companyId = driver.companyId;
    return next();
  } catch {
    return res.status(401).json({ message: "Token do motoboy expirado ou invalido" });
  }
}
