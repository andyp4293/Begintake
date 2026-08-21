import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorizedCronRequest(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    return req.headers.get('authorization') === `Bearer ${cronSecret}`;
  }

  const userAgent = req.headers.get('user-agent') || '';
  return userAgent.includes('vercel-cron/1.0');
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();

  const [user, activeFlow] = await Promise.all([
    prisma.user.findFirst({
      select: {
        id: true,
      },
    }),
    prisma.intakeFlow.findFirst({
      where: { isActive: true },
      select: {
        id: true,
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    warmed: true,
    durationMs: Date.now() - startedAt,
    userId: user?.id ?? null,
    activeFlowId: activeFlow?.id ?? null,
  });
}
