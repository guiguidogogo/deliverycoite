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
const activateSchema = z.object({
  activationCode: z.string().trim().min(8).max(32).optional(),
  credentials: credentialsSchema
});
const subscriberPlanSchema = z.enum(["TRIAL_7_DAYS", "DAYS_30", "DAYS_60", "DAYS_90", "MONTHS_6", "YEAR_1", "LIFETIME"]);
const createSubscriberSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do assinante").max(120),
  phone: z.string().trim().max(30).nullable().optional(),
  plan: subscriberPlanSchema.default("TRIAL_7_DAYS"),
  maxDevices: z.coerce.number().int().min(1).max(10).default(1)
});
const updateSubscriberSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do assinante").max(120).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  active: z.boolean().optional(),
  plan: subscriberPlanSchema.optional(),
  maxDevices: z.coerce.number().int().min(1).max(10).optional()
});
const manualPairingSchema = z.object({ pairingCode: z.string().trim().min(4).max(12) });

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

function expiresFromPlan(plan: z.infer<typeof subscriberPlanSchema>) {
  const expiresAt = new Date();
  if (plan === "LIFETIME") return null;
  if (plan === "MONTHS_6") {
    expiresAt.setUTCMonth(expiresAt.getUTCMonth() + 6);
    return expiresAt;
  }
  if (plan === "YEAR_1") {
    expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
    return expiresAt;
  }
  const days = { TRIAL_7_DAYS: 7, DAYS_30: 30, DAYS_60: 60, DAYS_90: 90 }[plan];
  expiresAt.setUTCDate(expiresAt.getUTCDate() + days);
  return expiresAt;
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

function publicSubscriber(subscriber: any) {
  return {
    id: subscriber.id,
    name: subscriber.name,
    phone: subscriber.phone,
    active: subscriber.active,
    status: subscriptionStatus(subscriber),
    plan: subscriber.plan,
    startsAt: subscriber.startsAt,
    expiresAt: subscriber.expiresAt,
    maxDevices: subscriber.maxDevices,
    activationCode: activationDisplay(decryptIptvValue(subscriber.activationCodeEncrypted)),
    devices: subscriber.devices,
    createdAt: subscriber.createdAt,
    updatedAt: subscriber.updatedAt
  };
}

const subscriberInclude = {
  devices: {
    select: { id: true, label: true, active: true, activatedAt: true, lastSeenAt: true },
    orderBy: { activatedAt: "desc" as const }
  }
};

const subscriptionInclude = {
  company: { select: { id: true, tradeName: true, companyName: true, active: true } },
  credentials: { select: { id: true, updatedAt: true } },
  devices: {
    where: { subscriberId: null },
    select: { id: true, label: true, active: true, activatedAt: true, lastSeenAt: true },
    orderBy: { activatedAt: "desc" as const }
  }
};

async function generateUniqueActivationCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const raw = randomCode(12);
    const activationCodeHash = hashOpaqueValue(raw);
    const [subscription, subscriber] = await Promise.all([
      prisma.appSubscription.findUnique({ where: { activationCodeHash }, select: { id: true } }),
      prisma.appSubscriber.findUnique({ where: { activationCodeHash }, select: { id: true } })
    ]);
    if (!subscription && !subscriber) return raw;
  }
  throw new Error("Nao foi possivel gerar um codigo de ativacao unico");
}

async function getMySubscription(companyId: string) {
  return prisma.appSubscription.findFirst({
    where: { companyId, product: "GUIGUI_PLAYER" },
    orderBy: { createdAt: "desc" }
  });
}

export async function listMyAppSubscribers(req: Request, res: Response) {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ message: "Acesso disponivel somente para empresas" });
  const subscription = await getMySubscription(companyId);
  if (!subscription) return res.status(404).json({ message: "Licenca GuiGuiPlayer nao encontrada" });
  const subscribers = await prisma.appSubscriber.findMany({
    where: { subscriptionId: subscription.id },
    include: subscriberInclude,
    orderBy: { createdAt: "desc" }
  });
  return res.json(subscribers.map(publicSubscriber));
}

export async function createMyAppSubscriber(req: Request, res: Response) {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ message: "Acesso disponivel somente para empresas" });
  const subscription = await getMySubscription(companyId);
  if (!subscription) return res.status(404).json({ message: "Licenca GuiGuiPlayer nao encontrada" });
  const body = createSubscriberSchema.parse(req.body);
  const activationCode = await generateUniqueActivationCode();
  const subscriber = await prisma.appSubscriber.create({
    data: {
      subscriptionId: subscription.id,
      name: body.name,
      phone: body.phone || null,
      plan: body.plan,
      expiresAt: expiresFromPlan(body.plan),
      maxDevices: body.maxDevices,
      activationCodeHash: hashOpaqueValue(activationCode),
      activationCodeEncrypted: encryptIptvValue(activationCode)
    },
    include: subscriberInclude
  });
  return res.status(201).json(publicSubscriber(subscriber));
}

export async function updateMyAppSubscriber(req: Request, res: Response) {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ message: "Acesso disponivel somente para empresas" });
  const body = updateSubscriberSchema.parse(req.body);
  const subscriber = await prisma.appSubscriber.findFirst({
    where: { id: req.params.subscriberId, subscription: { companyId, product: "GUIGUI_PLAYER" } }
  });
  if (!subscriber) return res.status(404).json({ message: "Assinante nao encontrado" });
  const updated = await prisma.appSubscriber.update({
    where: { id: subscriber.id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
      ...(body.maxDevices !== undefined ? { maxDevices: body.maxDevices } : {}),
      ...(body.plan !== undefined ? { plan: body.plan, startsAt: new Date(), expiresAt: expiresFromPlan(body.plan), active: true } : {})
    },
    include: subscriberInclude
  });
  return res.json(publicSubscriber(updated));
}

export async function deleteMyAppSubscriber(req: Request, res: Response) {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ message: "Acesso disponivel somente para empresas" });
  const subscriber = await prisma.appSubscriber.findFirst({
    where: { id: req.params.subscriberId, subscription: { companyId, product: "GUIGUI_PLAYER" } }
  });
  if (!subscriber) return res.status(404).json({ message: "Assinante nao encontrado" });
  await prisma.$transaction([
    prisma.appPairing.updateMany({ where: { subscriberId: subscriber.id }, data: { status: "EXPIRED" } }),
    prisma.appSubscriber.delete({ where: { id: subscriber.id } })
  ]);
  return res.status(204).send();
}

export async function regenerateMySubscriberActivationCode(req: Request, res: Response) {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ message: "Acesso disponivel somente para empresas" });
  const subscriber = await prisma.appSubscriber.findFirst({
    where: { id: req.params.subscriberId, subscription: { companyId, product: "GUIGUI_PLAYER" } }
  });
  if (!subscriber) return res.status(404).json({ message: "Assinante nao encontrado" });
  const activationCode = await generateUniqueActivationCode();
  await prisma.appSubscriber.update({
    where: { id: subscriber.id },
    data: { activationCodeHash: hashOpaqueValue(activationCode), activationCodeEncrypted: encryptIptvValue(activationCode) }
  });
  return res.json({ activationCode: activationDisplay(activationCode) });
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
  const body = z.object({
    active: z.boolean().optional(),
    label: z.string().trim().min(1).max(80).optional()
  }).refine((value) => value.active !== undefined || value.label !== undefined, {
    message: "Informe ao menos uma alteracao"
  }).parse(req.body);
  const device = await prisma.appDevice.findUnique({ where: { id: req.params.deviceId } });
  if (!device || device.subscriptionId !== req.params.id) {
    return res.status(404).json({ message: "Aparelho nao encontrado" });
  }
  return res.json(await prisma.appDevice.update({
    where: { id: device.id },
    data: {
      ...(body.active !== undefined ? { active: body.active } : {}),
      ...(body.label !== undefined ? { label: body.label } : {})
    },
    select: { id: true, label: true, active: true, activatedAt: true, lastSeenAt: true }
  }));
}

export async function deleteAppDevice(req: Request, res: Response) {
  const device = await prisma.appDevice.findUnique({ where: { id: req.params.deviceId } });
  if (!device || device.subscriptionId !== req.params.id) {
    return res.status(404).json({ message: "Aparelho nao encontrado" });
  }
  await prisma.appDevice.delete({ where: { id: device.id } });
  return res.status(204).send();
}

export async function deleteAppSubscription(req: Request, res: Response) {
  const existing = await prisma.appSubscription.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!existing) return res.status(404).json({ message: "Assinatura nao encontrada" });
  await prisma.$transaction([
    prisma.appPairing.updateMany({ where: { subscriptionId: existing.id }, data: { status: "EXPIRED" } }),
    prisma.appSubscription.delete({ where: { id: existing.id } })
  ]);
  return res.status(204).send();
}

export async function manuallyPairAppSubscription(req: Request, res: Response) {
  const body = manualPairingSchema.parse(req.body);
  const subscription = await prisma.appSubscription.findUnique({
    where: { id: req.params.id },
    include: { company: { select: { active: true, tradeName: true } }, credentials: true, devices: true }
  });
  if (!subscription) return res.status(404).json({ message: "Assinatura nao encontrada" });
  if (!subscription.company.active || subscriptionStatus(subscription) !== "active") {
    return res.status(403).json({ message: "Ative ou renove a licenca antes de vincular a TV" });
  }
  if (!subscription.credentials) {
    return res.status(409).json({ message: "Configure o servidor, login e senha antes de vincular a TV" });
  }

  const pairingCode = normalizeCode(body.pairingCode);
  const pairing = await prisma.appPairing.findUnique({ where: { code: pairingCode } });
  if (!pairing) return res.status(404).json({ message: "Codigo da TV nao encontrado" });
  if (pairing.status !== "PENDING" || pairing.expiresAt.getTime() <= Date.now()) {
    if (pairing.status === "PENDING") await prisma.appPairing.update({ where: { id: pairing.id }, data: { status: "EXPIRED" } });
    return res.status(410).json({ message: "O codigo da TV expirou. Gere outro codigo na Roku" });
  }

  const existingDevice = subscription.devices.find((device) => device.deviceIdHash === pairing.deviceIdHash);
  const activeDevices = subscription.devices.filter((device) => device.active && device.id !== existingDevice?.id).length;
  if (activeDevices >= subscription.maxDevices) {
    return res.status(409).json({ message: "Limite de aparelhos atingido. Aumente o limite ou bloqueie uma TV" });
  }

  const activationCode = await generateUniqueActivationCode();
  await prisma.$transaction([
    prisma.appSubscription.update({
      where: { id: subscription.id },
      data: { activationCodeHash: hashOpaqueValue(activationCode) }
    }),
    prisma.appDevice.upsert({
      where: { subscriptionId_deviceIdHash: { subscriptionId: subscription.id, deviceIdHash: pairing.deviceIdHash } },
      create: { subscriptionId: subscription.id, deviceIdHash: pairing.deviceIdHash, label: "Roku", active: true },
      update: { subscriberId: null, active: true, lastSeenAt: new Date() }
    }),
    prisma.appPairing.update({
      where: { id: pairing.id },
      data: { subscriptionId: subscription.id, subscriberId: null, status: "PAIRED", pairedAt: new Date() }
    })
  ]);
  return res.json({ activationCode: activationDisplay(activationCode), status: "paired", companyName: subscription.company.tradeName });
}

export async function validateAppDevice(req: Request, res: Response) {
  const body = deviceSchema.parse(req.body);
  const device = await prisma.appDevice.findFirst({
    where: { deviceIdHash: hashOpaqueValue(body.deviceId) },
    include: {
      subscriber: true,
      subscription: { include: { company: { select: { active: true } }, credentials: { select: { id: true } } } }
    },
    orderBy: { lastSeenAt: "desc" }
  });
  if (!device) return res.status(404).json({ error: "Esta Roku ainda nao possui uma licenca. Gere um codigo de acesso" });
  if (!device.active) return res.status(403).json({ error: "Este aparelho foi bloqueado pelo administrador" });
  if (!device.subscription.company.active || subscriptionStatus(device.subscription) !== "active") {
    return res.status(403).json({ error: "A conta principal esta inativa ou expirada" });
  }
  if (device.subscriber && subscriptionStatus(device.subscriber) !== "active") {
    return res.status(403).json({ error: "Seu periodo de acesso terminou. Solicite a renovacao" });
  }
  await prisma.appDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  return res.json({ status: "active", expiresAt: device.subscriber?.expiresAt ?? device.subscription.expiresAt });
}

export async function createPairing(req: Request, res: Response) {
  const body = deviceSchema.parse(req.body);
  const deviceIdHash = hashOpaqueValue(body.deviceId);
  await prisma.appPairing.updateMany({
    where: { deviceIdHash, status: "PENDING" },
    data: { status: "EXPIRED" }
  });
  const registeredDevice = await prisma.appDevice.findFirst({
    where: { deviceIdHash, active: true },
    include: { subscriber: true, subscription: { include: { company: { select: { active: true } } } } },
    orderBy: { lastSeenAt: "desc" }
  });
  const canSelfConfigure = Boolean(
    registeredDevice
    && registeredDevice.subscription.company.active
    && subscriptionStatus(registeredDevice.subscription) === "active"
    && (!registeredDevice.subscriber || subscriptionStatus(registeredDevice.subscriber) === "active")
  );
  const code = await generateUniquePairingCode();
  const pairing = await prisma.appPairing.create({
    data: {
      code,
      deviceIdHash,
      ...(canSelfConfigure ? { subscriptionId: registeredDevice!.subscriptionId, subscriberId: registeredDevice!.subscriberId } : {}),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    }
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
  const pairing = await prisma.appPairing.findUnique({ where: { code }, select: { status: true, expiresAt: true, subscriptionId: true } });
  if (!pairing) return res.status(404).json({ message: "Codigo nao encontrado" });
  if (pairing.expiresAt.getTime() <= Date.now() && pairing.status === "PENDING") {
    await prisma.appPairing.update({ where: { code }, data: { status: "EXPIRED" } });
    return res.json({ status: "expired", expiresAt: pairing.expiresAt });
  }
  return res.json({ status: pairing.status.toLowerCase(), expiresAt: pairing.expiresAt, registered: Boolean(pairing.subscriptionId) });
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
  const activationCodeHash = body.activationCode ? hashOpaqueValue(normalizeCode(body.activationCode)) : null;
  const subscriber = body.activationCode ? await prisma.appSubscriber.findUnique({
    where: { activationCodeHash: activationCodeHash! },
    include: {
      devices: true,
      subscription: { include: { company: { select: { active: true, tradeName: true } }, credentials: true } }
    }
  }) : pairing.subscriberId ? await prisma.appSubscriber.findUnique({
    where: { id: pairing.subscriberId },
    include: {
      devices: true,
      subscription: { include: { company: { select: { active: true, tradeName: true } }, credentials: true } }
    }
  }) : null;
  if (!body.activationCode && pairing.subscriberId && !subscriber) {
    return res.status(403).json({ message: "O assinante vinculado a esta Roku nao existe mais" });
  }
  const legacySubscription = subscriber ? null : body.activationCode ? await prisma.appSubscription.findUnique({
    where: { activationCodeHash: activationCodeHash! },
    include: { company: { select: { active: true, tradeName: true } }, credentials: true, devices: true }
  }) : pairing.subscriptionId ? await prisma.appSubscription.findUnique({
    where: { id: pairing.subscriptionId },
    include: { company: { select: { active: true, tradeName: true } }, credentials: true, devices: true }
  }) : null;
  const subscription = subscriber?.subscription ?? legacySubscription;
  if (!subscription || subscription.product !== "GUIGUI_PLAYER") {
    return res.status(404).json({ message: "Codigo de ativacao invalido" });
  }
  if (!subscription.company.active || subscriptionStatus(subscription) !== "active") {
    return res.status(403).json({ message: "Licenca inativa ou expirada" });
  }
  if (subscriber && subscriptionStatus(subscriber) !== "active") {
    return res.status(403).json({ message: "Acesso do assinante bloqueado ou expirado" });
  }
  const licensedDevices = subscriber ? subscriber.devices : legacySubscription?.devices ?? [];
  const maxDevices = subscriber?.maxDevices ?? subscription.maxDevices;
  const existingDevice = licensedDevices.find((device) => device.deviceIdHash === deviceIdHash);
  const activeDevices = licensedDevices.filter((device) => device.active && device.id !== existingDevice?.id).length;
  if (activeDevices >= maxDevices) {
    return res.status(409).json({ message: "Limite de aparelhos atingido. Solicite a liberacao de um aparelho" });
  }

  await prisma.$transaction([
    prisma.appDevice.upsert({
      where: { subscriptionId_deviceIdHash: { subscriptionId: subscription.id, deviceIdHash } },
      create: { subscriptionId: subscription.id, subscriberId: subscriber?.id, deviceIdHash, label: "Roku", active: true },
      update: { subscriberId: subscriber?.id ?? null, active: true, lastSeenAt: new Date() }
    }),
    prisma.appPairing.update({
      where: { id: pairing.id },
      data: {
        subscriptionId: subscription.id,
        subscriberId: subscriber?.id,
        serverEncrypted: encryptIptvValue(body.credentials.server.replace(/\/$/, "")),
        usernameEncrypted: encryptIptvValue(body.credentials.username),
        passwordEncrypted: encryptIptvValue(body.credentials.password),
        status: "PAIRED",
        pairedAt: new Date()
      }
    })
  ]);
  return res.json({ status: "paired", companyName: subscriber?.name ?? subscription.company.tradeName });
}

export async function getPairingStatus(req: Request, res: Response) {
  const code = normalizeCode(req.params.code);
  const deviceId = z.string().trim().min(4).max(256).parse(req.query.deviceId);
  const pairing = await prisma.appPairing.findUnique({
    where: { code },
    include: {
      subscription: { include: { company: { select: { active: true, tradeName: true } }, credentials: true } },
      subscriber: true
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
  const hasPairingCredentials = Boolean(pairing.serverEncrypted && pairing.usernameEncrypted && pairing.passwordEncrypted);
  if (!subscription || (!hasPairingCredentials && !subscription.credentials) || !subscription.company.active || subscriptionStatus(subscription) !== "active") {
    return res.status(403).json({ error: "Licenca inativa, expirada ou sem configuracao" });
  }
  if (pairing.subscriber && subscriptionStatus(pairing.subscriber) !== "active") {
    return res.status(403).json({ error: "Acesso do assinante bloqueado ou expirado" });
  }
  const device = await prisma.appDevice.findFirst({
    where: {
      subscriptionId: subscription.id,
      deviceIdHash: pairing.deviceIdHash,
      ...(pairing.subscriberId ? { subscriberId: pairing.subscriberId } : {})
    },
    select: { active: true }
  });
  if (!device?.active) return res.status(403).json({ error: "Este aparelho esta bloqueado" });
  await prisma.appDevice.updateMany({
    where: { subscriptionId: subscription.id, deviceIdHash: pairing.deviceIdHash, ...(pairing.subscriberId ? { subscriberId: pairing.subscriberId } : {}) },
    data: { lastSeenAt: new Date() }
  });
  return res.json({
    status: "paired",
    profile: {
      name: pairing.subscriber?.name ?? subscription.company.tradeName,
      server: decryptIptvValue(pairing.serverEncrypted ?? subscription.credentials!.serverEncrypted),
      username: decryptIptvValue(pairing.usernameEncrypted ?? subscription.credentials!.usernameEncrypted),
      password: decryptIptvValue(pairing.passwordEncrypted ?? subscription.credentials!.passwordEncrypted)
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
      data: {
        status: "ACKNOWLEDGED",
        acknowledgedAt: new Date(),
        serverEncrypted: null,
        usernameEncrypted: null,
        passwordEncrypted: null
      }
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
