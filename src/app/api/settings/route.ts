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
    select: {
      transferPhoneNumber: true,
      assistantName: true,
      firmName: true,
      backupSummaryEmail: true,
      additionalSummaryEmails: true,
      assumeNewClients: true,
    },
  });

  // Parse the service account email from the env var if present
  let calendarServiceEmail: string | null = null;
  try {
    const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (key) calendarServiceEmail = JSON.parse(key).client_email || null;
  } catch { /* ignore parse errors */ }

  return NextResponse.json({
    transferPhoneNumber: user?.transferPhoneNumber || '',
    assistantName: user?.assistantName || '',
    firmName: user?.firmName || '',
    backupSummaryEmail: user?.backupSummaryEmail || '',
    additionalSummaryEmails: user?.additionalSummaryEmails || [],
    assumeNewClients: Boolean(user?.assumeNewClients),
    calendarServiceEmail,
  });
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();

  const data: {
    transferPhoneNumber?: string | null;
    assistantName?: string | null;
    firmName?: string | null;
    backupSummaryEmail?: string | null;
    additionalSummaryEmails?: string[];
    assumeNewClients?: boolean;
  } = {};
  if ('transferPhoneNumber' in body) data.transferPhoneNumber = body.transferPhoneNumber || null;
  if ('assistantName' in body)       data.assistantName       = body.assistantName || null;
  if ('firmName' in body)            data.firmName            = body.firmName || null;
  if ('backupSummaryEmail' in body) {
    const trimmed = typeof body.backupSummaryEmail === 'string' ? body.backupSummaryEmail.trim() : '';
    if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return NextResponse.json({ error: 'Please enter a valid backup email address' }, { status: 400 });
    }
    data.backupSummaryEmail = trimmed || null;
  }
  if ('additionalSummaryEmails' in body) {
    const values = Array.isArray(body.additionalSummaryEmails)
      ? body.additionalSummaryEmails
      : typeof body.additionalSummaryEmails === 'string'
        ? body.additionalSummaryEmails.split(/[,\n]/g)
        : [];
    const normalizedEntries: Array<readonly [string, string]> = [];
    for (const value of values) {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      if (!trimmed) continue;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        return NextResponse.json({ error: `Please enter a valid email address: ${trimmed}` }, { status: 400 });
      }
      normalizedEntries.push([trimmed.toLowerCase(), trimmed] as const);
    }
    const normalized = Array.from(new Map(normalizedEntries).values());
    data.additionalSummaryEmails = normalized;
  }
  if ('assumeNewClients' in body) {
    data.assumeNewClients = Boolean(body.assumeNewClients);
  }

  if (Object.keys(data).length > 0) {
    await prisma.user.update({ where: { id: session.user.id }, data });
  }

  return NextResponse.json({ success: true });
}
