import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../utils/env.js";
import { prisma } from "../utils/prisma.js";
import type { Permission } from "../utils/permissions.js";

type JwtPayload = {
  sub: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: {
        sub: string;
        role: "ADMIN" | "MANAGER" | "ATTENDANT";
        permissions: string[];
      };
    }
  }
}

export function auth() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const queryToken = req.query.token?.toString();
    if (!authHeader && !queryToken) {
      return res.status(401).json({ message: "Token nao informado" });
    }

    const token = authHeader ? authHeader.split(" ")[1] : queryToken!;

    try {
      const payload = jwt.verify(token, env.jwtSecret) as JwtPayload;
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        include: { staffRole: true }
      });

      if (!user || !user.active) {
        return res.status(401).json({ message: "Usuario inativo ou inexistente" });
      }

      req.user = {
        sub: user.id,
        role: user.role,
        permissions: user.role === "ADMIN" ? ["*"] : (user.staffRole?.permissions ?? [])
      };
      return next();
    } catch {
      return res.status(401).json({ message: "Token invalido" });
    }
  };
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (
      req.user?.role === "ADMIN" ||
      req.user?.permissions.includes("*") ||
      req.user?.permissions.includes(permission)
    ) {
      return next();
    }

    return res.status(403).json({ message: "Sem permissao para esta area" });
  };
}

export function requireAnyPermission(permissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (
      req.user?.role === "ADMIN" ||
      req.user?.permissions.includes("*") ||
      permissions.some((permission) => req.user?.permissions.includes(permission))
    ) {
      return next();
    }
    return res.status(403).json({ message: "Sem permissao para esta area" });
  };
}
