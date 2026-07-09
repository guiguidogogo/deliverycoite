import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();
const DEFAULT_COMPANY_ID = "default-company";

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function upsertCategory(companyId: string, name: string) {
  const slug = slugify(name);
  const existing = await prisma.category.findFirst({ where: { companyId, slug } });
  if (existing) return existing;
  return prisma.category.create({
    data: {
      companyId,
      name,
      slug,
      active: true
    }
  });
}

type SeedTenantConfig = {
  companyId: string;
  companyName: string;
  tradeName: string;
  subdomain: string;
  companyEmail: string;
  companyPhone: string;
  adminEmail: string;
  adminPassword: string;
  createMasterUser?: boolean;
};

async function seedTenantCompany(config: SeedTenantConfig) {
  const company = await prisma.company.upsert({
    where: { id: config.companyId },
    update: {
      companyName: config.companyName,
      tradeName: config.tradeName,
      phone: config.companyPhone,
      whatsapp: config.companyPhone,
      email: config.companyEmail,
      subdomain: config.subdomain,
      active: true,
      marketplaceVisible: true,
      featured: false,
      category: "Lanches",
      city: "Concei??o do Coit?",
      isOpen: true,
      deliveryFee: 5,
      deliveryTimeMin: 35,
      rating: 5,
      plan: "basico"
    },
    create: {
      id: config.companyId,
      companyName: config.companyName,
      tradeName: config.tradeName,
      phone: config.companyPhone,
      whatsapp: config.companyPhone,
      email: config.companyEmail,
      subdomain: config.subdomain,
      active: true,
      marketplaceVisible: true,
      featured: false,
      category: "Lanches",
      city: "Concei??o do Coit?",
      isOpen: true,
      deliveryFee: 5,
      deliveryTimeMin: 35,
      rating: 5,
      plan: "basico"
    }
  });

  const adminHash = await bcrypt.hash(config.adminPassword, 10);
  await prisma.user.upsert({
    where: {
      companyId_email: {
        companyId: company.id,
        email: config.adminEmail
      }
    },
    update: {
      name: "Administrador",
      passwordHash: adminHash,
      role: UserRole.ADMIN,
      active: true
    },
    create: {
      name: "Administrador",
      email: config.adminEmail,
      passwordHash: adminHash,
      role: UserRole.ADMIN,
      companyId: company.id,
      active: true
    }
  });

  if (config.createMasterUser) {
    const masterEmail = (process.env.SEED_MASTER_EMAIL ?? "admin@hubregional.com.br").trim().toLowerCase();
    const masterPassword = process.env.SEED_MASTER_PASSWORD ?? "123456";
    const masterHash = await bcrypt.hash(masterPassword, 10);
    await prisma.user.upsert({
      where: {
        companyId_email: {
          companyId: company.id,
          email: masterEmail
        }
      },
      update: {
        name: "Administrador Master",
        passwordHash: masterHash,
        role: UserRole.SUPER_ADMIN,
        active: true
      },
      create: {
        name: "Administrador Master",
        email: masterEmail,
        passwordHash: masterHash,
        role: UserRole.SUPER_ADMIN,
        companyId: company.id,
        active: true
      }
    });
  }

  const categories = ["Hamburgueres", "Pizzas", "Bebidas", "Combos", "Sobremesas"];
  for (const name of categories) {
    await upsertCategory(company.id, name);
  }

  const hamb = await prisma.category.findFirstOrThrow({ where: { companyId: company.id, slug: "hamburgueres" } });
  const bebidas = await prisma.category.findFirstOrThrow({ where: { companyId: company.id, slug: "bebidas" } });

  if ((await prisma.product.count({ where: { companyId: company.id } })) === 0) {
    await prisma.product.createMany({
      data: [
        {
          companyId: company.id,
          name: "X-Burger",
          description: "Pao, carne, queijo e molho especial",
          price: 15,
          imageUrl: "https://images.unsplash.com/photo-1550547660-d9450f859349",
          categoryId: hamb.id,
          active: true,
          available: true
        },
        {
          companyId: company.id,
          name: "Refrigerante Lata",
          description: "350ml, sabores variados",
          price: 6,
          imageUrl: "https://images.unsplash.com/photo-1581636625402-29b2a704ef13",
          categoryId: bebidas.id,
          active: true,
          available: true
        }
      ]
    });
  }

  if ((await prisma.complement.count({ where: { companyId: company.id } })) === 0) {
    await prisma.complement.createMany({
      data: [
        { companyId: company.id, name: "Pao", description: "Pao do lanche", price: 0, active: true },
        { companyId: company.id, name: "Hamburguer", description: "Carne de hamburguer", price: 0, active: true },
        { companyId: company.id, name: "Queijo Extra", description: "Fatia extra de queijo", price: 2, active: true },
        { companyId: company.id, name: "Presunto", description: "Fatia de presunto", price: 2, active: true },
        { companyId: company.id, name: "Tomate", description: "Rodelas de tomate", price: 1, active: true },
        { companyId: company.id, name: "Alface", description: "Folhas de alface", price: 1, active: true }
      ]
    });
  }

  const burger = await prisma.product.findFirst({ where: { companyId: company.id, name: "X-Burger" } });
  if (burger && (await prisma.productComplement.count({ where: { productId: burger.id } })) === 0) {
    const complements = await prisma.complement.findMany({
      where: {
        companyId: company.id,
        name: { in: ["Pao", "Hamburguer", "Queijo Extra", "Presunto", "Tomate", "Alface"] }
      },
      orderBy: { name: "asc" }
    });
    const requiredNames = new Set(["Pao", "Hamburguer"]);
    await prisma.productComplement.createMany({
      data: complements.map((complement, index) => ({
        companyId: company.id,
        productId: burger.id,
        complementId: complement.id,
        required: requiredNames.has(complement.name),
        sortOrder: index
      }))
    });
  }

  await prisma.setting.upsert({
    where: { id: `setting-${company.id}` },
    update: {
      companyId: company.id,
      companyName: config.tradeName,
      whatsappNumber: config.companyPhone,
      deliveryFee: 5,
      openTime: "00:00",
      closeTime: "23:59",
      autoMessage: "Seu pedido foi confirmado e ja esta em preparo!",
      menuiaEnabled: false,
      printerEnabled: false,
      printerAutoPrint: false
    },
    create: {
      id: `setting-${company.id}`,
      companyId: company.id,
      companyName: config.tradeName,
      whatsappNumber: config.companyPhone,
      deliveryFee: 5,
      openTime: "00:00",
      closeTime: "23:59",
      autoMessage: "Seu pedido foi confirmado e ja esta em preparo!",
      menuiaEnabled: false,
      printerEnabled: false,
      printerAutoPrint: false
    }
  });
}


async function main() {
  const environment = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "").toLowerCase();
  if (environment === "production" && process.env.ALLOW_PRODUCTION_SEED !== "true") {
    throw new Error(
      "Seed bloqueado em producao. Defina ALLOW_PRODUCTION_SEED=true somente durante uma operacao aprovada."
    );
  }

  const companyPhone = process.env.WHATSAPP_NUMBER ?? "5575999999999";
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "yasmimlanches@gmail.com").trim().toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "123456";

  await seedTenantCompany({
    companyId: DEFAULT_COMPANY_ID,
    companyName: process.env.SEED_COMPANY_NAME ?? "Yasmim Lanches",
    tradeName: process.env.SEED_COMPANY_TRADE_NAME ?? "Yasmim Lanches",
    subdomain: process.env.SEED_COMPANY_SUBDOMAIN ?? "yasmimlanches",
    companyEmail: process.env.SEED_COMPANY_EMAIL ?? "contato@yasmimlanches.com.br",
    companyPhone,
    adminEmail,
    adminPassword,
    createMasterUser: true
  });

  if (environment !== "production") {
    await seedTenantCompany({
      companyId: "dev-test-company",
      companyName: process.env.SEED_TEST_COMPANY_NAME ?? "Teste HubRegional",
      tradeName: process.env.SEED_TEST_COMPANY_TRADE_NAME ?? "Teste",
      subdomain: process.env.SEED_TEST_COMPANY_SUBDOMAIN ?? "teste",
      companyEmail: process.env.SEED_TEST_COMPANY_EMAIL ?? "contato@teste.hubregional.com.br",
      companyPhone: process.env.SEED_TEST_COMPANY_PHONE ?? companyPhone,
      adminEmail: (process.env.SEED_TEST_ADMIN_EMAIL ?? adminEmail).trim().toLowerCase(),
      adminPassword: process.env.SEED_TEST_ADMIN_PASSWORD ?? adminPassword,
      createMasterUser: false
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
