import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../utils/env.js";
import { prisma } from "../utils/prisma.js";

export async function customerAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ message: "Token nao fornecido" });
  }

  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return res.status(401).json({ message: "Token invalido" });
  }

  try {
    const decoded = jwt.verify(parts[1], env.jwtSecret) as any;
    const customer = await prisma.customer.findFirst({
      where: { id: decoded.customerId, companyId: decoded.companyId ?? req.companyId }
    });
    if (!customer) {
      return res.status(401).json({ message: "Cliente invalido" });
    }
    req.companyId = customer.companyId ?? req.companyId;
    (req as any).customerId = customer.id;
    (req as any).customerPhone = customer.phone;
    next();
  } catch {
    return res.status(401).json({ message: "Token expirado ou invalido" });
  }
}
