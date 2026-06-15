import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { env } from "../utils/env.js";

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

  // Verificar se já existe
  const existing = await prisma.customer.findUnique({
    where: { phone: body.phone }
  });

  if (existing) {
    return res.status(400).json({ message: "Telefone ja cadastrado" });
  }

  if (body.email) {
    const existingEmail = await prisma.customer.findUnique({
      where: { email: body.email }
    });
    if (existingEmail) {
      return res.status(400).json({ message: "Email ja cadastrado" });
    }
  }

  const passwordHash = body.password ? await bcrypt.hash(body.password, 10) : null;

  const customer = await prisma.customer.create({
    data: {
      name: body.name,
      phone: body.phone,
      email: body.email,
      passwordHash,
      address: body.address || "",
      number: body.number || "",
      district: body.district || "",
      complement: body.complement
    }
  });

  // Se forneceu endereço, criar como primeiro endereço
  if (body.address && body.number && body.district) {
    await prisma.customerAddress.create({
      data: {
        customerId: customer.id,
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

  const token = jwt.sign({ customerId: customer.id, phone: customer.phone }, env.jwtSecret, {
    expiresIn: "30d"
  });

  return res.status(201).json({
    token,
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email
    }
  });
}

export async function loginCustomer(req: Request, res: Response) {
  const body = loginSchema.parse(req.body);

  const customer = await prisma.customer.findUnique({
    where: { phone: body.phone }
  });

  if (!customer || !customer.passwordHash) {
    return res.status(401).json({ message: "Credenciais invalidas" });
  }

  const valid = await bcrypt.compare(body.password, customer.passwordHash);
  if (!valid) {
    return res.status(401).json({ message: "Credenciais invalidas" });
  }

  const token = jwt.sign({ customerId: customer.id, phone: customer.phone }, env.jwtSecret, {
    expiresIn: "30d"
  });

  return res.json({
    token,
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email
    }
  });
}

export async function getCustomerProfile(req: Request, res: Response) {
  const customerId = (req as any).customerId;

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
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

  const customer = await prisma.customer.update({
    where: { id: customerId },
    data: body
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
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
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
      where: { customerId },
      data: { isDefault: false }
    });
  }

  const address = await prisma.customerAddress.create({
    data: {
      customerId,
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
    where: { id: addressId, customerId }
  });

  if (!existing) {
    return res.status(404).json({ message: "Endereco nao encontrado" });
  }

  // Se for padrão, desmarcar outros
  if (body.isDefault) {
    await prisma.customerAddress.updateMany({
      where: { customerId, id: { not: addressId } },
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
    where: { id: addressId, customerId }
  });

  if (!existing) {
    return res.status(404).json({ message: "Endereco nao encontrado" });
  }

  await prisma.customerAddress.delete({
    where: { id: addressId }
  });

  return res.status(204).send();
}
