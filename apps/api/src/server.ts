import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { app } from "./app.js";
import { reconcileAllMercadoPagoPendingOrders } from "./controllers/orders-controller.js";
import { attachRealtimeServer } from "./services/realtime.js";
import { env } from "./utils/env.js";
import { prisma } from "./utils/prisma.js";

function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    value = value.replace(/^"|"$/g, "");

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function bootstrap() {
  loadEnvFile();
  await prisma.$connect();

  const server = http.createServer(app);
  attachRealtimeServer(server);

  const reconcilePendingPayments = () => {
    void reconcileAllMercadoPagoPendingOrders().catch((error) => {
      console.error("Falha ao reconciliar pagamentos Mercado Pago", error);
    });
  };

  reconcilePendingPayments();
  setInterval(reconcilePendingPayments, 60_000);

  server.listen(env.port, "0.0.0.0", () => {
    console.log(`API online na porta ${env.port}`);
  });
}

bootstrap().catch((error) => {
  console.error("Falha ao iniciar API", error);
  process.exit(1);
});
