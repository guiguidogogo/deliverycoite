import type { RequestHandler } from "express";
import { prisma, HttpError } from "./lib.js";
import { verifyApiKey } from "./api-key.js";
export { generateApiKey, hashApiKey, requestHash, verifyApiKey } from "./api-key.js";

declare global {
  namespace Express {
    interface Request { hubApp?: { id: string; slug: string; name: string }; }
  }
}

export const authenticateApp: RequestHandler = async (req, _res, next) => {
  try {
    const raw = req.header("x-hub-api-key") ?? req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!raw || raw.length > 200) throw new HttpError(401, "API Key ausente", "unauthorized");
    const prefix = raw.split(".", 1)[0];
    const key = await prisma.apiKey.findUnique({ where: { keyPrefix: prefix }, include: { app: true } });
    if (!key || !key.active || key.revokedAt || !key.app.active || (key.expiresAt && key.expiresAt <= new Date()) || !(await verifyApiKey(raw, key.keyHash))) {
      throw new HttpError(401, "API Key inválida", "unauthorized");
    }
    req.hubApp = { id: key.app.id, slug: key.app.slug, name: key.app.name };
    void prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    next();
  } catch (error) { next(error); }
};
