import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let user: any;
  try {
    const rows = await prisma.$queryRaw<Array<any>>`
      SELECT "transferPhoneNumber", "assistantName", "firmName" FROM "User" WHERE "id" = ${session.user.id} LIMIT 1
    `;
    user = rows[0] || {};
  } catch {
    user = {};
  }

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

  const data: any = {};
  if ('transferPhoneNumber' in body) {
    data.transferPhoneNumber = body.transferPhoneNumber || null;
  }
  if ('assistantName' in body) {
    data.assistantName = body.assistantName || null;
  }
  if ('firmName' in body) {
    data.firmName = body.firmName || null;
  }

  if (Object.keys(data).length > 0) {
    try {
      await prisma.user.update({
        where: { id: session.user.id },
        data,
      });
    } catch {
      // If Prisma client doesn't know about new fields, use raw
      for (const [key, value] of Object.entries(data)) {
        await prisma.$executeRawUnsafe(
          `UPDATE "User" SET "${key}" = $1 WHERE "id" = $2`,
          value, session.user.id
        );
      }
    }
  }

  return NextResponse.json({ success: true });
}
