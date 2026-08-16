import type { RequestHandler } from "express";
import { redis, HttpError } from "./lib.js";

export function distributedLimit(scope: string, limit: number, keyFn: (req: any) => string | undefined): RequestHandler {
  return async (req, res, next) => {
    try {
      const id = keyFn(req);
      if (!id) return next();
      const window = Math.floor(Date.now() / 60000);
      const key = `rate:${scope}:${id}:${window}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 70);
      res.setHeader("X-RateLimit-Limit", limit);
      res.setHeader("X-RateLimit-Remaining", Math.max(0, limit - count));
      if (count > limit) throw new HttpError(429, "Limite de requisições excedido", "rate_limited");
      next();
    } catch (error) { next(error); }
  };
}
