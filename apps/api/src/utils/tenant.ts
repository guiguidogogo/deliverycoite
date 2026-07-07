import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma.js";
import { env } from "./env.js";

export const DEFAULT_COMPANY_ID = "default-company";

declare global {
  namespace Express {
    interface Request {
      companyId?: string;
      tenant?: {
        source: "default" | "localhost" | "root-domain" | "subdomain" | "custom-domain" | "homologation";
        host: string;
        subdomain?: string;
        bound: boolean;
      };
    }
  }
}

function normalizeHost(host?: string) {
  return (host ?? "")
    .split(",")[0]
    .trim()
    .split(":")[0]
    .toLowerCase()
    .replace(/\.$/, "");
}

function requestHost(req: Request) {
  const directHost = normalizeHost(req.headers["x-forwarded-host"]?.toString() || req.headers.host || req.hostname);
  const rootDomain = env.rootDomain;
  if (directHost.endsWith(`.${rootDomain}`) || directHost === rootDomain || directHost === `www.${rootDomain}` || directHost === `admin.${rootDomain}`) {
    return directHost;
  }

  const originOrReferer = req.headers.origin?.toString() || req.headers.referer?.toString();
  if (originOrReferer) {
    try {
      const browserHost = normalizeHost(new URL(originOrReferer).host);
      if (browserHost.endsWith(`.${rootDomain}`) || browserHost === rootDomain || browserHost === `www.${rootDomain}` || browserHost === `admin.${rootDomain}`) {
        return browserHost;
      }
    } catch {
      return directHost;
    }
  }

  return directHost;
}

function normalizeSubdomain(value?: string) {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
}

function bodySubdomain(req: Request) {
  const path = req.path.toLowerCase();
  const bodyCanResolveTenant = [
    "/auth/login",
    "/auth/password/request",
    "/auth/password/reset",
    "/customer/register",
    "/customer/login",
    "/customer/password/request",
    "/customer/password/reset",
    "/driver/auth/login"
  ].includes(path);

  if (!bodyCanResolveTenant) return "";

  return typeof req.body === "object" && req.body && "subdomain" in req.body
    ? normalizeSubdomain(String((req.body as { subdomain?: unknown }).subdomain ?? ""))
    : "";
}

function authenticatedCompanyId(req: Request) {
  const headerToken = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : "";
  const token = headerToken || req.query.token?.toString() || "";
  if (!token) return "";

  try {
    const payload = jwt.verify(token, env.jwtSecret) as { companyId?: string; scope?: "GLOBAL" };
    return payload.scope === "GLOBAL" ? "" : payload.companyId ?? "";
  } catch {
    return "";
  }
}

async function findActiveCompany(subdomain: string) {
  return prisma.company.findFirst({
    where: { subdomain, active: true },
    select: { id: true, subdomain: true }
  });
}

function tenantNotFound(res: Response, subdomain: string) {
  return res.status(404).json({
    message: `Empresa nao encontrada para o subdominio "${subdomain}"`
  });
}

export function getCompanyId(req: Request) {
  if (req.companyId && req.companyId !== DEFAULT_COMPANY_ID) {
    return req.companyId;
  }

  return req.user?.companyId ?? req.companyId ?? DEFAULT_COMPANY_ID;
}

export function companyWhere(req: Request) {
  return { companyId: getCompanyId(req) };
}

export async function resolveCompany(req: Request, res: Response, next: NextFunction) {
  const host = requestHost(req);
  const requestedSubdomain = normalizeSubdomain(
    req.headers["x-company-subdomain"]?.toString() || req.query.subdomain?.toString()
  );
  if (requestedSubdomain) {
    const company = await findActiveCompany(requestedSubdomain);
    if (!company) return tenantNotFound(res, requestedSubdomain);
    req.companyId = company.id;
    req.tenant = {
      source: "homologation",
      host,
      subdomain: company.subdomain,
      bound: true
    };
    return next();
  }

  const tokenCompanyId = authenticatedCompanyId(req);
  if (tokenCompanyId) {
    req.companyId = tokenCompanyId;
    req.tenant = { source: "default", host, bound: false };
    return next();
  }

  const requestedBodySubdomain = bodySubdomain(req);
  if (requestedBodySubdomain) {
    const company = await findActiveCompany(requestedBodySubdomain);
    if (!company) return tenantNotFound(res, requestedBodySubdomain);
    req.companyId = company.id;
    req.tenant = {
      source: "homologation",
      host,
      subdomain: company.subdomain,
      bound: true
    };
    return next();
  }

  if (!host || host === "localhost" || host === "127.0.0.1" || host === "::1") {
    req.companyId = DEFAULT_COMPANY_ID;
    req.tenant = { source: "localhost", host, bound: false };
    return next();
  }

  const rootDomain = env.rootDomain;
  if (host === rootDomain || host === `www.${rootDomain}` || host === `admin.${rootDomain}`) {
    req.companyId = DEFAULT_COMPANY_ID;
    req.tenant = { source: "root-domain", host, bound: false };
    return next();
  }

  if (host.endsWith(`.${rootDomain}`)) {
    const subdomain = normalizeSubdomain(host.slice(0, -(rootDomain.length + 1)));
    if (!subdomain || subdomain.includes(".")) return tenantNotFound(res, subdomain || host);
    const company = await findActiveCompany(subdomain);
    if (!company) return tenantNotFound(res, subdomain);
    req.companyId = company.id;
    req.tenant = { source: "subdomain", host, subdomain, bound: true };
    return next();
  }

  const customDomainCompany = await prisma.company.findFirst({
    where: { customDomain: host, active: true },
    select: { id: true, subdomain: true }
  });
  if (customDomainCompany) {
    req.companyId = customDomainCompany.id;
    req.tenant = {
      source: "custom-domain",
      host,
      subdomain: customDomainCompany.subdomain,
      bound: true
    };
    return next();
  }

  // Hosts centrais de homologacao/preview (por exemplo *.onrender.com).
  req.companyId = DEFAULT_COMPANY_ID;
  req.tenant = { source: "default", host, bound: false };
  return next();
}
