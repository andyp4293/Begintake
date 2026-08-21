import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { isInternalFlowFieldName } from '@/lib/active-flow-runner';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const callSession = await prisma.callSession.findUnique({
    where: { id },
    include: {
      client: { select: { name: true, phone: true, email: true } },
      lawyer: { select: { name: true, email: true, specialties: true } },
      intakeData: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!callSession) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: callSession.id,
    callerPhone: callSession.callerPhone,
    clientType: callSession.clientType,
    callOutcome: callSession.callOutcome,
    legalArea: callSession.legalArea,
    urgencyFlag: callSession.urgencyFlag,
    petitionType: callSession.petitionType,
    matterCategory: callSession.matterCategory,
    partyRole: callSession.partyRole,
    summary: callSession.summary,
    notes: callSession.notes,
    transferred: callSession.transferred,
    transferredTo: callSession.transferredTo,
    client: callSession.client,
    lawyer: callSession.lawyer,
    intakeData: callSession.intakeData.filter((row) => !isInternalFlowFieldName(row.fieldName)),
    createdAt: callSession.createdAt,
  });
}
