import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const calls = await prisma.callSession.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
      client: { select: { name: true } },
      lawyer: { select: { name: true } },
    },
  });

  return NextResponse.json(calls);
}
