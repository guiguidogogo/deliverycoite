import { CashEntryType, PaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

type PaymentEntry = {
  orderId: string;
  amount: Prisma.Decimal;
  paymentMethod: PaymentMethod;
  description: string;
};

export async function recordCashPayments(sessionId: string, payments: PaymentEntry[]) {
  if (!payments.length) return;

  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(74201986)`;

    const existingEntries = await transaction.cashEntry.findMany({
      where: {
        orderId: { in: payments.map((payment) => payment.orderId) },
        paymentMethod: { not: null }
      },
      select: { orderId: true }
    });
    const existingOrderIds = new Set(existingEntries.map((entry) => entry.orderId));
    const missingPayments = payments.filter((payment) => !existingOrderIds.has(payment.orderId));

    if (!missingPayments.length) return;

    await transaction.cashEntry.createMany({
      data: missingPayments.map((payment) => ({
        sessionId,
        type: CashEntryType.MANUAL_INCOME,
        amount: payment.amount,
        paymentMethod: payment.paymentMethod,
        orderId: payment.orderId,
        description: payment.description
      }))
    });
  });
}
