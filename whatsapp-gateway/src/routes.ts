import { randomBytes, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { InstanceStatus, Prisma } from "@prisma/client";
import { config } from "./config.js";
import { asyncRoute, HttpError, prisma } from "./lib.js";
import { authenticateApp, requestHash } from "./security.js";
import { distributedLimit } from "./rate-limit.js";
import { whatsappProvider } from "./providers/evolution/evolution-provider.js";
import { enqueueMessage } from "./queue.js";

export const apiRouter = Router();

const externalId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:@-]+$/);
const tenantBody = z.object({ external_tenant_id: externalId, name: z.string().trim().min(1).max(160) }).strict();
const instanceBody = z.object({ tenant_id: externalId }).strict();
const phone = z.string().regex(/^\d{8,20}$/);
const url = z.string().url().max(2048).refine((v) => ["http:", "https:"].includes(new URL(v).protocol), "URL inválida");
const sendTextBody = z.object({ tenant_id: externalId, to: phone, message: z.string().min(1).max(4096) }).strict();
const sendImageBody = z.object({ tenant_id: externalId, to: phone, image_url: url, caption: z.string().max(1024).optional() }).strict();
const sendDocumentBody = z.object({ tenant_id: externalId, to: phone, document_url: url, filename: z.string().min(1).max(255).regex(/^[^/\\]+$/), caption: z.string().max(1024).optional() }).strict();

function parse<T>(schema: z.ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, "Payload inválido", "validation_error", result.error.flatten());
  return result.data;
}

async function getTenant(appId: string, tenantId: string, requireInstance = false) {
  const tenant = await prisma.tenant.findUnique({ where: { appId_externalTenantId: { appId, externalTenantId: tenantId } }, include: { whatsappInstance: true } });
  if (!tenant || !tenant.active) throw new HttpError(404, "Tenant não encontrado", "tenant_not_found");
  if (requireInstance && !tenant.whatsappInstance) throw new HttpError(404, "Instância não encontrada", "instance_not_found");
  return tenant;
}

apiRouter.post("/webhooks/evolution", asyncRoute(async (req, res) => {
  const supplied = req.header("x-webhook-secret") ?? "";
  const a = Buffer.from(supplied); const b = Buffer.from(config.WEBHOOK_SECRET);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, "Webhook não autorizado", "unauthorized");
  const event = String(req.body?.event ?? "unknown").toLowerCase().replace(/_/g, ".");
  const instanceName = String(req.body?.instance ?? req.body?.instanceName ?? "");
  const instance = instanceName ? await prisma.whatsappInstance.findUnique({ where: { evolutionInstanceName: instanceName } }) : null;
  if (!instance) return res.status(202).json({ received: true });
  const stateRaw = String(req.body?.data?.state ?? req.body?.data?.statusReason ?? "").toLowerCase();
  let status: InstanceStatus | undefined;
  if (event.includes("qrcode")) status = "qr_required";
  else if (event.includes("connection")) status = stateRaw === "open" || stateRaw === "connected" ? "connected" : stateRaw === "connecting" ? "reconnecting" : stateRaw.includes("logout") ? "logged_out" : "disconnected";
  const now = new Date();
  if (status) await prisma.whatsappInstance.update({ where: { id: instance.id }, data: { status, lastConnectedAt: status === "connected" ? now : undefined, lastDisconnectedAt: status === "disconnected" || status === "logged_out" ? now : undefined, phoneNumber: req.body?.data?.wuid?.replace?.(/\D/g, "") || undefined, profileName: req.body?.data?.profileName || undefined } });
  const safePayload = { event, instance: instanceName, state: stateRaw || undefined, timestamp: req.body?.date_time ?? req.body?.timestamp } as Prisma.InputJsonValue;
  await prisma.whatsappEvent.create({ data: { instanceId: instance.id, eventType: event, payload: safePayload } });
  res.status(202).json({ received: true });
}));

apiRouter.use(authenticateApp);
apiRouter.use(distributedLimit("app", config.RATE_LIMIT_APP_PER_MINUTE, (req) => req.hubApp?.id));
apiRouter.use(distributedLimit("tenant", config.RATE_LIMIT_TENANT_PER_MINUTE, (req) => {
  const tenant = req.body?.tenant_id ?? req.params?.tenantId;
  return tenant ? `${req.hubApp?.id}:${tenant}` : undefined;
}));
apiRouter.use(distributedLimit("instance", config.RATE_LIMIT_INSTANCE_PER_MINUTE, (req) => {
  const tenant = req.body?.tenant_id ?? req.params?.tenantId;
  return req.path.startsWith("/whatsapp/") && tenant ? `${req.hubApp?.id}:${tenant}` : undefined;
}));

apiRouter.post("/tenants", asyncRoute(async (req, res) => {
  const body = parse(tenantBody, req.body);
  const tenant = await prisma.tenant.upsert({ where: { appId_externalTenantId: { appId: req.hubApp!.id, externalTenantId: body.external_tenant_id } }, create: { appId: req.hubApp!.id, externalTenantId: body.external_tenant_id, name: body.name }, update: { name: body.name, active: true } });
  res.status(201).json({ id: tenant.externalTenantId, name: tenant.name, active: tenant.active });
}));

apiRouter.post("/whatsapp/instances", asyncRoute(async (req, res) => {
  const body = parse(instanceBody, req.body);
  const tenant = await getTenant(req.hubApp!.id, body.tenant_id);
  if (tenant.whatsappInstance) return res.status(200).json({ tenant_id: body.tenant_id, instance_id: tenant.whatsappInstance.id, status: tenant.whatsappInstance.status });
  const instanceName = `hr_${randomBytes(12).toString("hex")}`;
  const instance = await prisma.whatsappInstance.create({ data: { tenantId: tenant.id, evolutionInstanceName: instanceName, status: "connecting" } });
  try {
    await whatsappProvider.createInstance(instanceName, `${config.APP_URL}/api/v1/webhooks/evolution`);
  } catch (error) {
    await prisma.whatsappInstance.update({ where: { id: instance.id }, data: { status: "error" } });
    throw error;
  }
  res.status(201).json({ tenant_id: body.tenant_id, instance_id: instance.id, status: "connecting" });
}));

apiRouter.get("/whatsapp/instances/:tenantId/qrcode", asyncRoute(async (req, res) => {
  const tenant = await getTenant(req.hubApp!.id, parse(externalId, req.params.tenantId), true);
  const qr = await whatsappProvider.getQrCode(tenant.whatsappInstance!.evolutionInstanceName);
  await prisma.whatsappInstance.update({ where: { id: tenant.whatsappInstance!.id }, data: { status: "qr_required" } });
  res.setHeader("Cache-Control", "no-store");
  res.json({ status: "qr_required", qr_code: qr.base64, pairing_code: qr.code });
}));

apiRouter.get("/whatsapp/instances/:tenantId/status", asyncRoute(async (req, res) => {
  const tenant = await getTenant(req.hubApp!.id, parse(externalId, req.params.tenantId), true);
  const remote = await whatsappProvider.getConnectionStatus(tenant.whatsappInstance!.evolutionInstanceName);
  const status = remote.state as InstanceStatus;
  const updated = await prisma.whatsappInstance.update({ where: { id: tenant.whatsappInstance!.id }, data: { status, phoneNumber: remote.phone, profileName: remote.profileName, profilePictureUrl: remote.profilePictureUrl, lastConnectedAt: status === "connected" ? new Date() : undefined } });
  res.json({ connected: status === "connected", status, phone: updated.phoneNumber, profile_name: updated.profileName, profile_picture_url: updated.profilePictureUrl });
}));

apiRouter.post("/whatsapp/instances/:tenantId/reconnect", asyncRoute(async (req, res) => {
  const tenant = await getTenant(req.hubApp!.id, parse(externalId, req.params.tenantId), true);
  const current = await whatsappProvider.getConnectionStatus(tenant.whatsappInstance!.evolutionInstanceName);
  if (current.state === "connected" || current.state === "connecting") return res.json({ status: current.state, requires_qr: false });
  const result = await whatsappProvider.reconnect(tenant.whatsappInstance!.evolutionInstanceName);
  const requiresQr = Boolean(result.base64 || result.code);
  await prisma.whatsappInstance.update({ where: { id: tenant.whatsappInstance!.id }, data: { status: requiresQr ? "qr_required" : "reconnecting" } });
  res.json({ status: requiresQr ? "qr_required" : "reconnecting", requires_qr: requiresQr });
}));

apiRouter.post("/whatsapp/instances/:tenantId/logout", asyncRoute(async (req, res) => {
  const tenant = await getTenant(req.hubApp!.id, parse(externalId, req.params.tenantId), true);
  await whatsappProvider.logout(tenant.whatsappInstance!.evolutionInstanceName);
  await prisma.whatsappInstance.update({ where: { id: tenant.whatsappInstance!.id }, data: { status: "logged_out", lastDisconnectedAt: new Date() } });
  res.status(204).end();
}));

apiRouter.delete("/whatsapp/instances/:tenantId", asyncRoute(async (req, res) => {
  if (req.header("x-confirm-delete") !== "true") throw new HttpError(409, "Confirme a remoção com X-Confirm-Delete: true", "confirmation_required");
  const tenant = await getTenant(req.hubApp!.id, parse(externalId, req.params.tenantId), true);
  await whatsappProvider.deleteInstance(tenant.whatsappInstance!.evolutionInstanceName);
  await prisma.whatsappInstance.delete({ where: { id: tenant.whatsappInstance!.id } });
  res.status(204).end();
}));

async function send(req: any, res: any, type: "text" | "image" | "document", body: any) {
  const tenant = await getTenant(req.hubApp.id, body.tenant_id, true);
  if (tenant.whatsappInstance!.status !== "connected") throw new HttpError(409, "WhatsApp não está conectado", "instance_not_connected");
  const idempotencyKey = req.header("idempotency-key");
  if (idempotencyKey && !/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) throw new HttpError(400, "Idempotency-Key inválida", "validation_error");
  const hash = requestHash({ type, body });
  if (idempotencyKey) {
    const existing = await prisma.idempotencyRecord.findUnique({ where: { appId_key: { appId: req.hubApp.id, key: idempotencyKey } } });
    if (existing) {
      if (existing.requestHash !== hash) throw new HttpError(409, "Idempotency-Key reutilizada com payload diferente", "idempotency_conflict");
      return res.status(existing.responseCode).json(existing.responseBody);
    }
  }
  const payload = type === "text" ? { type, instanceName: tenant.whatsappInstance!.evolutionInstanceName, to: body.to, message: body.message } : { type, instanceName: tenant.whatsappInstance!.evolutionInstanceName, to: body.to, mediaUrl: type === "image" ? body.image_url : body.document_url, filename: body.filename, caption: body.caption };
  const job = await enqueueMessage(tenant.whatsappInstance!.id, payload);
  const response = { job_id: job.id, status: "pending" };
  if (idempotencyKey) await prisma.idempotencyRecord.create({ data: { appId: req.hubApp.id, key: idempotencyKey, requestHash: hash, responseCode: 202, responseBody: response, expiresAt: new Date(Date.now() + config.IDEMPOTENCY_TTL_HOURS * 3600000) } });
  res.status(202).json(response);
}

apiRouter.post("/whatsapp/send/text", asyncRoute(async (req, res) => send(req, res, "text", parse(sendTextBody, req.body))));
apiRouter.post("/whatsapp/send/image", asyncRoute(async (req, res) => send(req, res, "image", parse(sendImageBody, req.body))));
apiRouter.post("/whatsapp/send/document", asyncRoute(async (req, res) => send(req, res, "document", parse(sendDocumentBody, req.body))));
apiRouter.get("/whatsapp/jobs/:jobId", asyncRoute(async (req, res) => {
  const job = await prisma.messageJob.findFirst({ where: { id: req.params.jobId, instance: { tenant: { appId: req.hubApp!.id } } }, select: { id: true, type: true, status: true, attempts: true, providerId: true, errorCode: true, createdAt: true, updatedAt: true } });
  if (!job) throw new HttpError(404, "Job não encontrado", "job_not_found");
  res.json(job);
}));
