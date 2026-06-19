import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";

const optionalText = z.preprocess(
  (value) => typeof value === "string" && !value.trim() ? null : value,
  z.string().trim().nullable().optional()
);

const companySchema = z.object({
  companyName: z.string().trim().min(2, "Informe a razao social"),
  tradeName: z.string().trim().min(2, "Informe o nome fantasia"),
  cnpj: optionalText,
  phone: optionalText,
  whatsapp: optionalText,
  instagram: optionalText,
  email: z.preprocess(
    (value) => typeof value === "string" && !value.trim() ? null : value,
    z.string().trim().email("Email invalido").nullable().optional()
  ),
  logoUrl: z.preprocess(
    (value) => typeof value === "string" && !value.trim() ? null : value,
    z.string().trim().url("URL da logo invalida").nullable().optional()
  ),
  subdomain: z.string().trim().min(2).max(63),
  plan: z.string().trim().min(2).max(40).default("basico"),
  active: z.boolean().default(true)
});

const createCompanySchema = companySchema.extend({
  admin: z.object({
    name: z.string().trim().min(2),
    email: z.string().trim().email("Email do administrador invalido"),
    phone: optionalText,
    password: z.string().min(6, "A senha deve ter pelo menos 6 caracteres")
  })
});

function onlyDigits(value?: string | null) {
  return value?.replace(/\D/g, "") || null;
}

function isValidCnpj(value?: string | null) {
  const cnpj = onlyDigits(value);
  if (!cnpj) return true;
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;

  const calculateDigit = (base: string, weights: number[]) => {
    const sum = base.split("").reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const first = calculateDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calculateDigit(cnpj.slice(0, 12) + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cnpj.endsWith(`${first}${second}`);
}

function normalizeSubdomain(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function validateContactFields(data: {
  cnpj?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
}) {
  if (!isValidCnpj(data.cnpj)) {
    throw new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: ["cnpj"],
      message: "CNPJ invalido"
    }]);
  }
  for (const [field, value] of [["phone", data.phone], ["whatsapp", data.whatsapp]] as const) {
    const digits = onlyDigits(value);
    if (digits && (digits.length < 10 || digits.length > 13)) {
      throw new z.ZodError([{
        code: z.ZodIssueCode.custom,
        path: [field],
        message: "Telefone invalido"
      }]);
    }
  }
}

function companyData(data: z.infer<typeof companySchema>) {
  validateContactFields(data);
  const subdomain = normalizeSubdomain(data.subdomain);
  if (subdomain.length < 2) {
    throw new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: ["subdomain"],
      message: "Subdominio invalido"
    }]);
  }
  return {
    ...data,
    cnpj: onlyDigits(data.cnpj),
    phone: onlyDigits(data.phone),
    whatsapp: onlyDigits(data.whatsapp),
    email: data.email?.toLowerCase() ?? null,
    subdomain
  };
}

function conflictMessage(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return null;
  const target = Array.isArray(error.meta?.target) ? error.meta.target.join(",") : String(error.meta?.target ?? "");
  if (target.includes("subdomain")) return "Este subdominio ja esta em uso";
  if (target.includes("cnpj")) return "Este CNPJ ja esta cadastrado";
  if (target.includes("email")) return "Este email ja esta cadastrado para a empresa";
  if (target.includes("phone")) return "Este telefone ja esta cadastrado para a empresa";
  return "Ja existe um cadastro com estes dados";
}

export async function generateCompanySubdomain(req: Request, res: Response) {
  const tradeName = z.string().trim().min(2).parse(req.query.tradeName);
  const excludeId = req.query.excludeId?.toString();
  const base = normalizeSubdomain(tradeName) || "empresa";
  let subdomain = base;
  let suffix = 2;

  while (await prisma.company.findFirst({
    where: { subdomain, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true }
  })) {
    subdomain = `${base.slice(0, Math.max(1, 63 - String(suffix).length - 1))}-${suffix}`;
    suffix += 1;
  }

  return res.json({
    subdomain,
    hostname: `${subdomain}.meudelivery.com.br`
  });
}

export async function listCompanies(req: Request, res: Response) {
  const search = req.query.search?.toString().trim();
  const status = req.query.status?.toString();
  const plan = req.query.plan?.toString().trim();
  const companies = await prisma.company.findMany({
    where: {
      ...(search ? {
        OR: [
          { companyName: { contains: search, mode: "insensitive" } },
          { tradeName: { contains: search, mode: "insensitive" } },
          { cnpj: { contains: onlyDigits(search) ?? search } },
          { subdomain: { contains: normalizeSubdomain(search), mode: "insensitive" } }
        ]
      } : {}),
      ...(status === "active" ? { active: true } : status === "inactive" ? { active: false } : {}),
      ...(plan ? { plan } : {})
    },
    include: {
      _count: { select: { users: true, products: true, orders: true } },
      users: {
        where: { role: "ADMIN", active: true },
        select: { id: true, name: true, email: true },
        take: 1,
        orderBy: { createdAt: "asc" }
      }
    },
    orderBy: { createdAt: "desc" }
  });
  return res.json(companies);
}

export async function getCompany(req: Request, res: Response) {
  const company = await prisma.company.findUnique({
    where: { id: req.params.id },
    include: {
      _count: { select: { users: true, products: true, orders: true, customers: true } },
      users: {
        where: { role: "ADMIN" },
        select: { id: true, name: true, email: true, phone: true, active: true, createdAt: true },
        orderBy: { createdAt: "asc" }
      }
    }
  });
  if (!company) return res.status(404).json({ message: "Empresa nao encontrada" });
  return res.json(company);
}

export async function createCompany(req: Request, res: Response) {
  const body = createCompanySchema.parse(req.body);
  const data = companyData(body);
  try {
    const company = await prisma.$transaction(async (transaction) => {
      const created = await transaction.company.create({
        data: {
          companyName: data.companyName,
          tradeName: data.tradeName,
          cnpj: data.cnpj,
          phone: data.phone,
          whatsapp: data.whatsapp,
          instagram: data.instagram,
          email: data.email,
          logoUrl: data.logoUrl,
          subdomain: data.subdomain,
          plan: data.plan,
          active: data.active
        }
      });

      await transaction.setting.create({
        data: {
          companyId: created.id,
          companyName: created.tradeName,
          logoUrl: created.logoUrl,
          whatsappNumber: created.whatsapp ?? created.phone ?? "",
          openTime: "00:00",
          closeTime: "23:59"
        }
      });

      await transaction.user.create({
        data: {
          companyId: created.id,
          name: body.admin.name,
          email: body.admin.email.toLowerCase(),
          phone: onlyDigits(body.admin.phone),
          passwordHash: await bcrypt.hash(body.admin.password, 10),
          role: "ADMIN",
          active: true
        }
      });
      return created;
    });
    return res.status(201).json(company);
  } catch (error) {
    const message = conflictMessage(error);
    if (message) return res.status(409).json({ message });
    throw error;
  }
}

export async function updateCompany(req: Request, res: Response) {
  const existing = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ message: "Empresa nao encontrada" });
  const body = companySchema.partial().parse(req.body);
  const merged = companyData({
    companyName: body.companyName ?? existing.companyName,
    tradeName: body.tradeName ?? existing.tradeName,
    cnpj: body.cnpj === undefined ? existing.cnpj : body.cnpj,
    phone: body.phone === undefined ? existing.phone : body.phone,
    whatsapp: body.whatsapp === undefined ? existing.whatsapp : body.whatsapp,
    instagram: body.instagram === undefined ? existing.instagram : body.instagram,
    email: body.email === undefined ? existing.email : body.email,
    logoUrl: body.logoUrl === undefined ? existing.logoUrl : body.logoUrl,
    subdomain: body.subdomain ?? existing.subdomain,
    plan: body.plan ?? existing.plan,
    active: body.active ?? existing.active
  });
  try {
    const company = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.company.update({
        where: { id: existing.id },
        data: merged
      });
      await transaction.setting.upsert({
        where: { companyId: existing.id },
        update: {
          companyName: updated.tradeName,
          logoUrl: updated.logoUrl,
          ...(updated.whatsapp || updated.phone
            ? { whatsappNumber: updated.whatsapp ?? updated.phone ?? "" }
            : {})
        },
        create: {
          companyId: updated.id,
          companyName: updated.tradeName,
          logoUrl: updated.logoUrl,
          whatsappNumber: updated.whatsapp ?? updated.phone ?? "",
          openTime: "00:00",
          closeTime: "23:59"
        }
      });
      return updated;
    });
    return res.json(company);
  } catch (error) {
    const message = conflictMessage(error);
    if (message) return res.status(409).json({ message });
    throw error;
  }
}

export async function updateCompanyStatus(req: Request, res: Response) {
  const body = z.object({ active: z.boolean() }).parse(req.body);
  const existing = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ message: "Empresa nao encontrada" });
  return res.json(await prisma.company.update({
    where: { id: existing.id },
    data: { active: body.active }
  }));
}
