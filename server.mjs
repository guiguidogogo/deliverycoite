import http from "node:http";
import next from "next";
import { app as apiApp } from "./apps/api/dist/src/app.js";
import { startBackupScheduler } from "./apps/api/dist/src/services/backup.js";
import { attachRealtimeServer } from "./apps/api/dist/src/services/realtime.js";
import { prisma } from "./apps/api/dist/src/utils/prisma.js";

const port = Number(process.env.PORT ?? 10000);
const web = next({ dev: false, dir: "./apps/web" });

await prisma.$connect();
await web.prepare();

const handle = web.getRequestHandler();
const server = http.createServer((req, res) => {
  apiApp(req, res, () => {
    void handle(req, res);
  });
});

attachRealtimeServer(server);
startBackupScheduler();

server.listen(port, "0.0.0.0", () => {
  console.log(`Delivery online na porta ${port}`);
});

async function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
