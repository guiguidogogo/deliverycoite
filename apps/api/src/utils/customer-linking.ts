import { Prisma, type PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";

type Db = PrismaClient | Prisma.TransactionClient;

export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits || value.trim();
}

export function normalizeEmail(value?: string | null) {
  const email = value?.trim().toLowerCase();
  return email || null;
}

export async function findExistingGlobalCustomer(params: {
  phone?: string | null;
  email?: string | null;
  db?: Db;
}) {
  const db = params.db ?? prisma;
  const phone = params.phone ? normalizePhone(params.phone) : null;
  const email = normalizeEmail(params.email);

  const [byPhone, byEmail] = await Promise.all([
    phone ? db.globalCustomer.findUnique({ where: { phone } }) : Promise.resolve(null),
    email ? db.globalCustomer.findUnique({ where: { email } }) : Promise.resolve(null)
  ]);

  return byPhone ?? byEmail ?? null;
}

export async function ensureGlobalCustomer(params: {
  name: string;
  phone: string;
  email?: string | null;
  password?: string | null;
  passwordHash?: string | null;
  db?: Db;
}) {
  const db = params.db ?? prisma;
  const phone = normalizePhone(params.phone);
  const email = normalizeEmail(params.email);
  const passwordHash = params.password
    ? await bcrypt.hash(params.password, 10)
    : params.passwordHash ?? undefined;

  const existing = await findExistingGlobalCustomer({ phone, email, db });

  if (existing) {
    const canUsePhone = existing.phone === phone;
    const canUseEmail = !email || existing.email === email;

    return db.globalCustomer.update({
      where: { id: existing.id },
      data: {
        name: params.name || existing.name,
        ...(canUsePhone ? { phone } : {}),
        ...(email && canUseEmail && !existing.email ? { email } : {}),
        ...(passwordHash && !existing.passwordHash ? { passwordHash } : {}),
        lastAccessAt: new Date()
      }
    });
  }

  return db.globalCustomer.create({
    data: {
      name: params.name,
      phone,
      whatsapp: phone,
      email,
      passwordHash: passwordHash ?? null,
      lastAccessAt: new Date()
    }
  });
}

export async function ensureCompanyCustomer(params: {
  companyId: string;
  globalCustomerId: string;
  db?: Db;
}) {
  const db = params.db ?? prisma;
  return db.companyCustomer.upsert({
    where: {
      companyId_globalCustomerId: {
        companyId: params.companyId,
        globalCustomerId: params.globalCustomerId
      }
    },
    create: {
      companyId: params.companyId,
      globalCustomerId: params.globalCustomerId,
      active: true
    },
    update: { active: true }
  });
}

export async function linkCustomerToCompany(params: {
  companyId: string;
  name: string;
  phone: string;
  email?: string | null;
  password?: string | null;
  passwordHash?: string | null;
  db?: Db;
}) {
  const db = params.db ?? prisma;
  const globalCustomer = await ensureGlobalCustomer({ ...params, db });
  const companyCustomer = await ensureCompanyCustomer({
    companyId: params.companyId,
    globalCustomerId: globalCustomer.id,
    db
  });

  return { globalCustomer, companyCustomer };
}

export async function recordCompanyCustomerPurchase(params: {
  companyCustomerId: string;
  orderTotal: Prisma.Decimal | number;
  orderDate?: Date;
  db?: Db;
}) {
  const db = params.db ?? prisma;
  const companyCustomer = await db.companyCustomer.findUnique({
    where: { id: params.companyCustomerId },
    select: { ordersCount: true, totalSpent: true }
  });
  if (!companyCustomer) return null;

  const total = new Prisma.Decimal(params.orderTotal);
  const nextOrdersCount = companyCustomer.ordersCount + 1;
  const nextTotalSpent = new Prisma.Decimal(companyCustomer.totalSpent).plus(total);

  return db.companyCustomer.update({
    where: { id: params.companyCustomerId },
    data: {
      firstPurchaseAt: companyCustomer.ordersCount === 0 ? (params.orderDate ?? new Date()) : undefined,
      lastPurchaseAt: params.orderDate ?? new Date(),
      ordersCount: nextOrdersCount,
      totalSpent: nextTotalSpent,
      averageTicket: nextTotalSpent.div(nextOrdersCount)
    }
  });
}
