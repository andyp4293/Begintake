import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { transferPhoneNumber: true },
  });

  return NextResponse.json({ transferPhoneNumber: user?.transferPhoneNumber || '' });
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { transferPhoneNumber } = await req.json();

  await prisma.user.update({
    where: { id: session.user.id },
    data: { transferPhoneNumber: transferPhoneNumber || null },
  });

  return NextResponse.json({ success: true });
}
