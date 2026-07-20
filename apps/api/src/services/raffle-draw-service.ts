import { Prisma } from "@prisma/client";
import {
  CaixaLotteryError,
  extractWinningDigits,
  fetchCaixaLotteryResult,
  getSaoPauloDateKey,
  normalizeCaixaModality
} from "./caixa-lottery-service.js";
import { env } from "../utils/env.js";
import { prisma } from "../utils/prisma.js";

const PROCESSABLE_DRAW_STATUSES = ["SCHEDULED", "WAITING_CONTEST", "WAITING_RESULT", "ERROR"] as const;
const AUTOMATIC_RETRY_DRAW_STATUSES = ["SCHEDULED", "WAITING_CONTEST", "WAITING_RESULT"] as const;

function publicParticipantName(name?: string | null) {
  if (!name) return null;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? null;
  return `${parts[0]} ${parts[parts.length - 1]?.slice(0, 1) ?? ""}.`;
}

function isValidWinnerNumber(number: Awaited<ReturnType<typeof findWinningNumber>>) {
  if (!number) return false;
  return (
    number.status === "PAID" &&
    number.order?.status === "PAID" &&
    number.order?.paymentStatus === "APPROVED" &&
    Boolean(number.reservedByParticipant)
  );
}

async function findWinningNumber(companyId: string, raffleId: string, formattedNumber: string) {
  return prisma.raffleNumber.findFirst({
    where: { companyId, raffleId, formattedNumber },
    include: {
      reservedByParticipant: true,
      order: true
    }
  });
}

async function markDrawWaiting(raffleId: string, message: string) {
  await prisma.raffle.update({
    where: { id: raffleId },
    data: {
      drawStatus: "WAITING_RESULT",
      drawLastError: message
    }
  });
  return { status: "WAITING_RESULT", message };
}

async function markDrawError(raffleId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Erro desconhecido na apuracao automatica.";
  const raffle = await prisma.raffle.findUnique({
    where: { id: raffleId },
    select: { drawAttemptCount: true }
  });
  const transient = !(error instanceof CaixaLotteryError) || error.transient;
  const shouldRetry = transient && (raffle?.drawAttemptCount ?? 0) < env.raffleDrawMaxAttempts;
  await prisma.raffle.update({
    where: { id: raffleId },
    data: {
      drawStatus: shouldRetry ? "WAITING_RESULT" : "ERROR",
      drawLastError: message
    }
  });
  return { status: shouldRetry ? "WAITING_RESULT" : "ERROR", message };
}

export async function processAutomaticRaffleById(raffleId: string, companyId?: string) {
  const locked = await prisma.raffle.updateMany({
    where: {
      id: raffleId,
      ...(companyId ? { companyId } : {}),
      drawMode: "AUTOMATIC_CAIXA",
      drawStatus: { in: [...PROCESSABLE_DRAW_STATUSES] },
      drawConfirmedAt: null
    },
    data: {
      drawStatus: "PROCESSING",
      drawLastAttemptAt: new Date(),
      drawAttemptCount: { increment: 1 },
      drawLastError: null
    }
  });

  if (locked.count === 0) {
    return { status: "SKIPPED", message: "Rifa nao esta elegivel para apuracao automatica agora." };
  }

  try {
    const raffle = await prisma.raffle.findFirstOrThrow({
      where: { id: raffleId, ...(companyId ? { companyId } : {}) }
    });

    if (!raffle.drawScheduledAt) throw new CaixaLotteryError("Informe a data e horario previstos do sorteio.", false);
    if (!raffle.drawLotteryModality) throw new CaixaLotteryError("Informe a modalidade da Loteria CAIXA.", false);
    if (raffle.drawScheduledAt.getTime() > Date.now()) {
      await prisma.raffle.update({ where: { id: raffle.id }, data: { drawStatus: raffle.drawContestNumber ? "SCHEDULED" : "WAITING_CONTEST" } });
      return { status: "SCHEDULED", message: "Sorteio ainda nao chegou ao horario previsto." };
    }

    const modality = normalizeCaixaModality(raffle.drawLotteryModality);
    const result = await fetchCaixaLotteryResult(modality, raffle.drawContestNumber);
    const scheduledDateKey = getSaoPauloDateKey(raffle.drawScheduledAt);

    if (raffle.drawContestNumber && result.contestNumber !== raffle.drawContestNumber.replace(/\D/g, "")) {
      throw new CaixaLotteryError("A CAIXA retornou concurso diferente do solicitado.", false);
    }
    if (result.officialDateKey !== scheduledDateKey) {
      return markDrawWaiting(raffle.id, `Resultado da CAIXA e de ${result.officialDateKey}, diferente da data agendada ${scheduledDateKey}.`);
    }

    const winningNumber = extractWinningDigits(result.baseNumber, raffle.numberDigits);
    const number = await findWinningNumber(raffle.companyId, raffle.id, winningNumber);
    const validWinner = isValidWinnerNumber(number);
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      let winner: { id: string } | null = null;
      if (validWinner && number) {
        winner = await tx.raffleWinner.findFirst({
          where: {
            companyId: raffle.companyId,
            raffleId: raffle.id,
            raffleNumberId: number.id
          },
          select: { id: true }
        });

        if (!winner) {
          winner = await tx.raffleWinner.create({
            data: {
              companyId: raffle.companyId,
              raffleId: raffle.id,
              raffleNumberId: number.id,
              number: number.number,
              formattedNumber: number.formattedNumber,
              participantName: publicParticipantName(number.reservedByParticipant?.name),
              participantPhone: number.reservedByParticipant?.phone ?? null,
              drawMethod: "CAIXA_FEDERAL",
              notes: `Parabens! O numero ${number.formattedNumber} foi o ganhador da rifa ${raffle.title}, apurada pelo concurso ${result.contestNumber} da Loteria Federal em ${result.officialDateKey}. Numero-base: ${result.baseNumber}.`,
              published: true,
              drawnAt: now
            },
            select: { id: true }
          });
        }
      }

      await tx.raffleAuditLog.create({
        data: {
          companyId: raffle.companyId,
          raffleId: raffle.id,
          action: validWinner ? "RAFFLE_CAIXA_DRAW_CONFIRMED" : "RAFFLE_CAIXA_DRAW_NO_VALID_PARTICIPANT",
          entity: "Raffle",
          entityId: raffle.id,
          newValue: {
            modality,
            contestNumber: result.contestNumber,
            baseNumber: result.baseNumber,
            winningNumber,
            officialDate: result.officialDateKey,
            winnerNumberId: number?.id ?? null,
            hasValidParticipant: validWinner
          }
        }
      });

      return tx.raffle.update({
        where: { id: raffle.id },
        data: {
          status: "FINISHED",
          finishedAt: raffle.finishedAt ?? now,
          drawStatus: validWinner ? "CONFIRMED" : "NO_VALID_PARTICIPANT",
          drawLotteryModality: modality,
          drawContestNumber: result.contestNumber,
          drawBaseNumber: result.baseNumber,
          drawDigits: raffle.numberDigits,
          drawWinningNumber: winningNumber,
          drawOfficialDate: result.officialDate,
          drawConfirmedAt: now,
          drawRawResponse: result.raw as Prisma.InputJsonValue,
          drawWinnerParticipantId: validWinner ? number?.reservedByParticipantId ?? null : null,
          drawWinnerOrderId: validWinner ? number?.orderId ?? null : null,
          drawWinnerNumberId: validWinner ? number?.id ?? null : null,
          drawLastError: validWinner ? null : "Numero sorteado sem participante valido ou pagamento aprovado.",
          ...(winner ? {} : {})
        }
      });
    });

    return { status: updated.drawStatus, winningNumber };
  } catch (error) {
    return markDrawError(raffleId, error);
  }
}

export async function processDueAutomaticRaffles(limit = 20) {
  const retryBefore = new Date(Date.now() - env.raffleDrawRetryIntervalMs);
  const raffles = await prisma.raffle.findMany({
    where: {
      drawMode: "AUTOMATIC_CAIXA",
      drawStatus: { in: [...AUTOMATIC_RETRY_DRAW_STATUSES] },
      drawScheduledAt: { lte: new Date() },
      OR: [{ drawLastAttemptAt: null }, { drawLastAttemptAt: { lte: retryBefore } }],
      drawAttemptCount: { lt: env.raffleDrawMaxAttempts }
    },
    orderBy: { drawScheduledAt: "asc" },
    take: limit,
    select: { id: true }
  });

  for (const raffle of raffles) {
    await processAutomaticRaffleById(raffle.id);
  }

  return { processed: raffles.length };
}
