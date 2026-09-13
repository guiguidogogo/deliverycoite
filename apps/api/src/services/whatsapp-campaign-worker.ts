import { prisma } from "../utils/prisma.js";
import { getHubWhatsappJob, sendHubWhatsappText, waitForHubWhatsappJob } from "./hub-whatsapp.js";

let processing = false;

function personalize(message: string, customerName: string) {
  return message.replace(/\{\{?nome\}?\}/gi, customerName);
}

async function refreshCampaign(campaignId: string) {
  const [pending, processingCount, sent, failed] = await Promise.all([
    prisma.whatsappCampaignRecipient.count({ where: { campaignId, status: "PENDING" } }),
    prisma.whatsappCampaignRecipient.count({ where: { campaignId, status: "PROCESSING" } }),
    prisma.whatsappCampaignRecipient.count({ where: { campaignId, status: "SENT" } }),
    prisma.whatsappCampaignRecipient.count({ where: { campaignId, status: "FAILED" } })
  ]);
  await prisma.whatsappCampaign.updateMany({
    where: { id: campaignId, status: { in: ["RUNNING", "PAUSED"] } },
    data: {
      sentCount: sent,
      failedCount: failed,
      ...(pending === 0 && processingCount === 0
        ? { status: "COMPLETED", completedAt: new Date() }
        : {})
    }
  });
}

async function settleProcessingRecipients() {
  await prisma.whatsappCampaignRecipient.updateMany({
    where: {
      status: "PROCESSING",
      gatewayJobId: null,
      updatedAt: { lt: new Date(Date.now() - 10 * 60_000) }
    },
    data: { status: "PENDING", errorMessage: "Envio interrompido antes de entrar na fila; nova tentativa agendada" }
  });
  const recipients = await prisma.whatsappCampaignRecipient.findMany({
    where: { status: "PROCESSING", gatewayJobId: { not: null } },
    select: { id: true, campaignId: true, gatewayJobId: true, attempts: true },
    take: 50
  });
  const touched = new Set<string>();
  await Promise.all(recipients.map(async (recipient) => {
    try {
      const job = await getHubWhatsappJob(recipient.gatewayJobId!);
      if (job.status === "pending" || job.status === "processing") return;
      touched.add(recipient.campaignId);
      await prisma.whatsappCampaignRecipient.update({
        where: { id: recipient.id },
        data: job.status === "sent"
          ? { status: "SENT", sentAt: new Date(), errorMessage: null }
          : recipient.attempts < 3
            ? { status: "PENDING", gatewayJobId: null, errorMessage: job.errorCode ?? "Evolution recusou a mensagem" }
            : { status: "FAILED", errorMessage: job.errorCode ?? "Evolution recusou a mensagem" }
      });
    } catch {
      // Mantem em processamento para consultar novamente sem duplicar o envio.
    }
  }));
  await Promise.all([...touched].map(refreshCampaign));
}

async function processCampaign(campaign: {
  id: string;
  companyId: string;
  message: string;
  batchSize: number;
  intervalMinutes: number;
}) {
  const nextBatchAt = new Date(Date.now() + campaign.intervalMinutes * 60_000);
  const lease = await prisma.whatsappCampaign.updateMany({
    where: { id: campaign.id, status: "RUNNING", nextBatchAt: { lte: new Date() } },
    data: { nextBatchAt }
  });
  if (lease.count === 0) return;

  const claimed = await prisma.$transaction(async (transaction) => {
    const recipients = await transaction.whatsappCampaignRecipient.findMany({
      where: { campaignId: campaign.id, status: "PENDING", attempts: { lt: 3 } },
      orderBy: { createdAt: "asc" },
      take: campaign.batchSize
    });
    if (!recipients.length) return [];
    const ids = recipients.map((recipient) => recipient.id);
    await transaction.whatsappCampaignRecipient.updateMany({
      where: { id: { in: ids }, status: "PENDING" },
      data: { status: "PROCESSING", attempts: { increment: 1 }, errorMessage: null }
    });
    return recipients;
  });

  await Promise.all(claimed.map(async (recipient) => {
    try {
      const queued = await sendHubWhatsappText(
        campaign.companyId,
        recipient.phone,
        personalize(campaign.message, recipient.customerName),
        `campaign_${recipient.id}`
      );
      const job = await waitForHubWhatsappJob(queued.job_id);
      await prisma.whatsappCampaignRecipient.update({
        where: { id: recipient.id },
        data: job.status === "sent"
          ? { status: "SENT", sentAt: new Date(), gatewayJobId: queued.job_id }
          : job.status === "failed"
            ? recipient.attempts + 1 >= 3
              ? { status: "FAILED", gatewayJobId: null, errorMessage: job.errorCode ?? "Evolution recusou a mensagem" }
              : { status: "PENDING", gatewayJobId: null, errorMessage: job.errorCode ?? "Evolution recusou a mensagem" }
            : { status: "PROCESSING", gatewayJobId: queued.job_id }
      });
    } catch (error) {
      const attempts = recipient.attempts + 1;
      await prisma.whatsappCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: attempts >= 3 ? "FAILED" : "PENDING",
          gatewayJobId: null,
          errorMessage: error instanceof Error ? error.message : "Falha ao enviar pelo Evolution"
        }
      });
    }
  }));
  await refreshCampaign(campaign.id);
}

export async function processWhatsappCampaigns() {
  if (processing) return;
  processing = true;
  try {
    await settleProcessingRecipients();
    const campaigns = await prisma.whatsappCampaign.findMany({
      where: { status: "RUNNING", nextBatchAt: { lte: new Date() } },
      orderBy: { nextBatchAt: "asc" },
      take: 10,
      select: { id: true, companyId: true, message: true, batchSize: true, intervalMinutes: true }
    });
    for (const campaign of campaigns) await processCampaign(campaign);
  } finally {
    processing = false;
  }
}

export function startWhatsappCampaignWorker() {
  const run = () => void processWhatsappCampaigns().catch((error) => {
    console.error("Falha ao processar campanhas de WhatsApp", error);
  });
  run();
  return setInterval(run, 15_000);
}
