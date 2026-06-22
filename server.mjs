import http from "node:http";
import next from "next";
import { app as apiApp } from "./apps/api/dist/src/app.js";
import { attachRealtimeServer } from "./apps/api/dist/src/services/realtime.js";
import { prisma } from "./apps/api/dist/src/utils/prisma.js";

const port = Number(process.env.PORT ?? 10000);
const web = next({ dev: false, dir: "./apps/web" });

await prisma.$connect();
await web.prepare();

const handle = web.getRequestHandler();
const rootDomain = (process.env.ROOT_DOMAIN ?? "hubregional.com.br")
  .trim()
  .toLowerCase()
  .replace(/^\.+|\.+$/g, "");
const tenantCache = new Map();

function requestHost(req) {
  return String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "")
    .split(",")[0]
    .trim()
    .split(":")[0]
    .toLowerCase()
    .replace(/\.$/, "");
}

async function validWebTenant(req) {
  if (req.url?.startsWith("/api") || req.url?.startsWith("/_next")) return true;
  const acceptsHtml = String(req.headers.accept ?? "").includes("text/html");
  if (!acceptsHtml) return true;
  const host = requestHost(req);
  if (host === `admin.${rootDomain}`) return true;
  if (!host.endsWith(`.${rootDomain}`)) return true;
  const subdomain = host.slice(0, -(rootDomain.length + 1));
  if (!subdomain || subdomain.includes(".")) return false;

  const cached = tenantCache.get(subdomain);
  if (cached && cached.expiresAt > Date.now()) return cached.valid;
  const company = await prisma.company.findFirst({
    where: { subdomain, active: true },
    select: { id: true }
  });
  const valid = Boolean(company);
  tenantCache.set(subdomain, { valid, expiresAt: Date.now() + 60_000 });
  return valid;
}

const server = http.createServer(async (req, res) => {
  if (!(await validWebTenant(req))) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end("<!doctype html><html lang=\"pt-BR\"><body><h1>Empresa nao encontrada</h1><p>Verifique o subdominio informado.</p></body></html>");
    return;
  }
  apiApp(req, res, () => {
    void handle(req, res);
  });
});

attachRealtimeServer(server);

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
