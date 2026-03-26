import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { provisionPhoneNumber } from '@/lib/phone-provisioning';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Return current user's phone number
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { vapiPhoneNumber: true, vapiPhoneNumberId: true },
  });

  return NextResponse.json({
    phoneNumber: user?.vapiPhoneNumber || null,
    provisioned: !!user?.vapiPhoneNumberId,
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check if already provisioned
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { vapiPhoneNumber: true, vapiPhoneNumberId: true, name: true },
  });

  if (user?.vapiPhoneNumberId) {
    return NextResponse.json({
      phoneNumber: user.vapiPhoneNumber,
      message: 'Phone number already provisioned',
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const areaCode = typeof body.areaCode === 'string' ? body.areaCode : undefined;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';

    const result = await provisionPhoneNumber(
      user?.name || session.user.name || 'User',
      appUrl,
      areaCode
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Store in database
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        vapiPhoneNumber: result.phoneNumber,
        vapiPhoneNumberId: result.vapiPhoneNumberId,
        twilioNumberSid: result.twilioSid,
      },
    });

    return NextResponse.json({
      phoneNumber: result.phoneNumber,
      vapiPhoneNumberId: result.vapiPhoneNumberId,
    }, { status: 201 });
  } catch (error: any) {
    console.error('Phone provision error:', error);
    return NextResponse.json({ error: 'Failed to provision number' }, { status: 500 });
  }
}
