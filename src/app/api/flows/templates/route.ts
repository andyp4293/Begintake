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
      id: 'family-court-intake',
      name: 'Family Court Intake Example',
      description: 'Complete AI intake script for family law. Covers custody, support, family offense, child welfare, paternity, adoption, juvenile, and miscellaneous matters. Uses {firm} and {name} variables.',
    },
  ]);
}

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const template = createAndersonBowmanTemplate();

  // Create the flow first
  const flow = await prisma.intakeFlow.create({
    data: {
      name: template.name,
      description: template.description,
      isTemplate: false,
      userId: session.user.id,
    },
  });

  // Create nodes with new unique IDs, keeping a mapping from old to new
  const idMap = new Map<string, string>();
  for (const n of template.nodes) {
    const node = await prisma.flowNode.create({
      data: {
        flowId: flow.id,
        type: n.type,
        label: n.label,
        positionX: n.positionX,
        positionY: n.positionY,
        config: n.config,
        sortOrder: n.sortOrder,
      },
    });
    idMap.set(n.id, node.id);
  }

  // Create edges using the new node IDs
  for (const e of template.edges) {
    const sourceId = idMap.get(e.sourceNodeId);
    const targetId = idMap.get(e.targetNodeId);
    if (sourceId && targetId) {
      await prisma.flowEdge.create({
        data: {
          flowId: flow.id,
          sourceNodeId: sourceId,
          targetNodeId: targetId,
          label: e.label,
          condition: e.condition,
          sortOrder: e.sortOrder,
        },
      });
    }
  }

  const fullFlow = await prisma.intakeFlow.findUnique({
    where: { id: flow.id },
    include: { nodes: { orderBy: { sortOrder: 'asc' } }, edges: { orderBy: { sortOrder: 'asc' } } },
  });

  return NextResponse.json(fullFlow, { status: 201 });
}
