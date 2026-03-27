import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await req.json();
    const { name, email, phone, specialties, available, availabilityStart, availabilityEnd } = body;

    const lawyer = await prisma.lawyer.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone: phone || null }),
        ...(specialties !== undefined && { specialties: Array.isArray(specialties) ? specialties : [] }),
        ...(available !== undefined && { available }),
        ...(availabilityStart !== undefined && { availabilityStart }),
        ...(availabilityEnd !== undefined && { availabilityEnd }),
      },
    });

    return NextResponse.json(lawyer);
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return NextResponse.json({ error: 'Attorney not found' }, { status: 404 });
    }
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'An attorney with this email already exists' }, { status: 409 });
    }
    console.error('Update lawyer error:', error);
    return NextResponse.json({ error: 'Failed to update attorney' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    // Remove required foreign key references before deleting the lawyer.
    // Appointments require a lawyerId so they must be deleted first.
    // CallSessions have a nullable lawyerId so we just unlink them.
    await prisma.$transaction([
      prisma.appointment.deleteMany({ where: { lawyerId: id } }),
      prisma.callSession.updateMany({ where: { lawyerId: id }, data: { lawyerId: null } }),
      prisma.lawyer.delete({ where: { id } }),
    ]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return NextResponse.json({ error: 'Attorney not found' }, { status: 404 });
    }
    console.error('Delete lawyer error:', error);
    return NextResponse.json({ error: 'Failed to delete attorney' }, { status: 500 });
  }
}
