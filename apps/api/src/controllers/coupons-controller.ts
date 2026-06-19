import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { companyWhere, getCompanyId } from "../utils/tenant.js";

const couponSchema = z.object({
  code: z.string().min(3).toUpperCase(),
  type: z.enum(["PERCENT", "FIXED"]),
  value: z.coerce.number().positive(),
  minOrder: z.coerce.number().optional(),
  maxUses: z.coerce.number().int().positive().optional(),
  maxUsesPerCustomer: z.coerce.number().int().positive().optional(),
  maxUsesPerDay: z.coerce.number().int().positive().optional(),
  active: z.boolean().optional(),
  expiresAt: z.string().datetime().optional()
});

function normalizeCode(value: string) {
  return value.trim().toUpperCase();
}

async function checkCouponUsageLimits(couponId: string, companyId: string, customerId?: string) {
  const coupon = await prisma.coupon.findFirst({ where: { id: couponId, companyId } });
  if (!coupon) return { ok: false, message: "Cupom invalido" };

  const totalUses = await prisma.couponRedemption.count({ where: { couponId, companyId } });
  if (coupon.maxUses && totalUses >= coupon.maxUses) {
    return { ok: false, message: "Cupom atingiu o limite total de uso" };
  }

  if (customerId) {
    const customerUses = await prisma.couponRedemption.count({ where: { couponId, customerId, companyId } });
    if (coupon.maxUsesPerCustomer && customerUses >= coupon.maxUsesPerCustomer) {
      return { ok: false, message: "Este cliente atingiu o limite de uso do cupom" };
    }

    const startDay = new Date();
    startDay.setHours(0, 0, 0, 0);
    const endDay = new Date();
    endDay.setHours(23, 59, 59, 999);

    const usesToday = await prisma.couponRedemption.count({
      where: {
        couponId,
        companyId,
        customerId,
        usedAt: { gte: startDay, lte: endDay }
      }
    });

    if (coupon.maxUsesPerDay && usesToday >= coupon.maxUsesPerDay) {
      return { ok: false, message: "Limite diario de uso deste cupom atingido" };
    }
  }

  return { ok: true, coupon };
}

export async function validateCoupon(req: Request, res: Response) {
  const code = normalizeCode(req.query.code?.toString() ?? "");
  const subtotal = Number(req.query.subtotal ?? 0);
  const phone = req.query.phone?.toString();

  if (!code) {
    return res.status(400).json({ message: "Informe o cupom" });
  }

  const coupon = await prisma.coupon.findFirst({ where: { code, ...companyWhere(req) } });
  if (!coupon || !coupon.active) {
    return res.status(400).json({ message: "Cupom invalido" });
  }

  if (coupon.expiresAt && coupon.expiresAt < new Date()) {
    return res.status(400).json({ message: "Cupom expirado" });
  }

  if (coupon.minOrder && subtotal < Number(coupon.minOrder)) {
    return res.status(400).json({
      message: `Pedido minimo para este cupom: R$ ${Number(coupon.minOrder).toFixed(2)}`
    });
  }

  if (phone) {
    const customer = await prisma.customer.findFirst({ where: { phone, ...companyWhere(req) } });
    if (customer) {
      const usage = await checkCouponUsageLimits(coupon.id, getCompanyId(req), customer.id);
      if (!usage.ok) {
        return res.status(400).json({ message: usage.message });
      }
    }
  }

  const discount =
    coupon.type === "PERCENT" ? subtotal * (Number(coupon.value) / 100) : Number(coupon.value);

  return res.json({
    valid: true,
    code: coupon.code,
    discount: Math.max(0, Math.min(discount, subtotal)),
    type: coupon.type,
    value: Number(coupon.value),
    minOrder: coupon.minOrder ? Number(coupon.minOrder) : null,
    maxUses: coupon.maxUses,
    maxUsesPerCustomer: coupon.maxUsesPerCustomer,
    maxUsesPerDay: coupon.maxUsesPerDay
  });
}

export async function listCoupons(req: Request, res: Response) {
  const coupons = await prisma.coupon.findMany({
    where: companyWhere(req),
    include: {
      _count: {
        select: { redemptions: true }
      }
    },
    orderBy: { createdAt: "desc" }
  });
  return res.json(coupons);
}

export async function createCoupon(req: Request, res: Response) {
  const body = couponSchema.parse(req.body);

  const coupon = await prisma.coupon.create({
    data: {
      code: normalizeCode(body.code),
      companyId: getCompanyId(req),
      type: body.type,
      value: new Prisma.Decimal(body.value),
      minOrder: body.minOrder ? new Prisma.Decimal(body.minOrder) : null,
      maxUses: body.maxUses,
      maxUsesPerCustomer: body.maxUsesPerCustomer,
      maxUsesPerDay: body.maxUsesPerDay,
      active: body.active ?? true,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null
    }
  });

  return res.status(201).json(coupon);
}

export async function updateCoupon(req: Request, res: Response) {
  const body = couponSchema.partial().parse(req.body);
  const existing = await prisma.coupon.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ message: "Cupom nao encontrado" });

  const coupon = await prisma.coupon.update({
    where: { id: existing.id },
    data: {
      ...body,
      ...(body.code !== undefined ? { code: normalizeCode(body.code) } : {}),
      ...(body.value !== undefined ? { value: new Prisma.Decimal(body.value) } : {}),
      ...(body.minOrder !== undefined ? { minOrder: new Prisma.Decimal(body.minOrder) } : {}),
      ...(body.maxUses !== undefined ? { maxUses: body.maxUses } : {}),
      ...(body.maxUsesPerCustomer !== undefined ? { maxUsesPerCustomer: body.maxUsesPerCustomer } : {}),
      ...(body.maxUsesPerDay !== undefined ? { maxUsesPerDay: body.maxUsesPerDay } : {}),
      ...(body.expiresAt ? { expiresAt: new Date(body.expiresAt) } : {})
    }
  });

  return res.json(coupon);
}

export async function deleteCoupon(req: Request, res: Response) {
  const existing = await prisma.coupon.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ message: "Cupom nao encontrado" });
  await prisma.coupon.delete({ where: { id: existing.id } });
  return res.status(204).send();
}
