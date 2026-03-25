import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { provisionPhoneNumber } from '@/lib/phone-provisioning';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const areaCode = typeof body.areaCode === 'string' ? body.areaCode : undefined;

    const result = await provisionPhoneNumber(areaCode);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      phoneNumber: result.phoneNumber,
      phoneSid: result.phoneSid,
    });
  } catch (error: any) {
    console.error('Phone provision error:', error);
    return NextResponse.json({ error: 'Failed to provision number' }, { status: 500 });
  }
}
