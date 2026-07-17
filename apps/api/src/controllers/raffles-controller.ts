import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import { z } from "zod";
import { createMercadoPagoPixPayment, getMercadoPagoPayment, type MercadoPagoPaymentResponse } from "../services/mercadopago.js";
import {
  isSupportedRaffleCaixaModality,
  normalizeCaixaModality,
  SUPPORTED_RAFFLE_CAIXA_MODALITIES
} from "../services/caixa-lottery-service.js";
import { processAutomaticRaffleById } from "../services/raffle-draw-service.js";
import { env } from "../utils/env.js";
import { prisma } from "../utils/prisma.js";
import { getCompanyId } from "../utils/tenant.js";

const statusSchema = z.enum(["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "ENDED", "CANCELLED", "FINISHED"]);
const drawModeSchema = z.enum(["MANUAL", "AUTOMATIC_CAIXA"]);

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
  reservationMinutes: z.coerce.number().int().min(5, "A reserva precisa ter pelo menos 5 minutos").max(1440, "A reserva pode ter no maximo 24 horas").default(15),
  participantLimit: z.coerce.number().int().min(1).optional().nullable(),
  featuredImageUrl: z.string().trim().url().optional().nullable().or(z.literal("")),
  videoUrl: z.string().trim().url().optional().nullable().or(z.literal("")),
  videoUrls: z.array(z.string().trim().url()).max(5, "Informe no maximo 5 videos").optional(),
  drawMode: drawModeSchema.default("MANUAL"),
  drawLotteryModality: z.string().trim().max(40).optional().nullable().or(z.literal("")),
  drawContestNumber: z.string().trim().max(20).optional().nullable().or(z.literal("")),
  drawScheduledAt: z.coerce.date().optional().nullable()
});

const publicReserveSchema = z.object({
  numberIds: z.array(z.string().min(1)).min(1, "Selecione pelo menos um numero"),
  participant: z.object({
    name: z.string().trim().min(3, "Informe seu nome completo").max(120),
    phone: z.string().trim().min(8, "Informe seu WhatsApp").max(30),
    email: z.string().trim().email("Informe um e-mail valido").max(180),
    cpf: z.string().trim().max(20).optional().nullable(),
    password: z.string().min(6, "Crie uma senha com pelo menos 6 digitos").max(72).optional().or(z.literal(""))
  })
});

const raffleParticipantLoginSchema = z.object({
  login: z.string().trim().min(3, "Informe e-mail ou WhatsApp"),
  password: z.string().min(6, "Informe sua senha")
});

const raffleParticipantRegisterSchema = z.object({
  name: z.string().trim().min(3, "Informe seu nome completo").max(120),
  phone: z.string().trim().min(8, "Informe seu WhatsApp").max(30),
  email: z.string().trim().email("Informe um e-mail valido").max(180),
  cpf: z.string().trim().max(20).optional().nullable(),
  password: z.string().min(6, "Crie uma senha com pelo menos 6 digitos").max(72)
});

const DEFAULT_RAFFLE_RESERVATION_MINUTES = 15;

function getRaffleReservationExpiresAt(baseDate = new Date(), minutes = DEFAULT_RAFFLE_RESERVATION_MINUTES) {
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_RAFFLE_RESERVATION_MINUTES;
  return new Date(baseDate.getTime() + safeMinutes * 60 * 1000);
}

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

function requestBaseUrl(req: Request) {
  const proto = req.get("x-forwarded-proto")?.split(",")[0] || req.protocol || "https";
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}`;
}

function rafflePaymentStatus(status?: string | null) {
  if (status === "approved") return "APPROVED";
  if (["cancelled", "canceled"].includes(status ?? "")) return "CANCELLED";
  if (["rejected"].includes(status ?? "")) return "REJECTED";
  if (status === "refunded") return "REFUNDED";
  return "PENDING";
}

function signRaffleParticipantToken(participant: { id: string; companyId: string; phone: string; email: string | null }) {
  return jwt.sign(
    {
      type: "RAFFLE_PARTICIPANT",
      raffleParticipantId: participant.id,
      companyId: participant.companyId,
      phone: participant.phone,
      email: participant.email
    },
    env.jwtSecret,
    { subject: participant.id, expiresIn: "30d" }
  );
}

function getRaffleParticipantPayload(req: Request) {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const payload = jwt.verify(header.slice(7), env.jwtSecret) as {
      type?: string;
      raffleParticipantId?: string;
      companyId?: string;
    };
    if (payload.type !== "RAFFLE_PARTICIPANT" || !payload.raffleParticipantId || payload.companyId !== getCompanyId(req)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function serializeRaffleOrderForParticipant(order: {
  id: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  total: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  paidAt: Date | null;
  reservationExpiresAt: Date | null;
  createdAt: Date;
  pixQrCode: string | null;
  pixCopiaCola: string | null;
  mercadoPagoPaymentId: string | null;
  raffle: { id: string; title: string; slug: string; prize: string | null; featuredImageUrl: string | null; endsAt: Date | null };
  items: Array<{ id: string; formattedNumber: string; number: number; price: Prisma.Decimal }>;
  payments: Array<{ providerPaymentId: string | null; method: string | null; status: string; createdAt: Date; processedAt: Date | null }>;
}) {
  return {
    id: order.id,
    raffle: {
      id: order.raffle.id,
      title: order.raffle.title,
      slug: order.raffle.slug,
      prize: order.raffle.prize,
      featuredImageUrl: order.raffle.featuredImageUrl,
      endsAt: order.raffle.endsAt
    },
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    total: Number(order.total),
    subtotal: Number(order.subtotal),
    paidAt: order.paidAt,
    reservationExpiresAt: order.reservationExpiresAt,
    createdAt: order.createdAt,
    pixQrCode: order.paymentStatus === "PENDING" ? order.pixQrCode : null,
    pixCopiaCola: order.paymentStatus === "PENDING" ? order.pixCopiaCola : null,
    mercadoPagoPaymentId: order.mercadoPagoPaymentId,
    numbers: order.items.map((item) => ({
      id: item.id,
      number: item.number,
      formattedNumber: item.formattedNumber,
      price: Number(item.price)
    })),
    latestPayment: order.payments[0]
      ? {
          providerPaymentId: order.payments[0].providerPaymentId,
          method: order.payments[0].method,
          status: order.payments[0].status,
          createdAt: order.payments[0].createdAt,
          processedAt: order.payments[0].processedAt
        }
      : null
  };
}

export async function applyApprovedRafflePayment(orderId: string, payment: MercadoPagoPaymentResponse) {
  const order = await prisma.raffleOrder.findUnique({
    where: { id: orderId },
    include: { payments: true }
  });
  if (!order) return null;

  const mappedStatus = rafflePaymentStatus(payment.status);
  const approved = mappedStatus === "APPROVED";
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const updated = await tx.raffleOrder.update({
      where: { id: order.id },
      data: {
        mercadoPagoPaymentId: String(payment.id),
        paymentStatus: mappedStatus,
        paymentMethod: "MERCADO_PAGO",
        ...(approved
          ? {
              status: "PAID",
              paidAt: order.paidAt ?? now,
              reservationExpiresAt: null
            }
          : {})
      }
    });

    if (approved) {
      await tx.raffleNumber.updateMany({
        where: { companyId: order.companyId, orderId: order.id },
        data: {
          status: "PAID",
          paidAt: now,
          reservedUntil: null
        }
      });
    }

    const existingPayment = order.payments.find((item) => item.providerPaymentId === String(payment.id));
    if (existingPayment) {
      await tx.rafflePayment.update({
        where: { id: existingPayment.id },
        data: {
          status: mappedStatus,
          method: payment.payment_method_id ?? payment.payment_type_id ?? existingPayment.method,
          payload: payment as unknown as Prisma.InputJsonValue,
          processedAt: approved ? now : existingPayment.processedAt
        }
      });
    } else {
      await tx.rafflePayment.create({
        data: {
          companyId: order.companyId,
          raffleId: order.raffleId,
          orderId: order.id,
          provider: "MERCADO_PAGO",
          providerPaymentId: String(payment.id),
          method: payment.payment_method_id ?? payment.payment_type_id ?? "pix",
          status: mappedStatus,
          amount: order.total,
          payload: payment as unknown as Prisma.InputJsonValue,
          processedAt: approved ? now : null
        }
      });
    }

    return updated;
  });
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

    await tx.rafflePayment.updateMany({
      where: {
        companyId,
        orderId: { in: expiredOrderIds },
        status: "PENDING"
      },
      data: {
        status: "CANCELLED",
        processedAt: now
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

type RaffleDrawInput = Pick<
  z.infer<typeof raffleSchema>,
  "drawMode" | "drawLotteryModality" | "drawContestNumber" | "drawScheduledAt"
>;

function hasDrawPayload(data: Partial<RaffleDrawInput>) {
  return (
    data.drawMode !== undefined ||
    data.drawLotteryModality !== undefined ||
    data.drawContestNumber !== undefined ||
    data.drawScheduledAt !== undefined
  );
}

function normalizeDrawContestNumber(value?: string | null) {
  const digits = onlyDigits(String(value ?? ""));
  return digits || null;
}

function raffleDrawValidationError(path: string, message: string) {
  return new z.ZodError([{
    code: z.ZodIssueCode.custom,
    path: [path],
    message
  }]);
}

function buildRaffleDrawData(
  input: Partial<RaffleDrawInput>,
  existing?: {
    drawMode: string;
    drawLotteryModality: string | null;
    drawContestNumber: string | null;
    drawScheduledAt: Date | null;
  }
) {
  const mode = input.drawMode ?? existing?.drawMode ?? "MANUAL";
  if (mode !== "AUTOMATIC_CAIXA") {
    return {
      drawMode: "MANUAL" as const,
      drawStatus: "MANUAL" as const,
      drawLotteryModality: null,
      drawContestNumber: null,
      drawScheduledAt: null,
      drawLastAttemptAt: null,
      drawAttemptCount: 0,
      drawLastError: null,
      drawBaseNumber: null,
      drawDigits: null,
      drawWinningNumber: null,
      drawOfficialDate: null,
      drawConfirmedAt: null,
      drawWinnerParticipantId: null,
      drawWinnerOrderId: null,
      drawWinnerNumberId: null,
      drawRawResponse: Prisma.JsonNull
    };
  }

  const modality = normalizeCaixaModality(input.drawLotteryModality || existing?.drawLotteryModality || "federal");
  if (!isSupportedRaffleCaixaModality(modality)) {
    throw raffleDrawValidationError(
      "drawLotteryModality",
      `No momento, a apuracao automatica esta disponivel apenas para: ${SUPPORTED_RAFFLE_CAIXA_MODALITIES.join(", ")}.`
    );
  }

  const scheduledAt = input.drawScheduledAt ?? existing?.drawScheduledAt ?? null;
  if (!scheduledAt) {
    throw raffleDrawValidationError("drawScheduledAt", "Informe a data e o horario previstos do sorteio.");
  }

  const contestNumber = normalizeDrawContestNumber(input.drawContestNumber ?? existing?.drawContestNumber);
  return {
    drawMode: "AUTOMATIC_CAIXA" as const,
    drawLotteryModality: modality,
    drawContestNumber: contestNumber,
    drawScheduledAt: scheduledAt,
    drawStatus: contestNumber ? ("SCHEDULED" as const) : ("WAITING_CONTEST" as const),
    drawLastAttemptAt: null,
    drawAttemptCount: 0,
    drawLastError: null,
    drawBaseNumber: null,
    drawDigits: null,
    drawWinningNumber: null,
    drawOfficialDate: null,
    drawConfirmedAt: null,
    drawWinnerParticipantId: null,
    drawWinnerOrderId: null,
    drawWinnerNumberId: null,
    drawRawResponse: Prisma.JsonNull
  };
}

function normalizeRaffleVideoUrls(videoUrls?: string[] | null, fallback?: string | null) {
  const values = [...(videoUrls ?? []), ...(fallback ? [fallback] : [])]
    .map((url) => url.trim())
    .filter(Boolean);
  return Array.from(new Set(values)).slice(0, 5);
}

function getRaffleVideoUrls(raffle: { videoUrl?: string | null; media?: Array<{ type: string; url: string; sortOrder: number }> }) {
  const mediaVideos = Array.isArray(raffle.media)
    ? raffle.media
        .filter((item) => item.type === "VIDEO")
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item) => item.url)
    : [];
  return mediaVideos.length ? mediaVideos : raffle.videoUrl ? [raffle.videoUrl] : [];
}

function serializeRaffle<T extends { pricePerNumber: Prisma.Decimal; videoUrl?: string | null; media?: Array<{ type: string; url: string; sortOrder: number }>; _count?: Record<string, number> }>(raffle: T) {
  return {
    ...raffle,
    videoUrls: getRaffleVideoUrls(raffle),
    pricePerNumber: Number(raffle.pricePerNumber),
    reservationMinutes: "reservationMinutes" in raffle && typeof raffle.reservationMinutes === "number"
      ? raffle.reservationMinutes
      : DEFAULT_RAFFLE_RESERVATION_MINUTES
  };
}

export async function listAdminRaffles(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  await releaseExpiredReservations(companyId);
  const raffles = await prisma.raffle.findMany({
    where: { companyId },
    include: {
      media: { select: { type: true, url: true, sortOrder: true }, orderBy: { sortOrder: "asc" } },
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

export async function listAdminRaffleOrders(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  await releaseExpiredReservations(companyId);

  const orders = await prisma.raffleOrder.findMany({
    where: { companyId },
    include: {
      raffle: { select: { id: true, title: true, slug: true } },
      participant: { select: { name: true, phone: true, email: true } },
      items: { select: { formattedNumber: true, price: true }, orderBy: { number: "asc" } },
      payments: { select: { provider: true, providerPaymentId: true, method: true, status: true, processedAt: true }, orderBy: { createdAt: "desc" }, take: 1 }
    },
    orderBy: { createdAt: "desc" },
    take: 80
  });

  return res.json(orders.map((order) => ({
    id: order.id,
    raffle: order.raffle,
    participant: order.participant,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    mercadoPagoPaymentId: order.mercadoPagoPaymentId,
    total: Number(order.total),
    reservationExpiresAt: order.reservationExpiresAt,
    paidAt: order.paidAt,
    cancelledAt: order.cancelledAt,
    cancelReason: order.cancelReason,
    createdAt: order.createdAt,
    numbers: order.items.map((item) => ({
      formattedNumber: item.formattedNumber,
      price: Number(item.price)
    })),
    lastPayment: order.payments[0] ?? null
  })));
}

export async function createAdminRaffle(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const body = raffleSchema.parse(req.body);
  const totalNumbers = validateRaffleNumbers(body);
  const slug = await uniqueRaffleSlug(companyId, body.title);
  const videoUrls = normalizeRaffleVideoUrls(body.videoUrls, body.videoUrl);
  const drawData = buildRaffleDrawData(body);

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
        reservationMinutes: body.reservationMinutes,
        participantLimit: body.participantLimit ?? null,
        featuredImageUrl: body.featuredImageUrl || null,
        videoUrl: videoUrls[0] ?? null,
        ...drawData,
        publishedAt: body.status === "ACTIVE" ? new Date() : null
      }
    });

    if (videoUrls.length) {
      await tx.raffleMedia.createMany({
        data: videoUrls.map((url, index) => ({
          companyId,
          raffleId: created.id,
          type: "VIDEO",
          url,
          sortOrder: index
        }))
      });
    }

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

    return tx.raffle.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        media: { select: { type: true, url: true, sortOrder: true }, orderBy: { sortOrder: "asc" } }
      }
    });
  });

  return res.status(201).json(serializeRaffle(raffle));
}

export async function getAdminRaffle(req: Request, res: Response) {
  const raffle = await prisma.raffle.findFirst({
    where: { id: req.params.id, companyId: getCompanyId(req) },
    include: {
      media: { select: { type: true, url: true, sortOrder: true }, orderBy: { sortOrder: "asc" } },
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
  if (hasDrawPayload(body) && existing.drawStatus === "CONFIRMED") {
    return res.status(409).json({
      message: "Resultado automatico ja confirmado. Use uma correcao manual auditada para alterar a apuracao."
    });
  }
  const shouldReplaceVideos = body.videoUrls !== undefined || body.videoUrl !== undefined;
  const videoUrls = shouldReplaceVideos ? normalizeRaffleVideoUrls(body.videoUrls, body.videoUrl) : [];
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
    ...(body.reservationMinutes !== undefined ? { reservationMinutes: body.reservationMinutes } : {}),
    ...(body.participantLimit !== undefined ? { participantLimit: body.participantLimit ?? null } : {}),
    ...(body.featuredImageUrl !== undefined ? { featuredImageUrl: body.featuredImageUrl || null } : {}),
    ...(shouldReplaceVideos ? { videoUrl: videoUrls[0] ?? null } : {})
  };
  if (hasDrawPayload(body)) {
    Object.assign(data, buildRaffleDrawData(body, existing));
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.raffle.update({
      where: { id: existing.id },
      data
    });
    if (shouldReplaceVideos) {
      await tx.raffleMedia.deleteMany({ where: { companyId, raffleId: existing.id, type: "VIDEO" } });
      if (videoUrls.length) {
        await tx.raffleMedia.createMany({
          data: videoUrls.map((url, index) => ({
            companyId,
            raffleId: existing.id,
            type: "VIDEO",
            url,
            sortOrder: index
          }))
        });
      }
    }
    return tx.raffle.findUniqueOrThrow({
      where: { id: existing.id },
      include: {
        media: { select: { type: true, url: true, sortOrder: true }, orderBy: { sortOrder: "asc" } }
      }
    });
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

export async function retryAdminRaffleDraw(req: Request, res: Response) {
  const result = await processAutomaticRaffleById(req.params.id, getCompanyId(req));
  return res.json(result);
}

export async function loginRaffleParticipant(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const body = raffleParticipantLoginSchema.parse(req.body);
  const rawLogin = body.login.toLowerCase();
  const phone = onlyDigits(body.login);

  const participant = await prisma.raffleParticipant.findFirst({
    where: {
      companyId,
      OR: [
        ...(phone.length >= 8 ? [{ phone }] : []),
        { email: rawLogin }
      ]
    }
  });

  if (!participant?.passwordHash) {
    return res.status(401).json({ message: "Cadastro nao encontrado ou sem senha. Use o WhatsApp/e-mail usado na compra." });
  }

  const valid = await bcrypt.compare(body.password, participant.passwordHash);
  if (!valid) {
    return res.status(401).json({ message: "Credenciais invalidas" });
  }

  const updated = await prisma.raffleParticipant.update({
    where: { id: participant.id },
    data: { lastAccessAt: new Date() }
  });

  return res.json({
    token: signRaffleParticipantToken(updated),
    participant: {
      id: updated.id,
      name: updated.name,
      phone: updated.phone,
      email: updated.email,
      cpf: updated.cpf
    }
  });
}

export async function registerRaffleParticipant(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const body = raffleParticipantRegisterSchema.parse(req.body);
  const phone = onlyDigits(body.phone);
  const email = body.email.toLowerCase();
  const cpf = body.cpf ? onlyDigits(body.cpf) : null;

  const existingParticipants = await prisma.raffleParticipant.findMany({
    where: {
      companyId,
      OR: [
        { phone },
        { email }
      ]
    },
    orderBy: { createdAt: "asc" },
    take: 5
  });

  const accountWithPassword = existingParticipants.find((participant) => Boolean(participant.passwordHash));
  if (accountWithPassword) {
    return res.status(409).json({
      code: "RAFFLE_ACCOUNT_EXISTS",
      message: "Ja existe um cadastro com este e-mail ou telefone. Faca login para acessar suas rifas."
    });
  }

  const passwordHash = await bcrypt.hash(body.password, 10);
  const now = new Date();
  const participantToUpgrade = existingParticipants.find((participant) => participant.phone === phone) ?? existingParticipants[0];

  const participant = participantToUpgrade
    ? await prisma.raffleParticipant.update({
        where: { id: participantToUpgrade.id },
        data: {
          name: body.name,
          phone,
          email,
          cpf,
          passwordHash,
          acceptedTermsAt: participantToUpgrade.acceptedTermsAt ?? now,
          lastAccessAt: now
        }
      })
    : await prisma.raffleParticipant.create({
        data: {
          companyId,
          name: body.name,
          phone,
          email,
          cpf,
          passwordHash,
          acceptedTermsAt: now,
          lastAccessAt: now
        }
      });

  return res.status(participantToUpgrade ? 200 : 201).json({
    token: signRaffleParticipantToken(participant),
    participant: {
      id: participant.id,
      name: participant.name,
      phone: participant.phone,
      email: participant.email,
      cpf: participant.cpf
    }
  });
}

export async function getRaffleParticipantAccount(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const payload = getRaffleParticipantPayload(req);
  if (!payload) {
    return res.status(401).json({ message: "Faça login para acessar suas rifas" });
  }

  await releaseExpiredReservations(companyId);

  const participant = await prisma.raffleParticipant.findFirst({
    where: { id: payload.raffleParticipantId, companyId },
    select: { id: true, name: true, phone: true, email: true, cpf: true, lastAccessAt: true, createdAt: true }
  });
  if (!participant) return res.status(404).json({ message: "Participante nao encontrado" });

  const orders = await prisma.raffleOrder.findMany({
    where: {
      companyId,
      participantId: participant.id,
      status: { notIn: ["EXPIRED", "CANCELLED"] }
    },
    include: {
      raffle: {
        select: {
          id: true,
          title: true,
          slug: true,
          prize: true,
          featuredImageUrl: true,
          endsAt: true
        }
      },
      items: { orderBy: { number: "asc" } },
      payments: { orderBy: { createdAt: "desc" }, take: 1 }
    },
    orderBy: { createdAt: "desc" },
    take: 100
  });

  const winnerNumberIds = orders.flatMap((order) => order.items.map((item) => item.raffleNumberId));
  const winners = await prisma.raffleWinner.findMany({
    where: {
      companyId,
      published: true,
      OR: [
        { participantPhone: participant.phone },
        ...(winnerNumberIds.length ? [{ raffleNumberId: { in: winnerNumberIds } }] : [])
      ]
    },
    include: { raffle: { select: { id: true, title: true, slug: true, prize: true } } },
    orderBy: { drawnAt: "desc" }
  });

  return res.json({
    participant,
    orders: orders.map(serializeRaffleOrderForParticipant),
    winners: winners.map((winner) => ({
      id: winner.id,
      raffleId: winner.raffleId,
      raffleTitle: winner.raffle.title,
      raffleSlug: winner.raffle.slug,
      prize: winner.raffle.prize,
      number: winner.number,
      formattedNumber: winner.formattedNumber,
      participantName: winner.participantName,
      participantPhone: winner.participantPhone,
      proofUrl: winner.proofUrl,
      notes: winner.notes,
      drawnAt: winner.drawnAt
    }))
  });
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
      media: { select: { type: true, url: true, sortOrder: true }, orderBy: { sortOrder: "asc" } },
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
      videoUrl: raffle.videoUrl,
      videoUrls: getRaffleVideoUrls(raffle),
      pricePerNumber: Number(raffle.pricePerNumber),
      reservationMinutes: raffle.reservationMinutes,
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
      media: { select: { type: true, url: true, sortOrder: true }, orderBy: { sortOrder: "asc" } },
      company: { select: { tradeName: true, logoUrl: true, whatsapp: true, instagram: true } }
    }
  });
  if (!raffle) return res.status(404).json({ message: "Rifa nao encontrada" });
  return res.json(serializeRaffle(raffle));
}

export async function listPublicRaffleNumbers(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const raffle = await prisma.raffle.findFirst({
    where: { id: req.params.id, companyId },
    select: { id: true, drawStatus: true, drawWinningNumber: true }
  });
  if (!raffle) return res.status(404).json({ message: "Rifa nao encontrada" });
  await releaseExpiredReservations(companyId, raffle.id);
  const numbers = await prisma.raffleNumber.findMany({
    where: { raffleId: raffle.id, companyId },
    select: { id: true, number: true, formattedNumber: true, status: true, reservedUntil: true },
    orderBy: { number: "asc" }
  });
  return res.json(numbers.map((number) => ({
    ...number,
    isWinningNumber: ["CONFIRMED", "NO_VALID_PARTICIPANT"].includes(raffle.drawStatus) &&
      number.formattedNumber === raffle.drawWinningNumber
  })));
}

export async function reservePublicRaffleNumbers(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const body = publicReserveSchema.parse(req.body);
  const now = new Date();

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
      maximumQuantity: true,
      reservationMinutes: true
    }
  });
  if (!raffle) return res.status(404).json({ message: "Rifa nao encontrada ou indisponivel" });
  const reservationExpiresAt = getRaffleReservationExpiresAt(now, raffle.reservationMinutes);

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
  const existingParticipants = await prisma.raffleParticipant.findMany({
    where: {
      companyId,
      OR: [
        { phone },
        { email }
      ]
    },
    select: { id: true, passwordHash: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 10
  });
  const participantPayload = getRaffleParticipantPayload(req);
  const authenticatedParticipant = participantPayload?.companyId === companyId
    ? existingParticipants.find((participant) => participant.id === participantPayload.raffleParticipantId)
    : null;
  const accountWithPassword = existingParticipants.find((participant) => Boolean(participant.passwordHash));
  const existingParticipant = authenticatedParticipant ?? accountWithPassword ?? existingParticipants[0] ?? null;
  const isAuthenticatedParticipant = Boolean(authenticatedParticipant);

  if (accountWithPassword && !isAuthenticatedParticipant) {
    return res.status(409).json({
      message: "Ja existe um cadastro com este e-mail ou telefone. Faça login em Minha conta para continuar sua compra.",
      code: "RAFFLE_ACCOUNT_EXISTS"
    });
  }

  if (!existingParticipant?.passwordHash && !body.participant.password) {
    return res.status(400).json({ message: "Crie uma senha com pelo menos 6 digitos para acessar suas rifas depois." });
  }

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

    const participant = existingParticipant
      ? await tx.raffleParticipant.update({
          where: { id: existingParticipant.id },
          data: {
            name: body.participant.name,
            phone,
            email,
            cpf,
            raffleId: raffle.id,
            ...(passwordHash ? { passwordHash } : {}),
            lastAccessAt: now
          }
        })
      : await tx.raffleParticipant.create({
          data: {
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
    token: order.participant ? signRaffleParticipantToken({ ...order.participant, companyId }) : null,
    participant: order.participant,
    numbers: order.items.map((item) => ({
      id: item.raffleNumberId,
      number: item.number,
      formattedNumber: item.formattedNumber,
      price: Number(item.price)
    }))
  });
}

export async function createRaffleMercadoPagoPix(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const { orderId } = z.object({ orderId: z.string().min(1) }).parse(req.params);
  await releaseExpiredReservations(companyId);

  const order = await prisma.raffleOrder.findFirst({
    where: { id: orderId, companyId },
    include: {
      company: true,
      raffle: true,
      participant: true,
      items: true,
      payments: { orderBy: { createdAt: "desc" } }
    }
  });

  if (!order) return res.status(404).json({ message: "Reserva nao encontrada" });
  if (order.status === "PAID") return res.status(400).json({ message: "Esta reserva ja esta paga" });
  if (["CANCELLED", "EXPIRED", "REFUNDED"].includes(order.status)) {
    return res.status(400).json({ message: "Esta reserva nao pode ser paga" });
  }
  if (order.reservationExpiresAt && order.reservationExpiresAt < new Date()) {
    await releaseExpiredReservations(companyId, order.raffleId);
    return res.status(400).json({ message: "Reserva expirada. Escolha os numeros novamente." });
  }
  if (!order.company.mercadoPagoEnabled || !order.company.mercadoPagoAccessToken) {
    return res.status(400).json({ message: "Mercado Pago nao configurado para esta empresa" });
  }

  const existingPaymentId = order.mercadoPagoPaymentId || order.payments.find((payment) => payment.providerPaymentId)?.providerPaymentId;
  if (existingPaymentId && order.pixCopiaCola) {
    return res.status(200).json({
      orderId: order.id,
      paymentId: existingPaymentId,
      status: order.paymentStatus,
      qrCode: order.pixCopiaCola,
      qrCodeBase64: order.pixQrCode,
      reservationExpiresAt: order.reservationExpiresAt,
      paid: Boolean(order.paidAt)
    });
  }

  const payment = await createMercadoPagoPixPayment({
    accessToken: order.company.mercadoPagoAccessToken,
    orderId: `raffle:${order.id}`,
    companyId: order.companyId,
    orderNumber: Number(order.createdAt.getTime().toString().slice(-8)),
    description: `${order.company.tradeName} - Rifa ${order.raffle.title}`,
    amount: Number(order.total),
    payer: {
      name: order.participant.name,
      email: order.participant.email || `rifa-${order.id}@${env.rootDomain}`,
      phone: order.participant.phone
    },
    notificationUrl: `${requestBaseUrl(req)}/api/mercadopago/webhook`
  });

  const transactionData = payment.point_of_interaction?.transaction_data;
  const mappedStatus = rafflePaymentStatus(payment.status);

  await prisma.$transaction(async (tx) => {
    await tx.raffleOrder.update({
      where: { id: order.id },
      data: {
        status: "PENDING_PAYMENT",
        paymentMethod: "MERCADO_PAGO",
        paymentStatus: mappedStatus,
        mercadoPagoPaymentId: String(payment.id),
        pixCopiaCola: transactionData?.qr_code ?? null,
        pixQrCode: transactionData?.qr_code_base64 ?? null
      }
    });

    await tx.raffleNumber.updateMany({
      where: { companyId, orderId: order.id, status: "RESERVED" },
      data: { status: "PENDING_PAYMENT" }
    });

    await tx.rafflePayment.create({
      data: {
        companyId,
        raffleId: order.raffleId,
        orderId: order.id,
        provider: "MERCADO_PAGO",
        providerPaymentId: String(payment.id),
        method: payment.payment_method_id ?? payment.payment_type_id ?? "pix",
        status: mappedStatus,
        amount: order.total,
        payload: payment as unknown as Prisma.InputJsonValue
      }
    });
  });

  return res.status(201).json({
    orderId: order.id,
    paymentId: String(payment.id),
    status: mappedStatus,
    qrCode: transactionData?.qr_code ?? null,
    qrCodeBase64: transactionData?.qr_code_base64 ?? null,
    ticketUrl: transactionData?.ticket_url ?? null,
    reservationExpiresAt: order.reservationExpiresAt,
    paid: mappedStatus === "APPROVED"
  });
}

export async function getRaffleMercadoPagoStatus(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const { orderId } = z.object({ orderId: z.string().min(1) }).parse(req.params);
  await releaseExpiredReservations(companyId);

  const order = await prisma.raffleOrder.findFirst({
    where: { id: orderId, companyId },
    include: { company: true, payments: { orderBy: { createdAt: "desc" } } }
  });
  if (!order) return res.status(404).json({ message: "Reserva nao encontrada" });

  let current = order;
  const paymentId = order.mercadoPagoPaymentId || order.payments.find((payment) => payment.providerPaymentId)?.providerPaymentId;
  if (paymentId && !order.paidAt && order.company.mercadoPagoAccessToken) {
    const payment = await getMercadoPagoPayment(order.company.mercadoPagoAccessToken, paymentId);
    const updated = await applyApprovedRafflePayment(order.id, payment);
    if (updated) {
      current = { ...order, ...updated };
    }
  }

  return res.json({
    orderId: current.id,
    status: current.status,
    paymentStatus: current.paymentStatus,
    paid: Boolean(current.paidAt),
    paidAt: current.paidAt,
    reservationExpiresAt: current.reservationExpiresAt
  });
}
