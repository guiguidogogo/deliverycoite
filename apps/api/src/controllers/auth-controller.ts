import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { env } from "../utils/env.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  subdomain: z.string().trim().min(2).optional()
});

export async function login(req: Request, res: Response) {
  const body = loginSchema.parse(req.body);
  const email = body.email.toLowerCase();

  const candidates = await prisma.user.findMany({
    where: {
      email,
      active: true,
      company: {
        active: true,
        ...(body.subdomain ? { subdomain: body.subdomain.toLowerCase() } : {})
      }
    },
    include: { staffRole: true },
    take: 10
  });

  const passwordMatches = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      matches: await bcrypt.compare(body.password, candidate.passwordHash)
    }))
  );
  const matchedUsers = passwordMatches
    .filter((result) => result.matches)
    .map((result) => result.candidate);

  if (matchedUsers.length === 0) {
    return res.status(401).json({ message: "Credenciais invalidas" });
  }

  if (matchedUsers.length > 1 && !body.subdomain) {
    return res.status(409).json({
      message: "Este email existe em mais de uma empresa. Informe o subdominio da empresa."
    });
  }

  const user = matchedUsers[0];
  const permissions =
    user.role === "SUPER_ADMIN" || user.role === "ADMIN"
      ? ["*"]
      : (user.staffRole?.permissions ?? []);
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
