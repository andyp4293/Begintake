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
  const clientType = searchParams.get('clientType');
  const callOutcome = searchParams.get('callOutcome');
  const legalArea = searchParams.get('legalArea');
  const lawyerId = searchParams.get('lawyerId');

  const where: any = {};
  if (clientType) where.clientType = clientType;
  if (callOutcome) where.callOutcome = callOutcome;
  if (legalArea) where.legalArea = legalArea;
  if (lawyerId) where.lawyerId = lawyerId;

  // Support both cursor-based and page-based pagination
  const page = parseInt(searchParams.get('page') || '0');

  if (page > 0) {
    // Page-based pagination
    const skip = (page - 1) * limit;
    const [calls, totalCount] = await Promise.all([
      prisma.callSession.findMany({
        where,
        orderBy: { createdAt: sort },
        take: limit,
        skip,
        include: {
          client: { select: { name: true } },
          lawyer: { select: { name: true } },
        },
      }),
      prisma.callSession.count({ where }),
    ]);
    const totalPages = Math.ceil(totalCount / limit);
    return NextResponse.json({ calls, page, totalPages, totalCount });
  }

  // Cursor-based pagination (legacy)
  const calls = await prisma.callSession.findMany({
    where,
    orderBy: { createdAt: sort },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      client: { select: { name: true } },
      lawyer: { select: { name: true } },
    },
  });

  const hasMore = calls.length > limit;
  const data = hasMore ? calls.slice(0, limit) : calls;
  const nextCursor = hasMore ? data[data.length - 1].id : null;

  return NextResponse.json({ calls: data, nextCursor });
}
