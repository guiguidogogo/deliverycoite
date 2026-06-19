import { execFileSync } from "node:child_process";
import path from "node:path";

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

const prismaExecutable = process.platform === "win32" ? "prisma.cmd" : "prisma";
const migrationFile = path.resolve(
  process.cwd(),
  "prisma/migrations/20260619160000_multiempresa_postgresql/migration.sql"
);

execFileSync(
  prismaExecutable,
  ["db", "execute", "--schema", "prisma/schema.prisma", "--file", migrationFile],
  { stdio: "inherit", env: process.env }
);
