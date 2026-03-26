import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/flows/route';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    intakeFlow: {
      findMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      findFirst: vi.fn(),
    },
    flowNode: { createMany: vi.fn(), deleteMany: vi.fn() },
    flowEdge: { createMany: vi.fn(), deleteMany: vi.fn() },
  },
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

describe('Flows API', () => {
  beforeEach(() => {
    vi.mocked(getServerSession).mockReset();
    vi.mocked(prisma.intakeFlow.findMany).mockReset();
    vi.mocked(prisma.intakeFlow.create).mockReset();
  });

  describe('GET /api/flows', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);
      const res = await GET();
      expect(res.status).toBe(401);
    });

    it('returns user flows', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.intakeFlow.findMany).mockResolvedValue([
        { id: 'f1', name: 'Test Flow', isActive: true },
      ] as any);

      const res = await GET();
      const data = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe('Test Flow');
    });

    it('only returns flows for authenticated user', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.intakeFlow.findMany).mockResolvedValue([]);

      await GET();
      expect(prisma.intakeFlow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' } })
      );
    });
  });

  describe('POST /api/flows', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);
      const req = new NextRequest('http://localhost/api/flows', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it('creates flow with nodes', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.intakeFlow.create).mockResolvedValue({
        id: 'f1', name: 'Test', nodes: [], userId: 'u1',
      } as any);
      vi.mocked(prisma.intakeFlow.findUnique).mockResolvedValue({
        id: 'f1', name: 'Test', nodes: [], edges: [],
      } as any);

      const req = new NextRequest('http://localhost/api/flows', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Test Flow',
          nodes: [{ type: 'start', label: 'Start', config: {} }],
          edges: [],
        }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
    });
  });
});
