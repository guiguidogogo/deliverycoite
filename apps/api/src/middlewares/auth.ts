import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../utils/env.js";
import { prisma } from "../utils/prisma.js";
import type { Permission } from "../utils/permissions.js";

type JwtPayload = {
  sub: string;
  companyId?: string;
  scope?: "GLOBAL";
};

declare global {
  namespace Express {
    interface Request {
      user?: {
        sub: string;
        role: "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "ATTENDANT";
        companyId?: string | null;
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
        include: { staffRole: true, company: true }
      });

      if (!user || !user.active) {
        return res.status(401).json({ message: "Usuario inativo ou inexistente" });
      }
      const isGlobalMaster = user.role === "SUPER_ADMIN";
      if (!isGlobalMaster && !user.company.active) {
        return res.status(401).json({ message: "Empresa inativa ou inexistente" });
      }
      if (!isGlobalMaster && payload.companyId && payload.companyId !== user.companyId) {
        return res.status(401).json({ message: "Token pertence a outra empresa" });
      }
      if (!isGlobalMaster && req.tenant?.bound && req.companyId && req.companyId !== user.companyId) {
        return res.status(403).json({ message: "Usuario nao pertence a empresa deste subdominio" });
      }

      req.user = {
        sub: user.id,
        role: user.role,
        companyId: isGlobalMaster ? null : user.companyId,
        permissions: isGlobalMaster || user.role === "ADMIN" ? ["*"] : (user.staffRole?.permissions ?? [])
      };
      if (!isGlobalMaster) {
        req.companyId = user.companyId;
      }
      return next();
    } catch {
      return res.status(401).json({ message: "Token invalido" });
    }
  };
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role === "SUPER_ADMIN") {
      return res.status(403).json({
        message: "O administrador master deve usar o painel global de empresas"
      });
    }
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
    if (req.user?.role === "SUPER_ADMIN") {
      return res.status(403).json({
        message: "O administrador master deve usar o painel global de empresas"
      });
    }
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

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "SUPER_ADMIN") {
    return res.status(403).json({ message: "Acesso exclusivo do administrador master" });
  }
  return next();
}
