import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { prisma } from "./prisma.js";
import { dispatchWhatsappMessage } from "../services/whatsapp.js";

export async function createPasswordReset(params: {
  companyId: string;
  userId?: string;
  customerId?: string;
  phone: string;
  name: string;
}) {
  const code = String(randomInt(100000, 1000000));
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await prisma.passwordReset.updateMany({
    where: {
      companyId: params.companyId,
      usedAt: null,
      ...(params.userId ? { userId: params.userId } : { customerId: params.customerId })
    },
    data: { usedAt: new Date() }
  });
  await prisma.passwordReset.create({
    data: {
      companyId: params.companyId,
      codeHash,
      expiresAt,
      userId: params.userId,
      customerId: params.customerId
    }
  });

  const settings = await prisma.setting.findFirstOrThrow({
    where: { companyId: params.companyId }
  });
  const message = [
    `Ola, ${params.name}!`,
    `Seu codigo para redefinir a senha e: ${code}`,
    "Ele expira em 15 minutos.",
    "Se voce nao solicitou, ignore esta mensagem."
  ].join("\n");
  const sent = await dispatchWhatsappMessage(settings, params.phone, message, params.phone);

  if (sent.channel !== "MENUAI") {
    throw new Error("Envio automatico do WhatsApp indisponivel");
  }
}

export async function validatePasswordReset(params: {
  companyId: string;
  code: string;
  userId?: string;
  customerId?: string;
}) {
  const resets = await prisma.passwordReset.findMany({
    where: {
      companyId: params.companyId,
      usedAt: null,
      expiresAt: { gt: new Date() },
      ...(params.userId ? { userId: params.userId } : { customerId: params.customerId })
    },
    orderBy: { createdAt: "desc" },
    take: 5
  });

  for (const reset of resets) {
    if (await bcrypt.compare(params.code, reset.codeHash)) {
      return reset;
    }
  }

  return null;
}
