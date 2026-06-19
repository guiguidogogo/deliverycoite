import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { env } from "../utils/env.js";
import { getCompanyId } from "../utils/tenant.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

export async function login(req: Request, res: Response) {
  const body = loginSchema.parse(req.body);

  const user = await prisma.user.findFirst({
    where: {
      email: body.email.toLowerCase(),
      OR: [{ role: "SUPER_ADMIN" }, { companyId: getCompanyId(req) }]
    }
  });
  if (!user || !user.active) {
    return res.status(401).json({ message: "Credenciais invalidas" });
  }

  const passwordMatch = await bcrypt.compare(body.password, user.passwordHash);
  if (!passwordMatch) {
    return res.status(401).json({ message: "Credenciais invalidas" });
  }

  const fullUser = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    include: { staffRole: true }
  });
  const permissions = user.role === "ADMIN" ? ["*"] : (fullUser.staffRole?.permissions ?? []);
  const token = jwt.sign({ companyId: user.companyId }, env.jwtSecret, {
    subject: user.id,
    expiresIn: "1d"
  });

  return res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      companyId: user.companyId,
      permissions
    }
  });
}
