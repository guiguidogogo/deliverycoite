import type { Request, Response, NextFunction } from "express";
import { prisma } from "./prisma.js";

export const DEFAULT_COMPANY_ID = "default-company";

declare global {
  namespace Express {
    interface Request {
      companyId?: string;
    }
  }
}

function normalizeHost(host?: string) {
  return (host ?? "").split(":")[0].toLowerCase();
}

export function getCompanyId(req: Request) {
  return req.user?.companyId ?? req.companyId ?? DEFAULT_COMPANY_ID;
}

export function companyWhere(req: Request) {
  return { companyId: getCompanyId(req) };
}

export async function resolveCompany(req: Request, _res: Response, next: NextFunction) {
  const requestedSubdomain =
    req.headers["x-company-subdomain"]?.toString().trim().toLowerCase() ||
    req.query.subdomain?.toString().trim().toLowerCase();
  if (requestedSubdomain) {
    const company = await prisma.company.findFirst({
      where: { subdomain: requestedSubdomain, active: true },
      select: { id: true }
    });
    if (company) {
      req.companyId = company.id;
      return next();
    }
  }

  const host = normalizeHost(req.headers.host);
  if (host && !host.includes("localhost") && host !== "127.0.0.1") {
    const company = await prisma.company.findFirst({
      where: {
        active: true,
        OR: [
          { customDomain: host },
          { subdomain: host.split(".")[0] }
        ]
      },
      select: { id: true }
    });
    if (company) {
      req.companyId = company.id;
      return next();
    }
  }

  req.companyId = DEFAULT_COMPANY_ID;
  return next();
}
