import { logger, prisma, redis } from "./lib.js";
import { startMessageWorker } from "./queue.js";

const worker = startMessageWorker();
logger.info("WhatsApp message worker ready");
async function shutdown() { await worker.close(); await Promise.allSettled([prisma.$disconnect(), redis.quit()]); process.exit(0); }
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
