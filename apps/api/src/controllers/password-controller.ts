import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { createPasswordReset, validatePasswordReset } from "../utils/password-reset.js";
import { companyWhere, getCompanyId } from "../utils/tenant.js";

export async function requestStaffPasswordReset(req: Request, res: Response) {
  const body = z.object({ email: z.string().email() }).parse(req.body);
  const user = await prisma.user.findFirst({ where: { email: body.email.toLowerCase(), ...companyWhere(req) } });
  if (user?.phone && user.active) {
    await createPasswordReset({
      userId: user.id,
      companyId: user.companyId,
      phone: user.phone,
      name: user.name
    });
  }
  return res.json({ message: "Se os dados estiverem corretos, o codigo sera enviado por WhatsApp" });
}

export async function resetStaffPassword(req: Request, res: Response) {
  const body = z.object({
    email: z.string().email(),
    code: z.string().length(6),
    newPassword: z.string().min(6)
  }).parse(req.body);
  const user = await prisma.user.findFirst({ where: { email: body.email.toLowerCase(), ...companyWhere(req) } });
  if (!user) return res.status(400).json({ message: "Codigo invalido ou expirado" });
  const reset = await validatePasswordReset({
    companyId: getCompanyId(req),
    userId: user.id,
    code: body.code
  });
  if (!reset) return res.status(400).json({ message: "Codigo invalido ou expirado" });
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(body.newPassword, 10) }
    }),
    prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } })
  ]);
  return res.json({ message: "Senha alterada" });
}

export async function requestCustomerPasswordReset(req: Request, res: Response) {
  const body = z.object({ phone: z.string().min(8) }).parse(req.body);
  const customer = await prisma.customer.findFirst({ where: { phone: body.phone, ...companyWhere(req) } });
  if (customer) {
    await createPasswordReset({
      customerId: customer.id,
      companyId: customer.companyId,
      phone: customer.phone,
      name: customer.name
    });
  }
  return res.json({ message: "Se os dados estiverem corretos, o codigo sera enviado por WhatsApp" });
}

export async function resetCustomerPassword(req: Request, res: Response) {
  const body = z.object({
    phone: z.string().min(8),
    code: z.string().length(6),
    newPassword: z.string().min(6)
  }).parse(req.body);
  const customer = await prisma.customer.findFirst({ where: { phone: body.phone, ...companyWhere(req) } });
  if (!customer) return res.status(400).json({ message: "Codigo invalido ou expirado" });
  const reset = await validatePasswordReset({
    companyId: getCompanyId(req),
    customerId: customer.id,
    code: body.code
  });
  if (!reset) return res.status(400).json({ message: "Codigo invalido ou expirado" });
  await prisma.$transaction([
    prisma.customer.update({
      where: { id: customer.id },
      data: { passwordHash: await bcrypt.hash(body.newPassword, 10) }
    }),
    prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } })
  ]);
  return res.json({ message: "Senha alterada" });
}
