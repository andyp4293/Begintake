import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get('cursor');
  const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50);
  const sort = searchParams.get('sort') === 'oldest' ? 'asc' as const : 'desc' as const;
  const lawyerId = searchParams.get('lawyerId');
  const showPast = searchParams.get('showPast') === 'true';

  const where: any = {};
  if (!showPast) {
    where.startTime = { gte: new Date() };
    where.status = 'scheduled';
  }
  if (lawyerId) where.lawyerId = lawyerId;

  const appointments = await prisma.appointment.findMany({
    where,
    orderBy: { startTime: sort },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      client: { select: { name: true, phone: true } },
      lawyer: { select: { name: true } },
    },
  });

  const hasMore = appointments.length > limit;
  const data = hasMore ? appointments.slice(0, limit) : appointments;
  const nextCursor = hasMore ? data[data.length - 1].id : null;

  return NextResponse.json({ appointments: data, nextCursor });
}
