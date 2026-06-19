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

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@delivery.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "123456";

  const passwordHash = await bcrypt.hash(adminPassword, 10);

  await prisma.company.upsert({
    where: { id: DEFAULT_COMPANY_ID },
    update: {},
    create: {
      id: DEFAULT_COMPANY_ID,
      companyName: "Delivery Coité",
      tradeName: "Delivery Coité",
      phone: process.env.WHATSAPP_NUMBER ?? "5575999999999",
      whatsapp: process.env.WHATSAPP_NUMBER ?? "5575999999999",
      email: adminEmail.toLowerCase(),
      subdomain: "deliverycoite",
      active: true
    }
  });

  if ((await prisma.user.count({ where: { role: UserRole.ADMIN, companyId: DEFAULT_COMPANY_ID } })) === 0) {
    await prisma.user.create({
      data: {
        name: "Administrador",
        email: adminEmail.toLowerCase(),
        passwordHash,
        role: UserRole.ADMIN,
        companyId: DEFAULT_COMPANY_ID
      }
    });
  }

  const categories = ["Hamburgueres", "Pizzas", "Bebidas", "Combos", "Sobremesas"];

  for (const name of categories) {
    const slug = slugify(name);
    const existing = await prisma.category.findFirst({ where: { companyId: DEFAULT_COMPANY_ID, slug } });
    if (!existing) {
      await prisma.category.create({
        data: {
        companyId: DEFAULT_COMPANY_ID,
        name,
        slug,
        active: true
      }
      });
    }
  }

  const hamb = await prisma.category.findFirstOrThrow({ where: { companyId: DEFAULT_COMPANY_ID, slug: "hamburgueres" } });
  const bebidas = await prisma.category.findFirstOrThrow({ where: { companyId: DEFAULT_COMPANY_ID, slug: "bebidas" } });

  if ((await prisma.product.count({ where: { companyId: DEFAULT_COMPANY_ID } })) === 0) {
    await prisma.product.createMany({
      data: [
        {
          companyId: DEFAULT_COMPANY_ID,
          name: "X-Burger",
          description: "Pao, carne, queijo e molho especial",
          price: 15,
          imageUrl: "https://images.unsplash.com/photo-1550547660-d9450f859349",
          categoryId: hamb.id,
          active: true,
          available: true
        },
        {
          companyId: DEFAULT_COMPANY_ID,
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

  if ((await prisma.complement.count({ where: { companyId: DEFAULT_COMPANY_ID } })) === 0) {
    await prisma.complement.createMany({
      data: [
        { companyId: DEFAULT_COMPANY_ID, name: "Pao", description: "Pao do lanche", price: 0, active: true },
        { companyId: DEFAULT_COMPANY_ID, name: "Hamburguer", description: "Carne de hamburguer", price: 0, active: true },
        { companyId: DEFAULT_COMPANY_ID, name: "Queijo Extra", description: "Fatia extra de queijo", price: 2, active: true },
        { companyId: DEFAULT_COMPANY_ID, name: "Presunto", description: "Fatia de presunto", price: 2, active: true },
        { companyId: DEFAULT_COMPANY_ID, name: "Tomate", description: "Rodelas de tomate", price: 1, active: true },
        { companyId: DEFAULT_COMPANY_ID, name: "Alface", description: "Folhas de alface", price: 1, active: true }
      ]
    });
  }

  const burger = await prisma.product.findFirst({ where: { companyId: DEFAULT_COMPANY_ID, name: "X-Burger" } });
  if (burger && (await prisma.productComplement.count({ where: { productId: burger.id } })) === 0) {
    const complements = await prisma.complement.findMany({
      where: { companyId: DEFAULT_COMPANY_ID, name: { in: ["Pao", "Hamburguer", "Queijo Extra", "Presunto", "Tomate", "Alface"] } },
      orderBy: { name: "asc" }
    });
    const requiredNames = new Set(["Pao", "Hamburguer"]);
    await prisma.productComplement.createMany({
      data: complements.map((complement, index) => ({
        companyId: DEFAULT_COMPANY_ID,
        productId: burger.id,
        complementId: complement.id,
        required: requiredNames.has(complement.name),
        sortOrder: index
      }))
    });
  }

  await prisma.setting.upsert({
    where: { id: "default" },
    update: { companyId: DEFAULT_COMPANY_ID },
    create: {
      id: "default",
      companyId: DEFAULT_COMPANY_ID,
      companyName: "Lanchonete Delivery",
      whatsappNumber: process.env.WHATSAPP_NUMBER ?? "5575999999999",
      deliveryFee: 5,
      openTime: "00:00",
      closeTime: "23:59",
      autoMessage: "Seu pedido foi confirmado e ja esta em preparo!"
    }
  });
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
