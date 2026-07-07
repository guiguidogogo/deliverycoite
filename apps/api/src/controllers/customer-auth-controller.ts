import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { env } from "../utils/env.js";
import { companyWhere, getCompanyId } from "../utils/tenant.js";
import { findExistingGlobalCustomer, linkCustomerToCompany, normalizeEmail, normalizePhone } from "../utils/customer-linking.js";

const registerSchema = z.object({
  name: z.string().min(2),
  phone: z.string().min(6, "Informe um telefone com pelo menos 6 digitos"),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  address: z.string().min(3).optional(),
  number: z.string().min(1).optional(),
  district: z.string().min(2).optional(),
  complement: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional()
});

const loginSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object") return value;
    const body = value as Record<string, unknown>;
    const identifier = typeof body.identifier === "string" && body.identifier.trim()
      ? body.identifier
      : typeof body.phone === "string" && body.phone.trim()
        ? body.phone
        : typeof body.email === "string" && body.email.trim()
          ? body.email
          : "";
    return {
      ...body,
      identifier
    };
  },
  z.object({
    identifier: z.string().min(3, "Informe seu telefone ou e-mail"),
    password: z.string().min(6)
  })
);

const lookupSchema = z.object({
  phone: z.string().min(8).optional(),
  email: z.string().email().optional()
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

  const existingGlobalCustomer = await findExistingGlobalCustomer({ phone, email });
  if (existingGlobalCustomer) {
    return res.status(409).json({ message: "Ja existe um cadastro com este e-mail ou telefone. Faça login para continuar sua compra." });
  }

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

  const isEmail = body.identifier.includes("@");
  const phone = isEmail ? null : normalizePhone(body.identifier);
  const email = isEmail ? normalizeEmail(body.identifier) : null;

  const [globalByPhone, globalByEmail, legacyCustomer] = await Promise.all([
    phone ? prisma.globalCustomer.findUnique({ where: { phone } }) : Promise.resolve(null),
    email ? prisma.globalCustomer.findUnique({ where: { email } }) : Promise.resolve(null),
    prisma.customer.findFirst({
      where: {
        ...companyWhere(req),
        OR: [
          ...(phone ? [{ phone }] : []),
          ...(email ? [{ email }] : [])
        ]
      }
    })
  ]);

  const globalCandidates = [globalByPhone, globalByEmail].filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
  const allCandidates = [...(legacyCustomer ? [legacyCustomer] : []), ...globalCandidates];

  let credentialSource = allCandidates.find((candidate) => Boolean(candidate.passwordHash)) ?? null;
  if (credentialSource) {
    const validMatches = await Promise.all(allCandidates.map(async (candidate) => ({
      candidate,
      valid: Boolean(candidate.passwordHash) && await bcrypt.compare(body.password, candidate.passwordHash!)
    })));
    credentialSource = validMatches.find((entry) => entry.valid)?.candidate ?? null;
  }

  if (!credentialSource?.passwordHash) {
    return res.status(401).json({ message: "Credenciais invalidas" });
  }

  const valid = await bcrypt.compare(body.password, credentialSource.passwordHash);
  if (!valid) {
    return res.status(401).json({ message: "Credenciais invalidas" });
  }

  const globalCustomer = globalCandidates.find((candidate) => candidate.id === credentialSource?.id) ?? null;
  const legacyCustomerMatch = legacyCustomer?.id === credentialSource?.id ? legacyCustomer : null;
  const linked = await linkCustomerToCompany({
    companyId,
    name: globalCustomer?.name ?? legacyCustomerMatch?.name ?? body.identifier,
    phone: phone ?? legacyCustomerMatch?.phone ?? normalizePhone(body.identifier),
    email: globalCustomer?.email ?? legacyCustomerMatch?.email ?? email,
    passwordHash: credentialSource.passwordHash
  });

  const customer = await prisma.customer.upsert({
    where: { companyId_phone: { companyId, phone: phone ?? legacyCustomerMatch?.phone ?? normalizePhone(body.identifier) } },
    create: {
      companyId,
      globalCustomerId: linked.globalCustomer.id,
      companyCustomerId: linked.companyCustomer.id,
      name: linked.globalCustomer.name,
      phone: phone ?? legacyCustomerMatch?.phone ?? normalizePhone(body.identifier),
      email: linked.globalCustomer.email,
      passwordHash: credentialSource.passwordHash,
      address: legacyCustomerMatch?.address ?? "",
      number: legacyCustomerMatch?.number ?? "",
      district: legacyCustomerMatch?.district ?? "",
      complement: legacyCustomerMatch?.complement ?? null
    },
    update: {
      globalCustomerId: linked.globalCustomer.id,
      companyCustomerId: linked.companyCustomer.id,
      name: linked.globalCustomer.name,
      email: linked.globalCustomer.email,
      ...(legacyCustomerMatch?.address ? { address: legacyCustomerMatch.address } : {}),
      ...(legacyCustomerMatch?.number ? { number: legacyCustomerMatch.number } : {}),
      ...(legacyCustomerMatch?.district ? { district: legacyCustomerMatch.district } : {}),
      ...(legacyCustomerMatch?.complement !== undefined ? { complement: legacyCustomerMatch.complement } : {}),
      ...(credentialSource.passwordHash ? { passwordHash: credentialSource.passwordHash } : {}),
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
    email: z.string().email().optional(),
    phone: z.string().min(8).optional()
  });

  const body = schema.parse(req.body);

  const existing = await prisma.customer.findFirst({
    where: { id: customerId, ...companyWhere(req) },
    include: { globalCustomer: true }
  });
  if (!existing) return res.status(404).json({ message: "Cliente nao encontrado" });
  const nextPhone = body.phone ? normalizePhone(body.phone) : existing.phone;
  const nextEmail = body.email !== undefined ? normalizeEmail(body.email) : existing.email ?? null;

  if (body.phone) {
    const conflict = await prisma.globalCustomer.findFirst({
      where: {
        phone: nextPhone,
        NOT: { id: existing.globalCustomerId ?? undefined }
      }
    });
    if (conflict) {
      return res.status(400).json({ message: "Telefone ja cadastrado em outra conta" });
    }
  }

  const customer = await prisma.$transaction(async (tx) => {
    if (existing.globalCustomerId) {
      await tx.globalCustomer.update({
        where: { id: existing.globalCustomerId },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.phone !== undefined ? { phone: nextPhone, whatsapp: nextPhone } : {}),
          ...(body.email !== undefined ? { email: nextEmail } : {})
        }
      });
    }

    return tx.customer.update({
      where: { id: existing.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.phone !== undefined ? { phone: nextPhone } : {}),
        ...(body.email !== undefined ? { email: nextEmail } : {})
      }
    });
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

export async function lookupCustomerAccount(req: Request, res: Response) {
  const body = lookupSchema.parse(req.query);
  const phone = body.phone ? normalizePhone(body.phone) : null;
  const email = normalizeEmail(body.email);

  const [byPhone, byEmail, companyCustomer] = await Promise.all([
    phone ? prisma.globalCustomer.findUnique({ where: { phone } }) : Promise.resolve(null),
    email ? prisma.globalCustomer.findUnique({ where: { email } }) : Promise.resolve(null),
    phone || email
      ? prisma.customer.findFirst({
          where: {
            deletedAt: null,
            ...companyWhere(req),
            OR: [
              ...(phone ? [{ phone }] : []),
              ...(email ? [{ email }] : [])
            ]
          },
          select: { id: true, name: true, phone: true, email: true }
        })
      : Promise.resolve(null)
  ]);

  const account = companyCustomer || byPhone || byEmail;
  if (!account) {
    return res.json({ exists: false });
  }

  return res.json({
    exists: true,
    matchedBy: companyCustomer ? "companyCustomer" : byEmail ? "email" : "phone",
    account: {
      id: "id" in account ? account.id : null,
      name: account.name,
      phone: account.phone,
      email: account.email ?? null
    }
  });
}

export async function listCustomerTicketOrders(req: Request, res: Response) {
  const customerId = (req as any).customerId;
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, ...companyWhere(req) },
    select: { phone: true, companyId: true }
  });

  if (!customer) {
    return res.status(404).json({ message: "Cliente nao encontrado" });
  }

  const orders = await prisma.ticketOrder.findMany({
    where: {
      companyId: customer.companyId,
      customerPhone: customer.phone
    },
    include: {
      event: true,
      tickets: { include: { ticketType: true } }
    },
    orderBy: { createdAt: "desc" }
  });

  return res.json(orders.map((order) => ({
    id: order.id,
    total: Number(order.total),
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerEmail: order.customerEmail,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paidAt: order.paidAt,
    mercadoPago: {
      paymentId: order.mercadoPagoPaymentId,
      preferenceId: order.mercadoPagoPreferenceId,
      status: order.mercadoPagoStatus,
      statusDetail: order.mercadoPagoStatusDetail
    },
    event: {
      id: order.event.id,
      title: order.event.title,
      eventDate: order.event.eventDate,
      startTime: order.event.startTime,
      location: order.event.location
    },
    tickets: order.tickets.map((ticket) => ({
      id: ticket.id,
      code: ticket.code,
      qrCode: ticket.qrCode,
      status: ticket.status,
      ticketType: {
        id: ticket.ticketType.id,
        name: ticket.ticketType.name,
        audience: ticket.ticketType.audience
      }
    }))
  })));
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
