import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import pino from "pino";
import { config } from "./config.js";

export const prisma = new PrismaClient();
export const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
export const logger = pino({ level: config.LOG_LEVEL, redact: ["req.headers.authorization", "req.headers.x-hub-api-key", "*.apiKey", "*.qr_code", "*.qrcode", "*.base64"] });

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "request_error", public details?: unknown) { super(message); }
}

export const asyncRoute = (handler: (...args: any[]) => Promise<unknown>) => (req: any, res: any, next: any) => Promise.resolve(handler(req, res, next)).catch(next);
