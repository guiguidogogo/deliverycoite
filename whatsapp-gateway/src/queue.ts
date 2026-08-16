import { Queue, Worker, type Job } from "bullmq";
import type { Prisma } from "@prisma/client";
import { redis, prisma, logger } from "./lib.js";
import { whatsappProvider } from "./providers/evolution/evolution-provider.js";

export type MessagePayload = {
  messageJobId: string;
  type: "text" | "image" | "document";
  instanceName: string;
  to: string;
  message?: string;
  mediaUrl?: string;
  filename?: string;
  caption?: string;
};

export const messageQueue = new Queue<MessagePayload>("whatsapp-messages", { connection: redis, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: 1000, removeOnFail: 5000 } });

async function processMessage(job: Job<MessagePayload>) {
  const data = job.data;
  await prisma.messageJob.update({ where: { id: data.messageJobId }, data: { status: "processing", attempts: { increment: 1 } } });
  try {
    let result: any;
    if (data.type === "text") result = await whatsappProvider.sendText(data.instanceName, data.to, data.message!);
    else if (data.type === "image") result = await whatsappProvider.sendImage(data.instanceName, data.to, data.mediaUrl!, data.caption);
    else result = await whatsappProvider.sendDocument(data.instanceName, data.to, data.mediaUrl!, data.filename!, data.caption);
    const providerId = result?.key?.id ?? result?.message?.key?.id ?? null;
    await prisma.messageJob.update({ where: { id: data.messageJobId }, data: { status: "sent", providerId } });
  } catch (error) {
    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) await prisma.messageJob.update({ where: { id: data.messageJobId }, data: { status: "failed", errorCode: "provider_error" } });
    throw error;
  }
}

export function startMessageWorker() {
  const worker = new Worker<MessagePayload>("whatsapp-messages", processMessage, { connection: redis, concurrency: 10, limiter: { max: 30, duration: 1000 } });
  worker.on("failed", (job, error) => logger.error({ jobId: job?.id, err: error.message }, "Message job failed"));
  return worker;
}

export async function enqueueMessage(instanceId: string, payload: Omit<MessagePayload, "messageJobId">) {
  const record = await prisma.messageJob.create({ data: { instanceId, type: payload.type, recipient: payload.to, payload: payload as unknown as Prisma.InputJsonValue } });
  await messageQueue.add(payload.type, { ...payload, messageJobId: record.id }, { jobId: record.id });
  return record;
}
