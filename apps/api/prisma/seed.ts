import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

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

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      name: "Administrador",
      email: adminEmail,
      passwordHash,
      role: UserRole.ADMIN
    }
  });

  const categories = ["Hamburgueres", "Pizzas", "Bebidas", "Combos", "Sobremesas"];

  for (const name of categories) {
    await prisma.category.upsert({
      where: { slug: slugify(name) },
      update: {},
      create: {
        name,
        slug: slugify(name),
        active: true
      }
    });
  }

  const hamb = await prisma.category.findUniqueOrThrow({ where: { slug: "hamburgueres" } });
  const bebidas = await prisma.category.findUniqueOrThrow({ where: { slug: "bebidas" } });

  if ((await prisma.product.count()) === 0) {
    await prisma.product.createMany({
      data: [
        {
          name: "X-Burger",
          description: "Pao, carne, queijo e molho especial",
          price: 15,
          imageUrl: "https://images.unsplash.com/photo-1550547660-d9450f859349",
          categoryId: hamb.id,
          active: true,
          available: true
        },
        {
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

  await prisma.setting.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
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
