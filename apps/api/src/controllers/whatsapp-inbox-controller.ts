import { createHash, timingSafeEqual, randomInt, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { getCompanyId } from "../utils/tenant.js";
import { sendHubWhatsappMedia, sendHubWhatsappText } from "../services/hub-whatsapp.js";
import { linkCustomerToCompany } from "../utils/customer-linking.js";

let tablesReady: Promise<void> | null = null;

function ensureTables() {
  if (!tablesReady) {
    tablesReady = (async () => {
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS whatsapp_inbox_messages (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        external_id TEXT,
        phone TEXT NOT NULL,
        contact_name TEXT,
        direction TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        message_type TEXT NOT NULL DEFAULT 'text',
        media_url TEXT,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_inbox_external_idx ON whatsapp_inbox_messages(company_id, external_id) WHERE external_id IS NOT NULL`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS whatsapp_inbox_phone_idx ON whatsapp_inbox_messages(company_id, phone, sent_at DESC)`);
      await prisma.$executeRawUnsafe(`ALTER TABLE whatsapp_inbox_messages ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION`);
      await prisma.$executeRawUnsafe(`ALTER TABLE whatsapp_inbox_messages ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION`);
      // Existing messages start read; only newly received messages trigger alerts.
      await prisma.$executeRawUnsafe(`ALTER TABLE whatsapp_inbox_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ DEFAULT NOW()`);
      await prisma.$executeRawUnsafe(`ALTER TABLE whatsapp_inbox_messages ALTER COLUMN read_at DROP DEFAULT`);
      await prisma.$executeRawUnsafe(`ALTER TABLE whatsapp_inbox_messages ADD COLUMN IF NOT EXISTS quoted_message JSONB`);
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS whatsapp_customer_first_access (customer_id TEXT PRIMARY KEY, company_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS whatsapp_inbox_labels (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(company_id, name)
      )`);
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS whatsapp_inbox_quick_replies (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        name TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(company_id, name)
      )`);
      await prisma.$executeRawUnsafe(`ALTER TABLE whatsapp_inbox_quick_replies ADD COLUMN IF NOT EXISTS media JSONB NOT NULL DEFAULT '[]'::jsonb`);
      await prisma.$executeRawUnsafe(`ALTER TABLE whatsapp_inbox_quick_replies ADD COLUMN IF NOT EXISTS show_on_orders BOOLEAN NOT NULL DEFAULT TRUE`);
      await prisma.$executeRawUnsafe(`ALTER TABLE whatsapp_inbox_quick_replies ADD COLUMN IF NOT EXISTS system_key TEXT`);
      await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_inbox_quick_replies_system_idx ON whatsapp_inbox_quick_replies(company_id, system_key) WHERE system_key IS NOT NULL`);
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS whatsapp_inbox_preferences (
        company_id TEXT PRIMARY KEY,
        order_controls_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    })().catch((error: unknown) => {
      tablesReady = null;
      throw error;
    });
  }
  return tablesReady;
}

const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");

function coordinatesFromText(value: unknown) {
  const text = String(value ?? "").replace(/\s+/g, " ");
  const match = text.match(/(-?\d{1,3}\.\d{3,})\s*[,;]\s*(-?\d{1,3}\.\d{3,})/);
  if (!match) return { latitude: null, longitude: null };
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return { latitude: null, longitude: null };
  }
  return { latitude, longitude };
}

async function reverseGeocode(latitude: number, longitude: number) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`, {
      headers: { "user-agent": "HubRegional-Delivery/1.0" }, signal: controller.signal
    });
    clearTimeout(timer);
    if (!response.ok) return null;
    const data = await response.json() as { display_name?: string; address?: Record<string, string> };
    const address = data.address ?? {};
    return {
      address: [address.road, address.pedestrian, address.residential].find(Boolean) ?? data.display_name ?? "Localizacao recebida pelo WhatsApp",
      number: address.house_number ?? "S/N",
      district: address.suburb ?? address.neighbourhood ?? address.city_district ?? "A confirmar",
      display: data.display_name ?? ""
    };
  } catch { return null; }
}

export async function listWhatsappConversations(req: Request, res: Response) {
  await ensureTables();
  const companyId = getCompanyId(req);
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT m.phone,
      COALESCE(c.name, MAX(NULLIF(m.contact_name, '')), m.phone) AS name,
      (c.id IS NOT NULL) AS "isCustomer",
      c.id AS "customerId", c.address, c.number, c.district, c.complement,
      (ARRAY_AGG(m.body ORDER BY m.sent_at DESC))[1] AS "lastMessage",
      MAX(m.sent_at) AS "lastMessageAt",
      COUNT(*) FILTER (WHERE m.direction = 'in' AND m.read_at IS NULL)::integer AS "unreadCount"
    FROM whatsapp_inbox_messages m
    LEFT JOIN "Customer" c ON c."companyId" = m.company_id
      AND c."deletedAt" IS NULL
      AND RIGHT(REGEXP_REPLACE(c.phone, '\\D', '', 'g'), 8) = RIGHT(REGEXP_REPLACE(m.phone, '\\D', '', 'g'), 8)
    WHERE m.company_id = $1
    GROUP BY m.phone, c.id, c.name, c.address, c.number, c.district, c.complement
    ORDER BY MAX(m.sent_at) DESC
    LIMIT 200
  `, companyId);
  return res.json(rows.map((row) => {
    const coordinates = coordinatesFromText(row.body);
    return {
      ...row,
      latitude: row.latitude ?? coordinates.latitude,
      longitude: row.longitude ?? coordinates.longitude
    };
  }));
}

export async function listWhatsappMessages(req: Request, res: Response) {
  await ensureTables();
  const companyId = getCompanyId(req);
  const phone = digits(req.params.phone);
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT id, phone, contact_name AS "contactName", direction, body,
      message_type AS "messageType", media_url AS "mediaUrl", latitude, longitude, sent_at AS "sentAt", read_at AS "readAt", quoted_message AS "quotedMessage"
    FROM (SELECT * FROM whatsapp_inbox_messages
    WHERE company_id = $1 AND REGEXP_REPLACE(phone, '\\D', '', 'g') = $2
    ORDER BY sent_at DESC, id DESC LIMIT 500) recent
    ORDER BY sent_at ASC, id ASC
  `, companyId, phone);
  return res.json(rows);
}

export async function markWhatsappMessagesRead(req: Request, res: Response) {
  const { ids } = z.object({ ids: z.array(z.string().min(1).max(200)).min(1).max(500) }).parse(req.body);
  await ensureTables();
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`
    UPDATE whatsapp_inbox_messages SET read_at = NOW()
    WHERE company_id = $1 AND REGEXP_REPLACE(phone, '\\D', '', 'g') = $2
      AND id IN (SELECT jsonb_array_elements_text($3::jsonb))
      AND direction = 'in' AND read_at IS NULL RETURNING id
  `, getCompanyId(req), digits(req.params.phone), JSON.stringify(ids));
  return res.json({ ids: rows.map((row) => row.id) });
}

export async function listWhatsappCustomerAddresses(req: Request, res: Response) {
  await ensureTables();
  const phone = digits(req.params.phone);
  const customer = await prisma.customer.findFirst({ where: { companyId: getCompanyId(req), deletedAt: null, phone: { in: [phone, `+${phone}`] } }, select: { id: true } });
  if (!customer) return res.json([]);
  const addresses = await prisma.customerAddress.findMany({ where: { companyId: getCompanyId(req), customerId: customer.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] });
  return res.json(addresses);
}

export async function sendWhatsappInboxMessage(req: Request, res: Response) {
  await ensureTables();
  const { phone, message, media } = z.object({ phone: z.string().min(8), message: z.string().trim().max(4000).default(""), media: z.array(z.object({ url: z.string().min(1), filename: z.string().min(1), mimeType: z.string().min(1) })).max(5).default([]) }).parse(req.body);
  if (!message && !media.length) return res.status(400).json({ message: "Digite uma mensagem ou anexe um arquivo." });
  const companyId = getCompanyId(req);
  const normalizedPhone = digits(phone);
  const id = randomUUID();
  const result = message ? await sendHubWhatsappText(companyId, normalizedPhone, message, `inbox_${id.replace(/-/g, "")}`) : await sendHubWhatsappMedia(companyId, normalizedPhone, media[0], "", `inbox_${id.replace(/-/g, "")}`);
  for (const item of media.slice(message ? 0 : 1)) await sendHubWhatsappMedia(companyId, normalizedPhone, item, "", `inbox_${randomUUID().replace(/-/g, "")}`);
  await prisma.$executeRawUnsafe(`
    INSERT INTO whatsapp_inbox_messages
      (id, company_id, external_id, phone, direction, body, sent_at)
    VALUES ($1, $2, $3, $4, 'out', $5, NOW())
  `, id, companyId, result.job_id ?? null, normalizedPhone, message);
  return res.status(202).json({ id, phone: normalizedPhone, direction: "out", body: message, sentAt: new Date(), ...result });
}

export async function createWhatsappContact(req: Request, res: Response) {
  await ensureTables();
  const { phone, name } = z.object({ phone: z.string().min(8), name: z.string().trim().min(2).max(120) }).parse(req.body);
  const companyId = getCompanyId(req);
  const normalizedPhone = digits(phone);
  const existing = await prisma.customer.findFirst({
    where: { companyId, phone: { in: [phone, normalizedPhone, `+${normalizedPhone}`] } }
  });
  if (existing) {
    const restored = existing.deletedAt
      ? await prisma.customer.update({ where: { id: existing.id }, data: { name, deletedAt: null, deletedBy: null, deletionReason: null } })
      : existing;
    return res.json({ ...restored, temporaryPassword: null });
  }
  const lastLocation = await prisma.$queryRawUnsafe<Array<{ latitude: number | null; longitude: number | null }>>(
    `SELECT latitude, longitude FROM whatsapp_inbox_messages WHERE company_id = $1 AND REGEXP_REPLACE(phone, '\\D', '', 'g') = $2 AND latitude IS NOT NULL AND longitude IS NOT NULL ORDER BY sent_at DESC LIMIT 1`, companyId, normalizedPhone
  );
  const existingGlobal = await prisma.globalCustomer.findUnique({ where: { phone: normalizedPhone }, select: { passwordHash: true } });
  const temporaryPassword = existingGlobal?.passwordHash ? null : String(randomInt(100000, 1000000));
  const passwordHash = temporaryPassword ? await bcrypt.hash(temporaryPassword, 10) : existingGlobal?.passwordHash ?? null;
  const linked = await linkCustomerToCompany({ companyId, name, phone: normalizedPhone, passwordHash });
  const customer = await prisma.customer.create({ data: {
    companyId, name, phone: normalizedPhone, passwordHash,
    globalCustomerId: linked.globalCustomer.id, companyCustomerId: linked.companyCustomer.id,
    address: "Nao informado", number: "S/N", district: "Nao informado"
  }});
  if (lastLocation[0] && lastLocation[0].latitude !== null && lastLocation[0].longitude !== null) {
    await prisma.customerAddress.create({ data: { companyId, customerId: customer.id, label: "Localizacao WhatsApp", address: "Localizacao recebida pelo WhatsApp", number: "S/N", district: "A confirmar", latitude: lastLocation[0].latitude!, longitude: lastLocation[0].longitude!, isDefault: true } });
  }
  if (temporaryPassword) await prisma.$executeRawUnsafe(`INSERT INTO whatsapp_customer_first_access (customer_id, company_id) VALUES ($1, $2) ON CONFLICT (customer_id) DO NOTHING`, customer.id, companyId);
  return res.status(201).json({ ...customer, temporaryPassword, hasLocation: Boolean(lastLocation[0]) });
}

export async function listWhatsappLabels(req: Request, res: Response) {
  await ensureTables();
  return res.json(await prisma.$queryRawUnsafe(`SELECT id, name FROM whatsapp_inbox_labels WHERE company_id = $1 ORDER BY name`, getCompanyId(req)));
}

export async function createWhatsappLabel(req: Request, res: Response) {
  await ensureTables();
  const name = z.object({ name: z.string().trim().min(2).max(50) }).parse(req.body).name;
  const id = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO whatsapp_inbox_labels (id, company_id, name) VALUES ($1, $2, $3)`, id, getCompanyId(req), name);
  return res.status(201).json({ id, name });
}

export async function listWhatsappQuickReplies(req: Request, res: Response) {
  await ensureTables();
  const companyId = getCompanyId(req);
  await prisma.$executeRawUnsafe(
    `UPDATE whatsapp_inbox_quick_replies
     SET system_key = 'PICKUP_READY', show_on_orders = TRUE
     WHERE company_id = $1 AND LOWER(name) = LOWER('Pronto para retirada') AND system_key IS NULL
       AND NOT EXISTS (SELECT 1 FROM whatsapp_inbox_quick_replies WHERE company_id = $1 AND system_key = 'PICKUP_READY')`,
    companyId
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO whatsapp_inbox_quick_replies (id, company_id, name, message, media, show_on_orders, system_key)
     VALUES ($1, $2, 'Pronto para retirada', 'Olá, {nome}! Seu pedido #{pedido} está pronto para retirada no local. Estamos aguardando você!', '[]'::jsonb, TRUE, 'PICKUP_READY')
     ON CONFLICT (company_id, system_key) WHERE system_key IS NOT NULL DO NOTHING`,
    randomUUID(), companyId
  );
  return res.json(await prisma.$queryRawUnsafe(
    `SELECT id, name, message, media, show_on_orders AS "showOnOrders", system_key AS "systemKey"
     FROM whatsapp_inbox_quick_replies WHERE company_id = $1 ORDER BY CASE WHEN system_key = 'PICKUP_READY' THEN 0 ELSE 1 END, name`,
    companyId
  ));
}

export async function getWhatsappInboxPreferences(req: Request, res: Response) {
  await ensureTables();
  const companyId = getCompanyId(req);
  await prisma.$executeRawUnsafe(
    `INSERT INTO whatsapp_inbox_preferences (company_id, order_controls_enabled) VALUES ($1, TRUE)
     ON CONFLICT (company_id) DO NOTHING`,
    companyId
  );
  const rows = await prisma.$queryRawUnsafe<Array<{ orderControlsEnabled: boolean }>>(
    `SELECT order_controls_enabled AS "orderControlsEnabled" FROM whatsapp_inbox_preferences WHERE company_id = $1`,
    companyId
  );
  return res.json(rows[0] ?? { orderControlsEnabled: true });
}

export async function updateWhatsappInboxPreferences(req: Request, res: Response) {
  await ensureTables();
  const body = z.object({ orderControlsEnabled: z.boolean() }).parse(req.body);
  const rows = await prisma.$queryRawUnsafe<Array<{ orderControlsEnabled: boolean }>>(
    `INSERT INTO whatsapp_inbox_preferences (company_id, order_controls_enabled, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (company_id) DO UPDATE SET order_controls_enabled = EXCLUDED.order_controls_enabled, updated_at = NOW()
     RETURNING order_controls_enabled AS "orderControlsEnabled"`,
    getCompanyId(req), body.orderControlsEnabled
  );
  return res.json(rows[0]);
}

export async function listWhatsappCustomerOrders(req: Request, res: Response) {
  await ensureTables();
  const phone = digits(req.params.phone);
  const includeCompleted = String(req.query.includeCompleted ?? "false") === "true";
  if (phone.length < 8) return res.status(400).json({ message: "Numero de telefone invalido" });
  const orders = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT o.id, o."orderNumber", o.status, o."fulfillmentType", o."paymentMethod", o.total,
            o."paidAt", o."createdAt"
     FROM "Order" o
     INNER JOIN "Customer" c ON c.id = o."customerId" AND c."companyId" = o."companyId"
     WHERE o."companyId" = $1 AND o."deletedAt" IS NULL
       AND RIGHT(REGEXP_REPLACE(c.phone, '\\D', '', 'g'), 8) = RIGHT($2, 8)
       AND ($3::boolean = TRUE OR o.status NOT IN ('FINISHED', 'CANCELED'))
     ORDER BY o."createdAt" DESC
     LIMIT 10`,
    getCompanyId(req), phone, includeCompleted
  );
  return res.json(orders);
}

export async function createWhatsappQuickReply(req: Request, res: Response) {
  await ensureTables();
  const body = z.object({ name: z.string().trim().min(2).max(50), message: z.string().trim().max(4000).default(""), media: z.array(z.object({ url: z.string(), filename: z.string(), mimeType: z.string() })).max(5).default([]), showOnOrders: z.boolean().default(true) }).parse(req.body);
  if (!body.message && !body.media.length) return res.status(400).json({ message: "Adicione texto ou anexo ao atalho" });
  const id = randomUUID();
  await prisma.$executeRawUnsafe(`INSERT INTO whatsapp_inbox_quick_replies (id, company_id, name, message, media, show_on_orders) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`, id, getCompanyId(req), body.name, body.message, JSON.stringify(body.media), body.showOnOrders);
  return res.status(201).json({ id, ...body });
}

export async function updateWhatsappQuickReply(req: Request, res: Response) {
  await ensureTables();
  const body = z.object({ name: z.string().trim().min(2).max(50), message: z.string().trim().max(4000).default(""), media: z.array(z.object({ url: z.string(), filename: z.string(), mimeType: z.string() })).max(5).default([]), showOnOrders: z.boolean().optional() }).parse(req.body);
  const result = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; message: string }>>(
    `UPDATE whatsapp_inbox_quick_replies SET name = $3, message = $4, media = $5::jsonb, show_on_orders = COALESCE($6, show_on_orders)
     WHERE id = $1 AND company_id = $2
     RETURNING id, name, message, media, show_on_orders AS "showOnOrders", system_key AS "systemKey"`,
    req.params.id, getCompanyId(req), body.name, body.message, JSON.stringify(body.media), body.showOnOrders ?? null
  );
  if (!result[0]) return res.status(404).json({ message: "Atalho não encontrado" });
  return res.json(result[0]);
}

export async function deleteWhatsappQuickReply(req: Request, res: Response) {
  await ensureTables();
  const systemReply = await prisma.$queryRawUnsafe<Array<{ systemKey: string | null }>>(
    `SELECT system_key AS "systemKey" FROM whatsapp_inbox_quick_replies WHERE id = $1 AND company_id = $2`,
    req.params.id, getCompanyId(req)
  );
  if (systemReply[0]?.systemKey) return res.status(400).json({ message: "O botão padrão pode ser editado, mas não excluído" });
  const result = await prisma.$executeRawUnsafe(`DELETE FROM whatsapp_inbox_quick_replies WHERE id = $1 AND company_id = $2`, req.params.id, getCompanyId(req));
  if (!result) return res.status(404).json({ message: "Atalho não encontrado" });
  return res.status(204).send();
}

export async function receiveWhatsappInboxWebhook(req: Request, res: Response) {
  const suppliedKey = String(req.headers["x-hub-api-key"] ?? req.headers["x-webhook-secret"] ?? "");
  const expectedHash = process.env.WHATSAPP_INBOX_WEBHOOK_SECRET ? createHash("sha256").update(process.env.WHATSAPP_INBOX_WEBHOOK_SECRET).digest() : Buffer.from("fc8704fb94cb5f6a2852aaddde0974f34cd6a2f43bc9e77538a9d42d52f03f97", "hex");
  if (!suppliedKey || !timingSafeEqual(createHash("sha256").update(suppliedKey).digest(), expectedHash)) return res.status(401).json({ message: "Webhook nao autorizado" });
  await ensureTables();
  const payload = (req.body ?? {}) as Record<string, any>;
  const companyId = String(payload.tenant_id ?? payload.companyId ?? payload.tenantId ?? "");
  const phone = digits(payload.from ?? payload.phone ?? payload.sender ?? payload.data?.key?.remoteJid);
  if (!companyId || phone.length < 8) return res.status(400).json({ message: "Payload incompleto" });
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) return res.status(404).json({ message: "Empresa nao encontrada" });
  const externalId = String(payload.id ?? payload.message_id ?? payload.data?.key?.id ?? randomUUID());
  const locationText = String(payload.locationAddress ?? payload.locationName ?? "");
  const text = String(payload.text ?? payload.message ?? payload.body ?? payload.data?.message?.conversation ?? locationText);
  let savedLocationAddress = locationText || (text && !/^localiza[cç][aã]o recebida$/i.test(text) && !/^https?:\/\//i.test(text) ? text : "Localizacao recebida pelo WhatsApp");
  const contactName = String(payload.pushName ?? payload.contact_name ?? payload.name ?? "") || null;
  const direction = payload.direction === "out" || payload.fromMe === true ? "out" : "in";
  const quote = z.object({ id: z.string().max(200), text: z.string().max(4000), messageType: z.string().max(40), author: z.string().max(100).optional() }).safeParse(payload.quotedMessage);
  const textCoordinates = coordinatesFromText(text);
  const rawLatitude = payload.latitude ?? payload.lat ?? textCoordinates.latitude;
  const rawLongitude = payload.longitude ?? payload.lng ?? payload.lon ?? textCoordinates.longitude;
  const latitude = rawLatitude === null || rawLatitude === undefined || rawLatitude === "" ? NaN : Number(rawLatitude);
  const longitude = rawLongitude === null || rawLongitude === undefined || rawLongitude === "" ? NaN : Number(rawLongitude);
  let geocoded: Awaited<ReturnType<typeof reverseGeocode>> = null;
  if (Number.isFinite(latitude) && Number.isFinite(longitude) && savedLocationAddress === "Localizacao recebida pelo WhatsApp") {
    geocoded = await reverseGeocode(latitude, longitude);
    if (geocoded) savedLocationAddress = geocoded.address;
  }
  await prisma.$executeRawUnsafe(`
    INSERT INTO whatsapp_inbox_messages (id, company_id, external_id, phone, contact_name, direction, body, latitude, longitude, sent_at, read_at, quoted_message, message_type)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), CASE WHEN $6 = 'out' THEN NOW() ELSE NULL END, $10::jsonb, $11)
    ON CONFLICT (company_id, external_id) WHERE external_id IS NOT NULL DO NOTHING
  `, randomUUID(), companyId, externalId, phone, contactName, direction, text, Number.isFinite(latitude) ? latitude : null, Number.isFinite(longitude) ? longitude : null, quote.success ? JSON.stringify(quote.data) : null, String(payload.messageType ?? 'text').slice(0, 40));
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    const customer = await prisma.customer.findFirst({
      where: { companyId, deletedAt: null, phone: { in: [phone, `+${phone}`] } }
    });
    if (customer) {
      const duplicate = await prisma.customerAddress.findFirst({ where: { customerId: customer.id, latitude, longitude } });
      if (!duplicate) {
        await prisma.customerAddress.updateMany({ where: { customerId: customer.id, isDefault: true }, data: { isDefault: false } });
        await prisma.customerAddress.create({
          data: {
            companyId, customerId: customer.id, label: "Localizacao WhatsApp",
            address: savedLocationAddress, number: "S/N", district: "A confirmar",
            latitude, longitude, isDefault: true
          }
        });
      }
      await prisma.customer.update({
        where: { id: customer.id },
        data: {
          address: customer.address === "Nao informado" || customer.address === "Localizacao recebida pelo WhatsApp" ? savedLocationAddress : customer.address,
          district: customer.district === "Nao informado" ? "A confirmar" : customer.district
        }
      });
    }
  }
  return res.status(204).end();
}
