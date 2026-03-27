import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { createAndersonBowmanTemplate } from '@/lib/templates/anderson-bowman';
import { createGeneralIntakeTemplate } from '@/lib/templates/general-intake';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json([
    {
      id: 'family-court-intake',
      name: 'Family Court Intake',
      description: 'Deep intake script for family law: custody, divorce, support, family offense, child welfare, paternity, adoption, and juvenile matters. Built for a dedicated family law firm.',
    },
    {
      id: 'general-intake',
      name: 'General Legal Intake',
      description: 'Comprehensive intake covering all 13 practice areas: Family, Criminal, Immigration, Personal Injury, Corporate, Real Estate, Employment, Bankruptcy, Tax, Estate Planning, Intellectual Property, Civil Rights, and Environmental.',
    },
  ]);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { templateId } = await req.json().catch(() => ({ templateId: 'family-court-intake' }));

  const template = templateId === 'general-intake'
    ? createGeneralIntakeTemplate()
    : createAndersonBowmanTemplate();

  const flow = await prisma.intakeFlow.create({
    data: {
      name: template.name,
      description: template.description,
      isTemplate: false,
      userId: session.user.id,
    },
  });

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
