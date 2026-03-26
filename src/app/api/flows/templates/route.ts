import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { createAndersonBowmanTemplate } from '@/lib/templates/anderson-bowman';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Return available templates
  return NextResponse.json([
    {
      id: 'anderson-bowman',
      name: 'Anderson Bowman PLLC — Family Court Intake',
      description: 'Complete AI intake script for family law. Covers custody, support, family offense, child welfare, paternity, adoption, juvenile, and miscellaneous matters.',
    },
  ]);
}

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const template = createAndersonBowmanTemplate();

  // Create the flow with nodes
  const flow = await prisma.intakeFlow.create({
    data: {
      name: template.name,
      description: template.description,
      isTemplate: false,
      userId: session.user.id,
      nodes: {
        create: template.nodes.map((n: any, i: number) => ({
          id: n.id,
          type: n.type,
          label: n.label,
          positionX: n.positionX,
          positionY: n.positionY,
          config: n.config,
          sortOrder: i,
        })),
      },
    },
    include: { nodes: true },
  });

  // Create edges
  if (template.edges.length > 0) {
    await prisma.flowEdge.createMany({
      data: template.edges.map((e: any, i: number) => ({
        flowId: flow.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        label: e.label,
        condition: e.condition,
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
