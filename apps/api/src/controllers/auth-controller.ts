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
      ...(req.tenant?.source === "root-domain"
        ? { role: "SUPER_ADMIN" as const }
        : {
          OR: [
            { role: "SUPER_ADMIN" as const },
            {
              role: { not: "SUPER_ADMIN" as const },
              ...(req.tenant?.bound && req.companyId ? { companyId: req.companyId } : {}),
              company: {
                active: true,
                ...(body.subdomain ? { subdomain: body.subdomain.toLowerCase() } : {})
              }
            }
          ]
        })
    },
    include: {
      staffRole: true,
      company: {
        select: { id: true, tradeName: true, subdomain: true }
      }
    },
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

  const masterUser = matchedUsers.find((candidate) => candidate.role === "SUPER_ADMIN");
  if (masterUser && matchedUsers.filter((candidate) => candidate.role === "SUPER_ADMIN").length > 1) {
    return res.status(409).json({
      message: "Existe mais de um usuario master com estas credenciais. Revise os administradores globais."
    });
  }

  if (!masterUser && matchedUsers.length > 1 && !body.subdomain) {
    return res.status(409).json({
      message: "Este email existe em mais de uma empresa. Informe o subdominio da empresa."
    });
  }

  const user = masterUser ?? matchedUsers[0];
  const isGlobalMaster = user.role === "SUPER_ADMIN";
  const permissions =
    isGlobalMaster || user.role === "ADMIN"
      ? ["*"]
      : (user.staffRole?.permissions ?? []);
  const token = jwt.sign(isGlobalMaster ? { scope: "GLOBAL" } : { companyId: user.companyId }, env.jwtSecret, {
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
      scope: isGlobalMaster ? "GLOBAL" : "COMPANY",
      companyId: isGlobalMaster ? null : user.companyId,
      company: isGlobalMaster ? null : user.company,
      permissions
    }
  });
}
