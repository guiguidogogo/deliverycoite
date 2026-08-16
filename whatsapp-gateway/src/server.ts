import { app } from "./app.js";
import { config } from "./config.js";
import { logger, prisma, redis } from "./lib.js";
import { startMessageWorker } from "./queue.js";

const server = app.listen(config.API_PORT, "0.0.0.0", () => logger.info({ port: config.API_PORT }, "WhatsApp Gateway ready"));
const worker = config.RUN_WORKER ? startMessageWorker() : undefined;

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  server.close();
  await worker?.close();
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
