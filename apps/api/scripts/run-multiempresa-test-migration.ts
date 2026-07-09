import { execSync } from "node:child_process";

const environment = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "").toLowerCase();
const databaseUrl = process.env.DATABASE_URL ?? "";
const allowedEnvironments = new Set(["test", "testing", "staging", "homolog", "homologation"]);

if (!allowedEnvironments.has(environment)) {
  throw new Error(
    "Migration bloqueada: defina APP_ENV como test, staging ou homologation."
  );
}

if (!databaseUrl) {
  throw new Error("Migration bloqueada: DATABASE_URL nao foi definida.");
}

const normalizedUrl = databaseUrl.toLowerCase();
if (/(prod|production)/.test(normalizedUrl)) {
  throw new Error("Migration bloqueada: a DATABASE_URL aparenta ser de producao.");
}

const command = "npx prisma migrate deploy --schema prisma/schema.prisma";
try {
  execSync(command, { stdio: "inherit", env: process.env, shell: true });
} catch (error) {
  console.warn("Migration deploy falhou no DEV; tentando prisma db push como fallback.");
  execSync("npx prisma db push --schema prisma/schema.prisma --accept-data-loss", {
    stdio: "inherit",
    env: process.env,
    shell: true
  });
}
