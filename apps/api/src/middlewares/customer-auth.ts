import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../utils/env.js";

export function customerAuth(req: Request, res: Response, next: NextFunction) {
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
    (req as any).customerId = decoded.customerId;
    (req as any).customerPhone = decoded.phone;
    next();
  } catch {
    return res.status(401).json({ message: "Token expirado ou invalido" });
  }
}
