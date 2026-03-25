import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const appointments = await prisma.appointment.findMany({
    where: {
      startTime: { gte: new Date() },
      status: 'scheduled',
    },
    orderBy: { startTime: 'asc' },
    take: 10,
    include: {
      client: { select: { name: true, phone: true } },
      lawyer: { select: { name: true } },
    },
  });

  return NextResponse.json(appointments);
}
