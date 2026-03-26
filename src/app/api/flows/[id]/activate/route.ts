import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  // Deactivate all other flows for this user
  await prisma.intakeFlow.updateMany({
    where: { userId: session.user.id, isActive: true },
    data: { isActive: false },
  });

  // Activate this flow
  await prisma.intakeFlow.update({
    where: { id },
    data: { isActive: true },
  });

  return NextResponse.json({ success: true, activeFlowId: id });
}
