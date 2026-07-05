import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { companyWhere, getCompanyId } from "../utils/tenant.js";

const optionalText = z.preprocess(
  (value) => typeof value === "string" && !value.trim() ? null : value,
  z.string().trim().nullable().optional()
);

const serviceSchema = z.object({
  name: z.string().trim().min(2),
  description: optionalText,
  durationMin: z.coerce.number().int().min(5).max(600),
  price: z.coerce.number().min(0),
  active: z.boolean().default(true),
  popular: z.boolean().default(false)
});

const professionalSchema = z.object({
  name: z.string().trim().min(2),
  specialty: z.string().trim().min(2),
  avatarUrl: optionalText,
  bio: optionalText,
  rating: z.coerce.number().min(0).max(5).default(5),
  active: z.boolean().default(true)
});

const appointmentSchema = z.object({
  serviceId: z.string().min(1),
  professionalId: z.string().nullable().optional(),
  customerName: z.string().trim().min(2),
  customerPhone: z.string().trim().min(8),
  customerEmail: z.preprocess(
    (value) => typeof value === "string" && !value.trim() ? null : value,
    z.string().trim().email().nullable().optional()
  ),
  appointmentDate: z.coerce.date(),
  appointmentTime: z.string().trim().min(1),
  notes: optionalText
});

function serializeService<T extends { price?: Prisma.Decimal; rating?: Prisma.Decimal }>(item: T) {
  return {
    ...item,
    ...(item.price ? { price: Number(item.price) } : {}),
    ...(item.rating ? { rating: Number(item.rating) } : {})
  };
}

export async function listPublicServices(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const [services, professionals] = await Promise.all([
    prisma.service.findMany({ where: { companyId, active: true }, orderBy: [{ popular: "desc" }, { name: "asc" }] }),
    prisma.professional.findMany({ where: { companyId, active: true }, orderBy: [{ rating: "desc" }, { name: "asc" }] })
  ]);
  return res.json({
    services: services.map(serializeService),
    professionals: professionals.map(serializeService)
  });
}

export async function listAdminServices(req: Request, res: Response) {
  const [services, professionals, appointments] = await Promise.all([
    prisma.service.findMany({ where: companyWhere(req), orderBy: [{ popular: "desc" }, { name: "asc" }] }),
    prisma.professional.findMany({ where: companyWhere(req), orderBy: [{ rating: "desc" }, { name: "asc" }] }),
    prisma.appointment.findMany({
      where: companyWhere(req),
      include: { service: true, professional: true },
      orderBy: { createdAt: "desc" }
    })
  ]);
  return res.json({
    services: services.map(serializeService),
    professionals: professionals.map(serializeService),
    appointments: appointments.map((appointment) => ({
      ...appointment,
      total: Number(appointment.total)
    }))
  });
}

export async function createAdminService(req: Request, res: Response) {
  const body = serviceSchema.parse(req.body);
  const service = await prisma.service.create({
    data: { ...body, companyId: getCompanyId(req), price: new Prisma.Decimal(body.price) }
  });
  return res.status(201).json({ ...service, price: Number(service.price) });
}

export async function createAdminProfessional(req: Request, res: Response) {
  const body = professionalSchema.parse(req.body);
  const professional = await prisma.professional.create({
    data: { ...body, companyId: getCompanyId(req), rating: new Prisma.Decimal(body.rating) }
  });
  return res.status(201).json({ ...professional, rating: Number(professional.rating) });
}

export async function createPublicAppointment(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const body = appointmentSchema.parse(req.body);
  const service = await prisma.service.findFirst({ where: { id: body.serviceId, companyId, active: true } });
  if (!service) return res.status(404).json({ message: "Servico nao encontrado" });
  if (body.professionalId) {
    const professional = await prisma.professional.findFirst({ where: { id: body.professionalId, companyId, active: true } });
    if (!professional) return res.status(404).json({ message: "Profissional nao encontrado" });
  }
  const appointment = await prisma.appointment.create({
    data: {
      companyId,
      serviceId: service.id,
      professionalId: body.professionalId ?? null,
      customerName: body.customerName,
      customerPhone: body.customerPhone.replace(/\D/g, ""),
      customerEmail: body.customerEmail?.toLowerCase() ?? null,
      appointmentDate: body.appointmentDate,
      appointmentTime: body.appointmentTime,
      notes: body.notes,
      total: new Prisma.Decimal(service.price)
    }
  });
  return res.status(201).json({ ...appointment, total: Number(appointment.total) });
}
