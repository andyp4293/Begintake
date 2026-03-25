import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const lawyers = await prisma.lawyer.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      specialties: true,
      available: true,
    },
  });

  return NextResponse.json(lawyers);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { name, email, phone, specialties, available } = body;

    if (!name || !email) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
    }

    const lawyer = await prisma.lawyer.create({
      data: {
        name,
        email,
        phone: phone || null,
        specialties: Array.isArray(specialties) ? specialties : [],
        available: available !== false,
      },
    });

    return NextResponse.json(lawyer, { status: 201 });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'An attorney with this email already exists' }, { status: 409 });
    }
    console.error('Create lawyer error:', error);
    return NextResponse.json({ error: 'Failed to create attorney' }, { status: 500 });
  }
}
