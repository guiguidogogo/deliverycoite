import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@delivery.com';
  const password = '123456';
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, name: 'Administrador', role: 'ADMIN' },
    create: { name: 'Administrador', email, passwordHash, role: 'ADMIN' }
  });

  const settings = await prisma.setting.findFirst();
  if (settings) {
    await prisma.setting.update({
      where: { id: settings.id },
      data: { openTime: '00:00', closeTime: '23:59' }
    });
    console.log('SETTINGS_UPDATED', settings.id);
  } else {
    await prisma.setting.create({
      data: {
        companyName: 'Lanchonete Delivery',
        whatsappNumber: process.env.WHATSAPP_NUMBER ?? '5575999999999',
        deliveryFee: 5,
        openTime: '00:00',
        closeTime: '23:59',
        autoMessage: 'Seu pedido foi confirmado e ja esta em preparo!'
      }
    });
    console.log('SETTINGS_CREATED');
  }

  console.log('ADMIN_OK', email);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
