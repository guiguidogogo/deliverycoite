import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";
import { calculateDeliveryFee } from "../utils/delivery-fee.js";

const quoteSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180)
});

export async function quoteDelivery(req: Request, res: Response) {
  const coordinates = quoteSchema.parse(req.query);
  const settings = await prisma.setting.findFirstOrThrow({
    include: { deliveryFeeTiers: true }
  });
  const quote = calculateDeliveryFee(settings, coordinates);

  if (quote.fee === null) {
    return res.status(400).json({
      message: "Local fora da area de entrega configurada",
      distanceKm: Number(quote.distanceKm?.toFixed(2))
    });
  }

  return res.json({
    fee: quote.fee,
    distanceKm: quote.distanceKm === null ? null : Number(quote.distanceKm.toFixed(2))
  });
}
