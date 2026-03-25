import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Seed lawyers
  const lawyers = await Promise.all([
    prisma.lawyer.upsert({
      where: { email: 'sarah.chen@lawfirm.com' },
      update: {},
      create: {
        name: 'Sarah Chen',
        email: 'sarah.chen@lawfirm.com',
        phone: '+15551001001',
        specialties: ['family', 'divorce', 'custody', 'child support'],
        available: true,
      },
    }),
    prisma.lawyer.upsert({
      where: { email: 'marcus.johnson@lawfirm.com' },
      update: {},
      create: {
        name: 'Marcus Johnson',
        email: 'marcus.johnson@lawfirm.com',
        phone: '+15551001002',
        specialties: ['criminal', 'dui', 'defense', 'misdemeanor', 'felony'],
        available: true,
      },
    }),
    prisma.lawyer.upsert({
      where: { email: 'priya.patel@lawfirm.com' },
      update: {},
      create: {
        name: 'Priya Patel',
        email: 'priya.patel@lawfirm.com',
        phone: '+15551001003',
        specialties: ['immigration', 'visa', 'deportation', 'citizenship', 'asylum'],
        available: true,
      },
    }),
    prisma.lawyer.upsert({
      where: { email: 'james.wilson@lawfirm.com' },
      update: {},
      create: {
        name: 'James Wilson',
        email: 'james.wilson@lawfirm.com',
        phone: '+15551001004',
        specialties: ['personal injury', 'accident', 'workers compensation', 'medical malpractice'],
        available: true,
      },
    }),
    prisma.lawyer.upsert({
      where: { email: 'diana.ross@lawfirm.com' },
      update: {},
      create: {
        name: 'Diana Ross',
        email: 'diana.ross@lawfirm.com',
        phone: '+15551001005',
        specialties: ['corporate', 'business', 'contract', 'real estate', 'employment'],
        available: true,
      },
    }),
  ]);

  // Seed current clients
  await Promise.all([
    prisma.client.upsert({
      where: { phone: '+15559990001' },
      update: {},
      create: {
        name: 'John Martinez',
        phone: '+15559990001',
        email: 'john.martinez@email.com',
        isCurrentClient: true,
        assignedLawyerId: lawyers[0].id,
      },
    }),
    prisma.client.upsert({
      where: { phone: '+15559990002' },
      update: {},
      create: {
        name: 'Emily Davis',
        phone: '+15559990002',
        email: 'emily.davis@email.com',
        isCurrentClient: true,
        assignedLawyerId: lawyers[1].id,
      },
    }),
    prisma.client.upsert({
      where: { phone: '+15559990003' },
      update: {},
      create: {
        name: 'Robert Kim',
        phone: '+15559990003',
        email: 'robert.kim@email.com',
        isCurrentClient: true,
        assignedLawyerId: lawyers[4].id,
      },
    }),
  ]);

  console.log('Seed data created successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
