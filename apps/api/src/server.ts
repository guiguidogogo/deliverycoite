import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { app } from "./app.js";
import { attachRealtimeServer } from "./services/realtime.js";
import { env } from "./utils/env.js";
import { prisma } from "./utils/prisma.js";

const require = createRequire(import.meta.url);

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

function runPackageScript(script: string) {
  const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
  const packageJsonPath = path.resolve(process.cwd(), "package.json");
  const isApiWorkspaceRoot = existsSync(packageJsonPath)
    && (require(packageJsonPath) as { name?: string }).name === "@delivery/api";
  const args = isApiWorkspaceRoot
    ? ["run", script]
    : ["run", script, "-w", "@delivery/api"];

  execFileSync(npmExecutable, args, {
    stdio: "inherit",
    env: process.env
  });
}

async function bootstrap() {
  loadEnvFile();
  const environment = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "").toLowerCase();
  if (environment !== "production") {
    console.log("DEV detected: applying migrations and seed before starting the API.");
    runPackageScript("migrate:multiempresa:test");
    runPackageScript("prisma:seed");
  }
  await prisma.$connect();

  const server = http.createServer(app);
  attachRealtimeServer(server);

  server.listen(env.port, "0.0.0.0", () => {
    console.log(`API online na porta ${env.port}`);
  });
}

bootstrap().catch((error) => {
  console.error("Falha ao iniciar API", error);
  process.exit(1);
});
