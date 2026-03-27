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
    select: { transferPhoneNumber: true, assistantName: true, firmName: true },
  });

  return NextResponse.json({
    transferPhoneNumber: user?.transferPhoneNumber || '',
    assistantName: user?.assistantName || '',
    firmName: user?.firmName || '',
  });
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();

  const data: { transferPhoneNumber?: string | null; assistantName?: string | null; firmName?: string | null } = {};
  if ('transferPhoneNumber' in body) data.transferPhoneNumber = body.transferPhoneNumber || null;
  if ('assistantName' in body)       data.assistantName       = body.assistantName || null;
  if ('firmName' in body)            data.firmName            = body.firmName || null;

  if (Object.keys(data).length > 0) {
    await prisma.user.update({ where: { id: session.user.id }, data });
  }

  return NextResponse.json({ success: true });
}
