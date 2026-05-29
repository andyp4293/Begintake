import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { createDefaultIntakeTemplate } from '@/lib/templates/default-intake';
import { createFamilyIntakeTemplate } from '@/lib/templates/family-intake';
import { createGeneralIntakeTemplate } from '@/lib/templates/general-intake';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json([
    {
      id: 'default-intake',
      name: 'Default Reception Intake',
      description: 'Broad front-desk intake template that collects core details, screens for urgency, and routes callers toward scheduling, follow-up review, or a live team handoff.',
    },
    {
      id: 'family-court-intake',
      name: 'Family Court Intake',
      description: 'Family-law-focused intake template built on the same main intake structure as the general flow, with deeper family routing and an outside-scope fallback that checks once for any family-law issue before directing callers to the main line.',
    },
    {
      id: 'general-intake',
      name: 'General Legal Intake',
      description: 'Comprehensive multi-branch intake template for firms with many matter types and deeper routing requirements.',
    },
  ]);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { templateId } = await req.json().catch(() => ({ templateId: 'family-court-intake' }));

  const template = templateId === 'default-intake'
    ? createDefaultIntakeTemplate()
    : templateId === 'general-intake'
      ? createGeneralIntakeTemplate()
      : createFamilyIntakeTemplate();

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
