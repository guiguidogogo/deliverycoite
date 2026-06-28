import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { env } from "../utils/env.js";
import { companyWhere, getCompanyId } from "../utils/tenant.js";
import { linkCustomerToCompany, normalizeEmail, normalizePhone } from "../utils/customer-linking.js";

const registerSchema = z.object({
  name: z.string().min(2),
  phone: z.string().min(8),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  address: z.string().min(3).optional(),
  number: z.string().min(1).optional(),
  district: z.string().min(2).optional(),
  complement: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional()
});

const loginSchema = z.object({
  phone: z.string().min(8),
  password: z.string().min(6)
});

const addressSchema = z.object({
  label: z.string().min(1),
  address: z.string().min(3),
  number: z.string().min(1),
  district: z.string().min(2),
  complement: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  isDefault: z.boolean().default(false)
});

export async function registerCustomer(req: Request, res: Response) {
  const body = registerSchema.parse(req.body);
  const companyId = getCompanyId(req);
  const phone = normalizePhone(body.phone);
  const email = normalizeEmail(body.email);

  const passwordHash = body.password ? await bcrypt.hash(body.password, 10) : null;
  const linked = await linkCustomerToCompany({
    companyId,
    name: body.name,
    phone,
    email,
    passwordHash
  });

  const existingCustomer = await prisma.customer.findFirst({
    where: { phone, ...companyWhere(req) }
  });

  if (existingCustomer?.passwordHash && body.password) {
    return res.status(400).json({ message: "Telefone ja cadastrado nesta loja" });
  }

  const customer = existingCustomer
    ? await prisma.customer.update({
        where: { id: existingCustomer.id },
        data: {
          name: body.name,
          email,
          ...(passwordHash && !existingCustomer.passwordHash ? { passwordHash } : {}),
          globalCustomerId: linked.globalCustomer.id,
          companyCustomerId: linked.companyCustomer.id,
          deletedAt: null,
          deletedBy: null,
          deletionReason: null
        }
      })
    : await prisma.customer.create({
        data: {
          name: body.name,
          companyId,
          globalCustomerId: linked.globalCustomer.id,
          companyCustomerId: linked.companyCustomer.id,
          phone,
          email,
          passwordHash,
          address: body.address || "",
          number: body.number || "",
          district: body.district || "",
          complement: body.complement
        }
      });

  if (body.address && body.number && body.district) {
    await prisma.customerAddress.create({
      data: {
        customerId: customer.id,
        companyId,
        label: "Principal",
        address: body.address,
        number: body.number,
        district: body.district,
        complement: body.complement,
        latitude: body.latitude,
        longitude: body.longitude,
        isDefault: true
      }
    });
  }

  const token = jwt.sign({ customerId: customer.id, globalCustomerId: linked.globalCustomer.id, companyCustomerId: linked.companyCustomer.id, phone: customer.phone, companyId }, env.jwtSecret, {
    expiresIn: "30d"
  });

  return res.status(201).json({
    token,
    customer: {
      id: customer.id,
      globalCustomerId: linked.globalCustomer.id,
      companyCustomerId: linked.companyCustomer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email
    }
  });
}

export async function loginCustomer(req: Request, res: Response) {
  const body = loginSchema.parse(req.body);
  const companyId = getCompanyId(req);
  const phone = normalizePhone(body.phone);

  const globalCustomer = await prisma.globalCustomer.findUnique({ where: { phone } });
  const legacyCustomer = !globalCustomer
    ? await prisma.customer.findFirst({ where: { phone, ...companyWhere(req) } })
    : null;
  const passwordHash = globalCustomer?.passwordHash ?? legacyCustomer?.passwordHash;

  if (!passwordHash) {
    return res.status(401).json({ message: "Credenciais invalidas" });
  }

  const valid = await bcrypt.compare(body.password, passwordHash);
  if (!valid) {
    return res.status(401).json({ message: "Credenciais invalidas" });
  }

  const linked = await linkCustomerToCompany({
    companyId,
    name: globalCustomer?.name ?? legacyCustomer!.name,
    phone,
    email: globalCustomer?.email ?? legacyCustomer?.email,
    passwordHash
  });

  const customer = await prisma.customer.upsert({
    where: { companyId_phone: { companyId, phone } },
    create: {
      companyId,
      globalCustomerId: linked.globalCustomer.id,
      companyCustomerId: linked.companyCustomer.id,
      name: linked.globalCustomer.name,
      phone,
      email: linked.globalCustomer.email,
      passwordHash,
      address: legacyCustomer?.address ?? "",
      number: legacyCustomer?.number ?? "",
      district: legacyCustomer?.district ?? "",
      complement: legacyCustomer?.complement ?? null
    },
    update: {
      globalCustomerId: linked.globalCustomer.id,
      companyCustomerId: linked.companyCustomer.id,
      name: linked.globalCustomer.name,
      email: linked.globalCustomer.email,
      deletedAt: null,
      deletedBy: null,
      deletionReason: null
    }
  });

  const token = jwt.sign({ customerId: customer.id, globalCustomerId: linked.globalCustomer.id, companyCustomerId: linked.companyCustomer.id, phone: customer.phone, companyId }, env.jwtSecret, {
    expiresIn: "30d"
  });

  return res.json({
    token,
    customer: {
      id: customer.id,
      globalCustomerId: linked.globalCustomer.id,
      companyCustomerId: linked.companyCustomer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email
    }
  });
}

export async function getCustomerProfile(req: Request, res: Response) {
  const customerId = (req as any).customerId;

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, ...companyWhere(req) },
    include: { addresses: { orderBy: { isDefault: "desc" } } }
  });

  if (!customer) {
    return res.status(404).json({ message: "Cliente nao encontrado" });
  }

  return res.json({
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    addresses: customer.addresses
  });
}

export async function updateCustomerProfile(req: Request, res: Response) {
  const customerId = (req as any).customerId;
  const schema = z.object({
    name: z.string().min(2).optional(),
    email: z.string().email().optional()
  });

  const body = schema.parse(req.body);

  const existing = await prisma.customer.findFirst({ where: { id: customerId, ...companyWhere(req) } });
  if (!existing) return res.status(404).json({ message: "Cliente nao encontrado" });
  const customer = await prisma.customer.update({
    where: { id: existing.id },
    data: {
      ...body,
      ...(body.email !== undefined ? { email: normalizeEmail(body.email) } : {})
    }
  });

  return res.json({
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email
  });
}

export async function changeCustomerPassword(req: Request, res: Response) {
  const customerId = (req as any).customerId;
  const body = z.object({
    currentPassword: z.string().min(6),
    newPassword: z.string().min(6)
  }).parse(req.body);
  const customer = await prisma.customer.findFirstOrThrow({ where: { id: customerId, ...companyWhere(req) } });
  if (!customer.passwordHash || !(await bcrypt.compare(body.currentPassword, customer.passwordHash))) {
    return res.status(400).json({ message: "Senha atual incorreta" });
  }
  await prisma.customer.update({
    where: { id: customerId },
    data: { passwordHash: await bcrypt.hash(body.newPassword, 10) }
  });
  return res.json({ message: "Senha alterada" });
}

export async function addCustomerAddress(req: Request, res: Response) {
  const customerId = (req as any).customerId;
  const body = addressSchema.parse(req.body);

  // Se for padrão, desmarcar outros
  if (body.isDefault) {
    await prisma.customerAddress.updateMany({
      where: { customerId, ...companyWhere(req) },
      data: { isDefault: false }
    });
  }

  const address = await prisma.customerAddress.create({
    data: {
        customerId,
        companyId: getCompanyId(req),
        ...body
    }
  });

  return res.status(201).json(address);
}

export async function updateCustomerAddress(req: Request, res: Response) {
  const customerId = (req as any).customerId;
  const addressId = req.params.id;
  const body = addressSchema.partial().parse(req.body);

  // Verificar se o endereço pertence ao cliente
  const existing = await prisma.customerAddress.findFirst({
    where: { id: addressId, customerId, ...companyWhere(req) }
  });

  if (!existing) {
    return res.status(404).json({ message: "Endereco nao encontrado" });
  }

  // Se for padrão, desmarcar outros
  if (body.isDefault) {
    await prisma.customerAddress.updateMany({
      where: { customerId, id: { not: addressId }, ...companyWhere(req) },
      data: { isDefault: false }
    });
  }

  const address = await prisma.customerAddress.update({
    where: { id: addressId },
    data: body
  });

  return res.json(address);
}

export async function deleteCustomerAddress(req: Request, res: Response) {
  const customerId = (req as any).customerId;
  const addressId = req.params.id;

  // Verificar se o endereço pertence ao cliente
  const existing = await prisma.customerAddress.findFirst({
    where: { id: addressId, customerId, ...companyWhere(req) }
  });

  if (!existing) {
    return res.status(404).json({ message: "Endereco nao encontrado" });
  }

  await prisma.customerAddress.delete({
    where: { id: addressId }
  });

  return res.status(204).send();
}
