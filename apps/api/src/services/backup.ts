import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import cron from "node-cron";
import { prisma } from "../utils/prisma.js";

async function runBackup() {
  const backupDir = path.resolve(process.cwd(), "backups");
  await mkdir(backupDir, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);

  const companies = await prisma.company.findMany({
    where: { active: true },
    select: { id: true, subdomain: true }
  });

  for (const company of companies) {
    const where = { companyId: company.id };
    const payload = {
      generatedAt: new Date().toISOString(),
      companyId: company.id,
      orders: await prisma.order.findMany({ where, include: { items: true, customer: true } }),
      products: await prisma.product.findMany({ where }),
      categories: await prisma.category.findMany({ where }),
      customers: await prisma.customer.findMany({ where })
    };

    await writeFile(
      path.join(backupDir, `backup-${company.subdomain}-${today}.json`),
      JSON.stringify(payload, null, 2),
      "utf-8"
    );
  }
}

export function startBackupScheduler() {
  cron.schedule("0 3 * * *", () => {
    runBackup().catch((error) => {
      console.error("Erro no backup automatico", error);
    });
  });
}
