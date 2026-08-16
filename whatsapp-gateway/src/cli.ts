import { prisma } from "./lib.js";
import { generateApiKey, hashApiKey } from "./security.js";

const [command, ...args] = process.argv.slice(2);
const option = (name: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };

async function main() {
  if (command === "create-app") {
    const slug = option("slug")?.toLowerCase(); const name = option("name");
    if (!slug?.match(/^[a-z0-9-]{2,40}$/) || !name) throw new Error("Uso: admin create-app --slug delivery --name Delivery");
    const app = await prisma.app.upsert({ where: { slug }, create: { slug, name }, update: { name, active: true } });
    const generated = generateApiKey(slug);
    await prisma.apiKey.create({ data: { appId: app.id, keyPrefix: generated.prefix, keyHash: await hashApiKey(generated.plain), name: option("key-name") ?? "initial" } });
    console.log(JSON.stringify({ app_id: app.id, slug, api_key: generated.plain, warning: "Salve agora. A chave não poderá ser recuperada." }, null, 2));
  } else if (command === "rotate-key") {
    const slug = option("slug"); if (!slug) throw new Error("Informe --slug");
    const app = await prisma.app.findUniqueOrThrow({ where: { slug } }); const generated = generateApiKey(slug);
    await prisma.apiKey.create({ data: { appId: app.id, keyPrefix: generated.prefix, keyHash: await hashApiKey(generated.plain), name: option("key-name") ?? "rotation" } });
    console.log(JSON.stringify({ api_key: generated.plain, warning: "Salve agora. A chave não poderá ser recuperada." }, null, 2));
  } else if (command === "revoke-key") {
    const prefix = option("prefix"); if (!prefix) throw new Error("Informe --prefix");
    await prisma.apiKey.update({ where: { keyPrefix: prefix }, data: { active: false, revokedAt: new Date() } }); console.log("Chave revogada.");
  } else if (command === "deactivate-app") {
    const slug = option("slug"); if (!slug) throw new Error("Informe --slug");
    await prisma.app.update({ where: { slug }, data: { active: false } }); console.log("Aplicação desativada.");
  } else throw new Error("Comandos: create-app, rotate-key, revoke-key, deactivate-app");
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
