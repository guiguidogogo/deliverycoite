import { randomInt } from "node:crypto";
import type { Request, Response } from "express";
import QRCode from "qrcode";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { env } from "../utils/env.js";
import { decryptIptvValue, encryptIptvValue, hashOpaqueValue } from "../utils/iptv-security.js";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const credentialsSchema = z.object({
  server: z.string().trim().url("Informe a URL completa do servidor IPTV").max(500),
  username: z.string().trim().min(1, "Informe o usuario IPTV").max(200),
  password: z.string().min(1, "Informe a senha IPTV").max(300)
});

const createSubscriptionSchema = z.object({
  companyId: z.string().trim().min(1),
  durationDays: z.coerce.number().int().min(1).max(3650).nullable().optional(),
  maxDevices: z.coerce.number().int().min(1).max(20).default(1),
  credentials: credentialsSchema
});

const updateSubscriptionSchema = z.object({
  active: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  durationDays: z.coerce.number().int().min(1).max(3650).nullable().optional(),
  maxDevices: z.coerce.number().int().min(1).max(20).optional(),
  credentials: credentialsSchema.optional()
});

const deviceSchema = z.object({ deviceId: z.string().trim().min(4).max(256) });
const activateSchema = z.object({ activationCode: z.string().trim().min(8).max(32) });

function randomCode(length: number) {
  return Array.from({ length }, () => alphabet[randomInt(0, alphabet.length)]).join("");
}

function activationDisplay(value: string) {
  return value.match(/.{1,4}/g)?.join("-") ?? value;
}

function normalizeCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function expiresFromDays(days?: number | null) {
  if (days == null) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function subscriptionStatus(subscription: { active: boolean; startsAt: Date; expiresAt: Date | null }) {
  const now = Date.now();
  if (!subscription.active) return "inactive";
  if (subscription.startsAt.getTime() > now) return "scheduled";
  if (subscription.expiresAt && subscription.expiresAt.getTime() <= now) return "expired";
  return "active";
}

function publicSubscription(subscription: any) {
  return {
    id: subscription.id,
    product: subscription.product,
    active: subscription.active,
    status: subscriptionStatus(subscription),
    startsAt: subscription.startsAt,
    expiresAt: subscription.expiresAt,
    maxDevices: subscription.maxDevices,
    configured: Boolean(subscription.credentials),
    company: subscription.company,
    devices: subscription.devices,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt
  };
}

const subscriptionInclude = {
  company: { select: { id: true, tradeName: true, companyName: true, active: true } },
  credentials: { select: { id: true, updatedAt: true } },
  devices: {
    select: { id: true, label: true, active: true, activatedAt: true, lastSeenAt: true },
    orderBy: { activatedAt: "desc" as const }
  }
};

async function generateUniqueActivationCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const raw = randomCode(12);
    const exists = await prisma.appSubscription.findUnique({
      where: { activationCodeHash: hashOpaqueValue(raw) },
      select: { id: true }
    });
    if (!exists) return raw;
  }
  throw new Error("Nao foi possivel gerar um codigo de ativacao unico");
}

async function generateUniquePairingCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = randomCode(6);
    const exists = await prisma.appPairing.findUnique({ where: { code }, select: { id: true } });
    if (!exists) return code;
  }
  throw new Error("Nao foi possivel gerar um codigo de pareamento unico");
}

export async function listAppSubscriptions(req: Request, res: Response) {
  const companyId = req.query.companyId?.toString();
  const subscriptions = await prisma.appSubscription.findMany({
    where: { ...(companyId ? { companyId } : {}), product: "GUIGUI_PLAYER" },
    include: subscriptionInclude,
    orderBy: { createdAt: "desc" }
  });
  return res.json(subscriptions.map(publicSubscription));
}

export async function getMyAppSubscription(req: Request, res: Response) {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ message: "Acesso disponivel somente para empresas" });

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { businessType: true, category: true }
  });
  const isIptv = company?.businessType === "IPTV" || company?.category.trim().toLowerCase() === "app";
  if (!isIptv) return res.status(403).json({ message: "Esta empresa nao pertence ao modulo IPTV" });

  const subscription = await prisma.appSubscription.findFirst({
    where: { companyId, product: "GUIGUI_PLAYER" },
    include: subscriptionInclude,
    orderBy: { createdAt: "desc" }
  });
  return res.json(subscription ? publicSubscription(subscription) : null);
}

export async function updateMyAppDevice(req: Request, res: Response) {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ message: "Acesso disponivel somente para empresas" });
  const body = z.object({ active: z.boolean() }).parse(req.body);
  const device = await prisma.appDevice.findFirst({
    where: { id: req.params.deviceId, subscription: { companyId, product: "GUIGUI_PLAYER" } }
  });
  if (!device) return res.status(404).json({ message: "Aparelho nao encontrado" });
  return res.json(await prisma.appDevice.update({
    where: { id: device.id },
    data: { active: body.active },
    select: { id: true, label: true, active: true, activatedAt: true, lastSeenAt: true }
  }));
}

export async function createAppSubscription(req: Request, res: Response) {
  const body = createSubscriptionSchema.parse(req.body);
  const company = await prisma.company.findUnique({ where: { id: body.companyId }, select: { id: true } });
  if (!company) return res.status(404).json({ message: "Empresa nao encontrada" });

  const activationCode = await generateUniqueActivationCode();
  const subscription = await prisma.appSubscription.create({
    data: {
      companyId: body.companyId,
      product: "GUIGUI_PLAYER",
      expiresAt: expiresFromDays(body.durationDays),
      maxDevices: body.maxDevices,
      activationCodeHash: hashOpaqueValue(activationCode),
      credentials: {
        create: {
          serverEncrypted: encryptIptvValue(body.credentials.server.replace(/\/$/, "")),
          usernameEncrypted: encryptIptvValue(body.credentials.username),
          passwordEncrypted: encryptIptvValue(body.credentials.password)
        }
      }
    },
    include: subscriptionInclude
  });
  return res.status(201).json({
    ...publicSubscription(subscription),
    activationCode: activationDisplay(activationCode)
  });
}

export async function updateAppSubscription(req: Request, res: Response) {
  const body = updateSubscriptionSchema.parse(req.body);
  const existing = await prisma.appSubscription.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ message: "Assinatura nao encontrada" });

  const subscription = await prisma.appSubscription.update({
    where: { id: existing.id },
    data: {
      ...(body.active !== undefined ? { active: body.active } : {}),
      ...(body.maxDevices !== undefined ? { maxDevices: body.maxDevices } : {}),
      ...(body.durationDays !== undefined
        ? { startsAt: new Date(), expiresAt: expiresFromDays(body.durationDays) }
        : body.expiresAt !== undefined
          ? { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }
          : {}),
      ...(body.credentials ? {
        credentials: {
          upsert: {
            create: {
              serverEncrypted: encryptIptvValue(body.credentials.server.replace(/\/$/, "")),
              usernameEncrypted: encryptIptvValue(body.credentials.username),
              passwordEncrypted: encryptIptvValue(body.credentials.password)
            },
            update: {
              serverEncrypted: encryptIptvValue(body.credentials.server.replace(/\/$/, "")),
              usernameEncrypted: encryptIptvValue(body.credentials.username),
              passwordEncrypted: encryptIptvValue(body.credentials.password)
            }
          }
        }
      } : {})
    },
    include: subscriptionInclude
  });
  return res.json(publicSubscription(subscription));
}

export async function regenerateActivationCode(req: Request, res: Response) {
  const existing = await prisma.appSubscription.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!existing) return res.status(404).json({ message: "Assinatura nao encontrada" });
  const activationCode = await generateUniqueActivationCode();
  await prisma.appSubscription.update({
    where: { id: existing.id },
    data: { activationCodeHash: hashOpaqueValue(activationCode) }
  });
  return res.json({ activationCode: activationDisplay(activationCode) });
}

export async function updateAppDevice(req: Request, res: Response) {
  const body = z.object({ active: z.boolean() }).parse(req.body);
  const device = await prisma.appDevice.findUnique({ where: { id: req.params.deviceId } });
  if (!device || device.subscriptionId !== req.params.id) {
    return res.status(404).json({ message: "Aparelho nao encontrado" });
  }
  return res.json(await prisma.appDevice.update({
    where: { id: device.id },
    data: { active: body.active },
    select: { id: true, label: true, active: true, activatedAt: true, lastSeenAt: true }
  }));
}

export async function createPairing(req: Request, res: Response) {
  const body = deviceSchema.parse(req.body);
  const deviceIdHash = hashOpaqueValue(body.deviceId);
  await prisma.appPairing.updateMany({
    where: { deviceIdHash, status: "PENDING" },
    data: { status: "EXPIRED" }
  });
  const code = await generateUniquePairingCode();
  const pairing = await prisma.appPairing.create({
    data: { code, deviceIdHash, expiresAt: new Date(Date.now() + 10 * 60 * 1000) }
  });
  const pairUrl = `${env.iptvPairingWebUrl}/apps/roku/pair?code=${encodeURIComponent(code)}`;
  return res.status(201).json({
    status: "pending",
    code,
    pairUrl,
    qrUrl: `${env.iptvPairingWebUrl}/api/pairings/${code}/qr`,
    expiresAt: pairing.expiresAt
  });
}

export async function getPairing(req: Request, res: Response) {
  const code = normalizeCode(req.params.code);
  const pairing = await prisma.appPairing.findUnique({ where: { code }, select: { status: true, expiresAt: true } });
  if (!pairing) return res.status(404).json({ message: "Codigo nao encontrado" });
  if (pairing.expiresAt.getTime() <= Date.now() && pairing.status === "PENDING") {
    await prisma.appPairing.update({ where: { code }, data: { status: "EXPIRED" } });
    return res.json({ status: "expired", expiresAt: pairing.expiresAt });
  }
  return res.json({ status: pairing.status.toLowerCase(), expiresAt: pairing.expiresAt });
}

export async function activatePairing(req: Request, res: Response) {
  const code = normalizeCode(req.params.code);
  const body = activateSchema.parse(req.body);
  const pairing = await prisma.appPairing.findUnique({ where: { code } });
  if (!pairing) return res.status(404).json({ message: "Codigo da TV nao encontrado" });
  if (pairing.status !== "PENDING" || pairing.expiresAt.getTime() <= Date.now()) {
    if (pairing.status === "PENDING") await prisma.appPairing.update({ where: { id: pairing.id }, data: { status: "EXPIRED" } });
    return res.status(410).json({ message: "Este codigo expirou. Gere um novo codigo na TV" });
  }
  const deviceIdHash = pairing.deviceIdHash;
  const activationCodeHash = hashOpaqueValue(normalizeCode(body.activationCode));
  const subscription = await prisma.appSubscription.findUnique({
    where: { activationCodeHash },
    include: { company: { select: { active: true, tradeName: true } }, credentials: true, devices: true }
  });
  if (!subscription || subscription.product !== "GUIGUI_PLAYER") {
    return res.status(404).json({ message: "Codigo de ativacao invalido" });
  }
  if (!subscription.company.active || subscriptionStatus(subscription) !== "active") {
    return res.status(403).json({ message: "Licenca inativa ou expirada" });
  }
  if (!subscription.credentials) {
    return res.status(409).json({ message: "A lista IPTV ainda nao foi configurada pelo fornecedor" });
  }
  const existingDevice = subscription.devices.find((device) => device.deviceIdHash === deviceIdHash);
  const activeDevices = subscription.devices.filter((device) => device.active && device.id !== existingDevice?.id).length;
  if (activeDevices >= subscription.maxDevices) {
    return res.status(409).json({ message: "Limite de aparelhos atingido. Solicite a liberacao de um aparelho" });
  }

  await prisma.$transaction([
    prisma.appDevice.upsert({
      where: { subscriptionId_deviceIdHash: { subscriptionId: subscription.id, deviceIdHash } },
      create: { subscriptionId: subscription.id, deviceIdHash, label: "Roku", active: true },
      update: { active: true, lastSeenAt: new Date() }
    }),
    prisma.appPairing.update({
      where: { id: pairing.id },
      data: { subscriptionId: subscription.id, status: "PAIRED", pairedAt: new Date() }
    })
  ]);
  return res.json({ status: "paired", companyName: subscription.company.tradeName });
}

export async function getPairingStatus(req: Request, res: Response) {
  const code = normalizeCode(req.params.code);
  const deviceId = z.string().trim().min(4).max(256).parse(req.query.deviceId);
  const pairing = await prisma.appPairing.findUnique({
    where: { code },
    include: {
      subscription: { include: { company: { select: { active: true, tradeName: true } }, credentials: true } }
    }
  });
  if (!pairing || pairing.deviceIdHash !== hashOpaqueValue(deviceId)) {
    return res.status(404).json({ error: "Codigo nao encontrado" });
  }
  if (pairing.expiresAt.getTime() <= Date.now() && pairing.status === "PENDING") {
    await prisma.appPairing.update({ where: { id: pairing.id }, data: { status: "EXPIRED" } });
    return res.json({ status: "expired" });
  }
  if (pairing.status === "PENDING") return res.json({ status: "pending" });
  if (pairing.status === "EXPIRED") return res.json({ status: "expired" });
  if (pairing.status === "ACKNOWLEDGED") return res.json({ status: "acknowledged" });

  const subscription = pairing.subscription;
  if (!subscription || !subscription.credentials || !subscription.company.active || subscriptionStatus(subscription) !== "active") {
    return res.status(403).json({ error: "Licenca inativa, expirada ou sem configuracao" });
  }
  await prisma.appDevice.updateMany({
    where: { subscriptionId: subscription.id, deviceIdHash: pairing.deviceIdHash },
    data: { lastSeenAt: new Date() }
  });
  return res.json({
    status: "paired",
    profile: {
      name: subscription.company.tradeName,
      server: decryptIptvValue(subscription.credentials.serverEncrypted),
      username: decryptIptvValue(subscription.credentials.usernameEncrypted),
      password: decryptIptvValue(subscription.credentials.passwordEncrypted)
    }
  });
}

export async function acknowledgePairing(req: Request, res: Response) {
  const code = normalizeCode(req.params.code);
  const body = deviceSchema.parse(req.body);
  const pairing = await prisma.appPairing.findUnique({ where: { code } });
  if (!pairing || pairing.deviceIdHash !== hashOpaqueValue(body.deviceId)) {
    return res.status(404).json({ error: "Codigo nao encontrado" });
  }
  if (pairing.status !== "PAIRED" && pairing.status !== "ACKNOWLEDGED") {
    return res.status(409).json({ error: "Pareamento ainda nao concluido" });
  }
  if (pairing.status === "PAIRED") {
    await prisma.appPairing.update({
      where: { id: pairing.id },
      data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date() }
    });
  }
  return res.json({ status: "acknowledged" });
}

export async function getPairingQr(req: Request, res: Response) {
  const code = normalizeCode(req.params.code);
  const pairing = await prisma.appPairing.findUnique({ where: { code }, select: { id: true } });
  if (!pairing) return res.status(404).json({ message: "Codigo nao encontrado" });
  const pairUrl = `${env.iptvPairingWebUrl}/apps/roku/pair?code=${encodeURIComponent(code)}`;
  const png = await QRCode.toBuffer(pairUrl, { type: "png", width: 420, margin: 2, errorCorrectionLevel: "M" });
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "private, max-age=300");
  return res.send(png);
}
