import { CashEntryType, PaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

type PaymentEntry = {
  orderId: string;
  amount: Prisma.Decimal;
  paymentMethod: PaymentMethod;
  paymentDetail?: string | null;
  description: string;
};

export async function recordCashPayments(sessionId: string, companyId: string, payments: PaymentEntry[]) {
  if (!payments.length) return;

  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(74201986)`;

    const existingEntries = await transaction.cashEntry.findMany({
      where: {
        companyId,
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
        companyId,
        sessionId,
        type: CashEntryType.MANUAL_INCOME,
        amount: payment.amount,
        paymentMethod: payment.paymentMethod,
        paymentDetail: payment.paymentDetail,
        direction: "IN",
        category:
          payment.paymentMethod === "CASH"
            ? "SALE_CASH"
            : payment.paymentMethod === "PIX"
              ? "SALE_PIX"
              : payment.paymentDetail === "Cartao Debito"
                ? "SALE_DEBIT"
                : "SALE_CREDIT",
        orderId: payment.orderId,
        description: payment.description
      }))
    });
  });
}
