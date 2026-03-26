import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const flow = await prisma.intakeFlow.findUnique({
    where: { id },
    include: {
      nodes: { orderBy: { sortOrder: 'asc' } },
      edges: { orderBy: { sortOrder: 'asc' } },
    },
  });

  if (!flow) {
    return NextResponse.json({ error: 'Flow not found' }, { status: 404 });
  }

  return NextResponse.json(flow);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const { name, description, nodes, edges } = body;

  // Delete existing nodes and edges, recreate
  await prisma.flowEdge.deleteMany({ where: { flowId: id } });
  await prisma.flowNode.deleteMany({ where: { flowId: id } });

  // Update flow metadata
  await prisma.intakeFlow.update({
    where: { id },
    data: {
      name: name || undefined,
      description: description !== undefined ? description : undefined,
    },
  });

  // Create nodes one by one with new server-generated IDs, build old->new ID map
  const idMap = new Map<string, string>();
  if (nodes?.length) {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const node = await prisma.flowNode.create({
        data: {
          flowId: id,
          type: n.type,
          label: n.label,
          positionX: n.positionX || 0,
          positionY: n.positionY || 0,
          config: n.config || {},
          sortOrder: i,
        },
      });
      idMap.set(n.id, node.id);
    }
  }

  if (edges?.length) {
    const edgeData = edges
      .map((e: any, i: number) => {
        const sourceId = idMap.get(e.sourceNodeId);
        const targetId = idMap.get(e.targetNodeId);
        if (!sourceId || !targetId) return null;
        return {
          flowId: id,
          sourceNodeId: sourceId,
          targetNodeId: targetId,
          label: e.label || null,
          condition: e.condition || null,
          sortOrder: i,
        };
      })
      .filter(Boolean) as any[];
    if (edgeData.length) {
      await prisma.flowEdge.createMany({ data: edgeData });
    }
  }

  const flow = await prisma.intakeFlow.findUnique({
    where: { id },
    include: { nodes: true, edges: true },
  });

  return NextResponse.json(flow);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  await prisma.intakeFlow.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
