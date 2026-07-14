import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { getCompanyId } from "../utils/tenant.js";

const statusSchema = z.enum(["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "ENDED", "CANCELLED", "FINISHED"]);

const raffleSchema = z.object({
  title: z.string().trim().min(3, "Informe o titulo da rifa").max(120),
  description: z.string().trim().max(5000).optional().nullable(),
  regulation: z.string().trim().max(12000).optional().nullable(),
  prize: z.string().trim().max(180).optional().nullable(),
  status: statusSchema.default("DRAFT"),
  startsAt: z.coerce.date().optional().nullable(),
  endsAt: z.coerce.date().optional().nullable(),
  numberStart: z.coerce.number().int().min(0).default(0),
  numberEnd: z.coerce.number().int().min(1),
  numberDigits: z.coerce.number().int().min(1).max(8).default(2),
  pricePerNumber: z.coerce.number().min(0.01).max(999999),
  minimumQuantity: z.coerce.number().int().min(1).default(1),
  maximumQuantity: z.coerce.number().int().min(1).max(1000).default(10),
  participantLimit: z.coerce.number().int().min(1).optional().nullable(),
  featuredImageUrl: z.string().trim().url().optional().nullable().or(z.literal("")),
  videoUrl: z.string().trim().url().optional().nullable().or(z.literal(""))
});

const publicReserveSchema = z.object({
  numberIds: z.array(z.string().min(1)).min(1, "Selecione pelo menos um numero"),
  participant: z.object({
    name: z.string().trim().min(3, "Informe seu nome completo").max(120),
    phone: z.string().trim().min(8, "Informe seu WhatsApp").max(30),
    email: z.string().trim().email("Informe um e-mail valido").max(180),
    cpf: z.string().trim().max(20).optional().nullable(),
    password: z.string().min(6, "A senha deve ter pelo menos 6 digitos").max(72).optional().or(z.literal(""))
  })
});

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "rifa";
}

function formatNumber(number: number, digits: number) {
  return String(number).padStart(digits, "0");
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

async function releaseExpiredReservations(companyId: string, raffleId?: string) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const expiredOrders = await tx.raffleOrder.findMany({
      where: {
        companyId,
        ...(raffleId ? { raffleId } : {}),
        status: { in: ["RESERVED", "PENDING_PAYMENT"] },
        paymentStatus: "PENDING",
        reservationExpiresAt: { lt: now }
      },
      select: { id: true }
    });
    const expiredOrderIds = expiredOrders.map((order) => order.id);
    if (!expiredOrderIds.length) return;

    await tx.raffleNumber.updateMany({
      where: {
        companyId,
        orderId: { in: expiredOrderIds },
        status: { in: ["RESERVED", "PENDING_PAYMENT"] }
      },
      data: {
        status: "AVAILABLE",
        reservedByParticipantId: null,
        reservedUntil: null,
        orderId: null
      }
    });

    await tx.raffleOrder.updateMany({
      where: { id: { in: expiredOrderIds }, companyId },
      data: {
        status: "EXPIRED",
        paymentStatus: "CANCELLED",
        cancelledAt: now,
        cancelReason: "Reserva expirada automaticamente"
      }
    });
  });
}

async function uniqueRaffleSlug(companyId: string, title: string, excludeId?: string) {
  const base = slugify(title);
  let slug = base;
  let suffix = 2;
  while (await prisma.raffle.findFirst({
    where: {
      companyId,
      slug,
      ...(excludeId ? { id: { not: excludeId } } : {})
    },
    select: { id: true }
  })) {
    slug = `${base.slice(0, Math.max(1, 80 - String(suffix).length - 1))}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

function validateRaffleNumbers(data: z.infer<typeof raffleSchema>) {
  if (data.numberEnd < data.numberStart) {
    throw new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: ["numberEnd"],
      message: "O numero final deve ser maior ou igual ao numero inicial"
    }]);
  }
  const totalNumbers = data.numberEnd - data.numberStart + 1;
  if (totalNumbers > 50000) {
    throw new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: ["numberEnd"],
      message: "Nesta primeira fase, crie rifas com ate 50.000 numeros"
    }]);
  }
  if (data.maximumQuantity < data.minimumQuantity) {
    throw new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: ["maximumQuantity"],
      message: "A quantidade maxima deve ser maior ou igual a minima"
    }]);
  }
  if (data.startsAt && data.endsAt && data.endsAt <= data.startsAt) {
    throw new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: ["endsAt"],
      message: "A data de encerramento deve ser posterior ao inicio"
    }]);
  }
  return totalNumbers;
}

function serializeRaffle<T extends { pricePerNumber: Prisma.Decimal; _count?: Record<string, number> }>(raffle: T) {
  return {
    ...raffle,
    pricePerNumber: Number(raffle.pricePerNumber)
  };
}

export async function listAdminRaffles(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const raffles = await prisma.raffle.findMany({
    where: { companyId },
    include: {
      _count: {
        select: {
          numbers: true,
          orders: true,
          participants: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });
  return res.json(raffles.map(serializeRaffle));
}

export async function createAdminRaffle(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const body = raffleSchema.parse(req.body);
  const totalNumbers = validateRaffleNumbers(body);
  const slug = await uniqueRaffleSlug(companyId, body.title);

  const raffle = await prisma.$transaction(async (tx) => {
    const created = await tx.raffle.create({
      data: {
        companyId,
        slug,
        title: body.title,
        description: body.description || null,
        regulation: body.regulation || null,
        prize: body.prize || null,
        status: body.status,
        startsAt: body.startsAt ?? null,
        endsAt: body.endsAt ?? null,
        numberStart: body.numberStart,
        numberEnd: body.numberEnd,
        numberDigits: body.numberDigits,
        totalNumbers,
        pricePerNumber: new Prisma.Decimal(body.pricePerNumber),
        minimumQuantity: body.minimumQuantity,
        maximumQuantity: body.maximumQuantity,
        participantLimit: body.participantLimit ?? null,
        featuredImageUrl: body.featuredImageUrl || null,
        videoUrl: body.videoUrl || null,
        publishedAt: body.status === "ACTIVE" ? new Date() : null
      }
    });

    const batchSize = 1000;
    for (let start = body.numberStart; start <= body.numberEnd; start += batchSize) {
      const end = Math.min(body.numberEnd, start + batchSize - 1);
      await tx.raffleNumber.createMany({
        data: Array.from({ length: end - start + 1 }, (_, index) => {
          const number = start + index;
          return {
            companyId,
            raffleId: created.id,
            number,
            formattedNumber: formatNumber(number, body.numberDigits)
          };
        })
      });
    }

    await tx.raffleAuditLog.create({
      data: {
        companyId,
        raffleId: created.id,
        userId: req.user?.sub,
        userName: req.user?.sub,
        action: "RAFFLE_CREATED",
        entity: "Raffle",
        entityId: created.id,
        newValue: { title: created.title, totalNumbers: created.totalNumbers }
      }
    });

    return created;
  });

  return res.status(201).json(serializeRaffle(raffle));
}

export async function getAdminRaffle(req: Request, res: Response) {
  const raffle = await prisma.raffle.findFirst({
    where: { id: req.params.id, companyId: getCompanyId(req) },
    include: {
      _count: { select: { numbers: true, orders: true, participants: true } }
    }
  });
  if (!raffle) return res.status(404).json({ message: "Rifa nao encontrada" });
  return res.json(serializeRaffle(raffle));
}

export async function updateAdminRaffle(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const existing = await prisma.raffle.findFirst({ where: { id: req.params.id, companyId } });
  if (!existing) return res.status(404).json({ message: "Rifa nao encontrada" });

  const body = raffleSchema.partial().parse(req.body);
  const data: Prisma.RaffleUpdateInput = {
    ...(body.title ? { title: body.title, slug: await uniqueRaffleSlug(companyId, body.title, existing.id) } : {}),
    ...(body.description !== undefined ? { description: body.description || null } : {}),
    ...(body.regulation !== undefined ? { regulation: body.regulation || null } : {}),
    ...(body.prize !== undefined ? { prize: body.prize || null } : {}),
    ...(body.status ? { status: body.status, publishedAt: body.status === "ACTIVE" && !existing.publishedAt ? new Date() : existing.publishedAt } : {}),
    ...(body.startsAt !== undefined ? { startsAt: body.startsAt ?? null } : {}),
    ...(body.endsAt !== undefined ? { endsAt: body.endsAt ?? null } : {}),
    ...(body.pricePerNumber !== undefined ? { pricePerNumber: new Prisma.Decimal(body.pricePerNumber) } : {}),
    ...(body.minimumQuantity !== undefined ? { minimumQuantity: body.minimumQuantity } : {}),
    ...(body.maximumQuantity !== undefined ? { maximumQuantity: body.maximumQuantity } : {}),
    ...(body.participantLimit !== undefined ? { participantLimit: body.participantLimit ?? null } : {}),
    ...(body.featuredImageUrl !== undefined ? { featuredImageUrl: body.featuredImageUrl || null } : {}),
    ...(body.videoUrl !== undefined ? { videoUrl: body.videoUrl || null } : {})
  };

  const updated = await prisma.raffle.update({
    where: { id: existing.id },
    data
  });
  return res.json(serializeRaffle(updated));
}

export async function updateAdminRaffleStatus(req: Request, res: Response) {
  const body = z.object({ status: statusSchema }).parse(req.body);
  const raffle = await prisma.raffle.findFirst({ where: { id: req.params.id, companyId: getCompanyId(req) } });
  if (!raffle) return res.status(404).json({ message: "Rifa nao encontrada" });

  const updated = await prisma.raffle.update({
    where: { id: raffle.id },
    data: {
      status: body.status,
      publishedAt: body.status === "ACTIVE" && !raffle.publishedAt ? new Date() : raffle.publishedAt,
      finishedAt: body.status === "FINISHED" ? new Date() : raffle.finishedAt
    }
  });
  return res.json(serializeRaffle(updated));
}

export async function listPublicRaffles(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  await releaseExpiredReservations(companyId);
  const now = new Date();
  const raffles = await prisma.raffle.findMany({
    where: {
      companyId,
      status: "ACTIVE",
      OR: [{ startsAt: null }, { startsAt: { lte: now } }],
      AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: now } }] }]
    },
    include: {
      numbers: {
        select: { status: true }
      },
      company: {
        select: { tradeName: true, logoUrl: true, subdomain: true }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  return res.json(raffles.map((raffle) => {
    const paid = raffle.numbers.filter((number) => number.status === "PAID").length;
    const reserved = raffle.numbers.filter((number) => ["RESERVED", "PENDING_PAYMENT"].includes(number.status)).length;
    return {
      id: raffle.id,
      slug: raffle.slug,
      title: raffle.title,
      description: raffle.description,
      prize: raffle.prize,
      featuredImageUrl: raffle.featuredImageUrl,
      pricePerNumber: Number(raffle.pricePerNumber),
      totalNumbers: raffle.totalNumbers,
      paidNumbers: paid,
      reservedNumbers: reserved,
      availableNumbers: raffle.totalNumbers - paid - reserved,
      progressPercent: raffle.totalNumbers ? Math.round((paid / raffle.totalNumbers) * 100) : 0,
      endsAt: raffle.endsAt,
      company: raffle.company
    };
  }));
}

export async function getPublicRaffle(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const raffle = await prisma.raffle.findFirst({
    where: { companyId, slug: req.params.slug, status: { in: ["ACTIVE", "PAUSED", "ENDED", "FINISHED"] } },
    include: {
      company: { select: { tradeName: true, logoUrl: true, whatsapp: true, instagram: true } }
    }
  });
  if (!raffle) return res.status(404).json({ message: "Rifa nao encontrada" });
  return res.json(serializeRaffle(raffle));
}

export async function listPublicRaffleNumbers(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const raffle = await prisma.raffle.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
  if (!raffle) return res.status(404).json({ message: "Rifa nao encontrada" });
  await releaseExpiredReservations(companyId, raffle.id);
  const numbers = await prisma.raffleNumber.findMany({
    where: { raffleId: raffle.id, companyId },
    select: { id: true, number: true, formattedNumber: true, status: true, reservedUntil: true },
    orderBy: { number: "asc" }
  });
  return res.json(numbers);
}

export async function reservePublicRaffleNumbers(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const body = publicReserveSchema.parse(req.body);
  const now = new Date();
  const reservationExpiresAt = new Date(now.getTime() + 15 * 60 * 1000);

  await releaseExpiredReservations(companyId, req.params.id);

  const raffle = await prisma.raffle.findFirst({
    where: {
      id: req.params.id,
      companyId,
      status: "ACTIVE",
      OR: [{ startsAt: null }, { startsAt: { lte: now } }],
      AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: now } }] }]
    },
    select: {
      id: true,
      title: true,
      pricePerNumber: true,
      minimumQuantity: true,
      maximumQuantity: true
    }
  });
  if (!raffle) return res.status(404).json({ message: "Rifa nao encontrada ou indisponivel" });

  const uniqueNumberIds = Array.from(new Set(body.numberIds));
  if (uniqueNumberIds.length < raffle.minimumQuantity) {
    return res.status(400).json({ message: `Escolha pelo menos ${raffle.minimumQuantity} numero(s)` });
  }
  if (uniqueNumberIds.length > raffle.maximumQuantity) {
    return res.status(400).json({ message: `Escolha no maximo ${raffle.maximumQuantity} numero(s)` });
  }

  const phone = onlyDigits(body.participant.phone);
  const cpf = body.participant.cpf ? onlyDigits(body.participant.cpf) : null;
  const email = body.participant.email.toLowerCase();
  const passwordHash = body.participant.password ? await bcrypt.hash(body.participant.password, 10) : undefined;

  const order = await prisma.$transaction(async (tx) => {
    const numbers = await tx.raffleNumber.findMany({
      where: {
        id: { in: uniqueNumberIds },
        companyId,
        raffleId: raffle.id,
        status: "AVAILABLE"
      },
      select: { id: true, number: true, formattedNumber: true }
    });

    if (numbers.length !== uniqueNumberIds.length) {
      throw { statusCode: 400, message: "Um ou mais numeros ja foram reservados. Atualize a rifa e escolha novamente." };
    }

    const participant = await tx.raffleParticipant.upsert({
      where: {
        companyId_phone: {
          companyId,
          phone
        }
      },
      update: {
        name: body.participant.name,
        email,
        cpf,
        raffleId: raffle.id,
        ...(passwordHash ? { passwordHash } : {}),
        lastAccessAt: now
      },
      create: {
        companyId,
        raffleId: raffle.id,
        name: body.participant.name,
        phone,
        email,
        cpf,
        passwordHash: passwordHash ?? null,
        acceptedTermsAt: now,
        lastAccessAt: now
      }
    });

    const subtotal = new Prisma.Decimal(raffle.pricePerNumber).mul(numbers.length);
    const createdOrder = await tx.raffleOrder.create({
      data: {
        companyId,
        raffleId: raffle.id,
        participantId: participant.id,
        status: "RESERVED",
        paymentStatus: "PENDING",
        paymentMethod: "PENDING",
        subtotal,
        total: subtotal,
        reservationExpiresAt,
        items: {
          create: numbers.map((number) => ({
            companyId,
            raffleNumberId: number.id,
            number: number.number,
            formattedNumber: number.formattedNumber,
            price: raffle.pricePerNumber
          }))
        }
      },
      include: {
        items: true,
        participant: { select: { id: true, name: true, phone: true, email: true } }
      }
    });

    await tx.raffleNumber.updateMany({
      where: { id: { in: uniqueNumberIds }, companyId, raffleId: raffle.id, status: "AVAILABLE" },
      data: {
        status: "RESERVED",
        reservedByParticipantId: participant.id,
        reservedUntil: reservationExpiresAt,
        orderId: createdOrder.id
      }
    });

    return createdOrder;
  });

  return res.status(201).json({
    id: order.id,
    raffleId: order.raffleId,
    status: order.status,
    paymentStatus: order.paymentStatus,
    total: Number(order.total),
    reservationExpiresAt: order.reservationExpiresAt,
    participant: order.participant,
    numbers: order.items.map((item) => ({
      id: item.raffleNumberId,
      number: item.number,
      formattedNumber: item.formattedNumber,
      price: Number(item.price)
    }))
  });
}
