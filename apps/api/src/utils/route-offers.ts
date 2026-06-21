import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

export const ROUTE_OFFER_SECONDS = 30;

export function routeOfferExpiresAt(now = new Date()) {
  return new Date(now.getTime() + ROUTE_OFFER_SECONDS * 1000);
}

export async function expirePendingRouteOffers(
  companyId: string,
  transaction: Prisma.TransactionClient | typeof prisma = prisma
) {
  return transaction.deliveryRoute.updateMany({
    where: {
      companyId,
      status: "CREATED",
      offerExpiresAt: { lte: new Date() }
    },
    data: {
      status: "CANCELED",
      canceledAt: new Date(),
      declinedAt: new Date()
    }
  });
}
