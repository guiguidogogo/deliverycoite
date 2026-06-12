import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../utils/env.js";

type JwtPayload = {
  sub: string;
  role: "ADMIN" | "ATTENDANT";
};

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function auth(requiredRoles?: Array<"ADMIN" | "ATTENDANT">) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const queryToken = req.query.token?.toString();

    if (!authHeader && !queryToken) {
      return res.status(401).json({ message: "Token nao informado" });
    }

    const token = authHeader ? authHeader.split(" ")[1] : queryToken!;

    try {
      const payload = jwt.verify(token, env.jwtSecret) as JwtPayload;
      req.user = payload;

      if (requiredRoles && !requiredRoles.includes(payload.role)) {
        return res.status(403).json({ message: "Sem permissao" });
      }

      return next();
    } catch {
      return res.status(401).json({ message: "Token invalido" });
    }
  };
}
