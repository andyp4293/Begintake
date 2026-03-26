import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const flows = await prisma.intakeFlow.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      description: true,
      isActive: true,
      isTemplate: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(flows);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { name, description, nodes, edges } = body;

  const flow = await prisma.intakeFlow.create({
    data: {
      name: name || 'New Flow',
      description: description || null,
      userId: session.user.id,
      nodes: {
        create: (nodes || []).map((n: any, i: number) => ({
          id: n.id || undefined,
          type: n.type,
          label: n.label,
          positionX: n.positionX || 0,
          positionY: n.positionY || 0,
          config: n.config || {},
          sortOrder: i,
        })),
      },
    },
    include: { nodes: true },
  });

  // Create edges after nodes exist
  if (edges?.length) {
    await prisma.flowEdge.createMany({
      data: edges.map((e: any, i: number) => ({
        flowId: flow.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        label: e.label || null,
        condition: e.condition || null,
        sortOrder: i,
      })),
    });
  }

  const fullFlow = await prisma.intakeFlow.findUnique({
    where: { id: flow.id },
    include: { nodes: true, edges: true },
  });

  return NextResponse.json(fullFlow, { status: 201 });
}
