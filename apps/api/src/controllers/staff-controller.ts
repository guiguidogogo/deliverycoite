import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { DEFAULT_STAFF_ROLES, PERMISSIONS } from "../utils/permissions.js";
import { companyWhere, getCompanyId } from "../utils/tenant.js";

const roleSchema = z.object({
  name: z.string().min(2),
  permissions: z.array(z.enum(PERMISSIONS))
});

const userSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(8),
  password: z.string().min(6).optional(),
  role: z.enum(["ADMIN", "MANAGER", "ATTENDANT"]).default("ATTENDANT"),
  staffRoleId: z.string().nullable().optional(),
  active: z.boolean().optional()
});

async function ensureDefaultRoles(req: Request) {
  for (const role of DEFAULT_STAFF_ROLES) {
    await prisma.staffRole.upsert({
      where: {
        companyId_name: {
          companyId: getCompanyId(req),
          name: role.name
        }
      },
      update: { permissions: role.permissions },
      create: { ...role, companyId: getCompanyId(req) }
    });
  }
}

export async function getCurrentStaff(req: Request, res: Response) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.sub },
    include: {
      staffRole: true,
      company: {
        select: { id: true, tradeName: true, subdomain: true, active: true }
      }
    }
  });
  return res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    scope: user.role === "SUPER_ADMIN" ? "GLOBAL" : "COMPANY",
    permissions: req.user!.permissions,
    staffRole: user.staffRole,
    company: user.role === "SUPER_ADMIN" ? null : user.company
  });
}

export async function updateCurrentStaff(req: Request, res: Response) {
  const body = z.object({
    name: z.string().min(2).optional(),
    email: z.string().email().optional(),
    phone: z.string().min(8).nullable().optional()
  }).parse(req.body);
  const user = await prisma.user.update({
    where: { id: req.user!.sub },
    data: {
      ...body,
      ...(body.email ? { email: body.email.toLowerCase() } : {})
    },
    include: { staffRole: true }
  });
  return res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    permissions: req.user!.permissions,
    staffRole: user.staffRole
  });
}

export async function listStaffRoles(req: Request, res: Response) {
  await ensureDefaultRoles(req);
  return res.json(await prisma.staffRole.findMany({ where: companyWhere(req), orderBy: { name: "asc" } }));
}

export async function createStaffRole(req: Request, res: Response) {
  const body = roleSchema.parse(req.body);
  return res.status(201).json(await prisma.staffRole.create({
    data: { ...body, companyId: getCompanyId(req) }
  }));
}

export async function updateStaffRole(req: Request, res: Response) {
  const body = roleSchema.partial().parse(req.body);
  const role = await prisma.staffRole.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!role) return res.status(404).json({ message: "Perfil nao encontrado" });
  return res.json(await prisma.staffRole.update({ where: { id: role.id }, data: body }));
}

export async function deleteStaffRole(req: Request, res: Response) {
  const role = await prisma.staffRole.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!role) return res.status(404).json({ message: "Perfil nao encontrado" });
  const users = await prisma.user.count({ where: { ...companyWhere(req), staffRoleId: role.id } });
  if (users) return res.status(400).json({ message: "Este perfil esta vinculado a usuarios" });
  await prisma.staffRole.delete({ where: { id: role.id } });
  return res.status(204).send();
}

export async function listStaffUsers(req: Request, res: Response) {
  return res.json(await prisma.user.findMany({
    where: companyWhere(req),
    include: { staffRole: true },
    orderBy: { name: "asc" }
  }));
}

export async function createStaffUser(req: Request, res: Response) {
  const body = userSchema.extend({ password: z.string().min(6) }).parse(req.body);
  if (body.role !== "ADMIN" && !body.staffRoleId) {
    return res.status(400).json({ message: "Escolha um perfil de acesso para este usuario" });
  }
  if (body.staffRoleId) {
    const role = await prisma.staffRole.findFirst({ where: { id: body.staffRoleId, ...companyWhere(req) } });
    if (!role) return res.status(400).json({ message: "Perfil de acesso invalido" });
  }
  try {
    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email.toLowerCase(),
        phone: body.phone,
        passwordHash: await bcrypt.hash(body.password, 10),
        role: body.role,
        companyId: getCompanyId(req),
        staffRoleId: body.role === "ADMIN" ? null : body.staffRoleId,
        active: body.active ?? true
      },
      include: { staffRole: true }
    });
    return res.status(201).json(user);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const fields = Array.isArray(error.meta?.target) ? error.meta.target : [];
      if (fields.includes("phone")) {
        return res.status(409).json({ message: "Este WhatsApp ja esta cadastrado em outro usuario" });
      }
      if (fields.includes("email")) {
        return res.status(409).json({ message: "Este email ja esta cadastrado em outro usuario" });
      }
      return res.status(409).json({ message: "Ja existe um usuario com estes dados" });
    }
    throw error;
  }
}

export async function updateStaffUser(req: Request, res: Response) {
  const body = userSchema.partial().parse(req.body);
  const existing = await prisma.user.findFirst({ where: { id: req.params.id, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ message: "Usuario nao encontrado" });
  if (req.params.id === req.user!.sub && (body.active === false || (body.role && body.role !== "ADMIN"))) {
    return res.status(400).json({ message: "Voce nao pode remover seu proprio acesso administrativo" });
  }
  const removesActiveAdmin = existing.role === "ADMIN"
    && existing.active
    && (body.active === false || (body.role !== undefined && body.role !== "ADMIN"));
  if (removesActiveAdmin) {
    const activeAdmins = await prisma.user.count({ where: { ...companyWhere(req), role: "ADMIN", active: true } });
    if (activeAdmins <= 1) {
      return res.status(400).json({ message: "Cadastre outro administrador antes de remover este acesso" });
    }
  }
  const nextRole = body.role ?? existing.role;
  const nextStaffRoleId = body.staffRoleId !== undefined ? body.staffRoleId : existing.staffRoleId;
  if (nextRole !== "ADMIN" && !nextStaffRoleId) {
    return res.status(400).json({ message: "Escolha um perfil de acesso para este usuario" });
  }
  if (nextStaffRoleId) {
    const role = await prisma.staffRole.findFirst({ where: { id: nextStaffRoleId, ...companyWhere(req) } });
    if (!role) return res.status(400).json({ message: "Perfil de acesso invalido" });
  }
  const { password, ...userData } = body;
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      ...userData,
      ...(body.email ? { email: body.email.toLowerCase() } : {}),
      ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}),
      ...(body.role === "ADMIN" ? { staffRoleId: null } : {})
    },
    include: { staffRole: true }
  });
  return res.json(user);
}

export async function changeStaffPassword(req: Request, res: Response) {
  const body = z.object({
    currentPassword: z.string().min(6),
    newPassword: z.string().min(6)
  }).parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } });
  if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
    return res.status(400).json({ message: "Senha atual incorreta" });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(body.newPassword, 10) }
  });
  return res.status(204).send();
}
