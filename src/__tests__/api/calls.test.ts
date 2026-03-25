import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/calls/route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/app/api/auth/[...nextauth]/route', () => ({
  authOptions: {},
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    callSession: {
      findMany: vi.fn(),
    },
  },
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

describe('GET /api/calls', () => {
  beforeEach(() => {
    vi.mocked(getServerSession).mockReset();
    vi.mocked(prisma.callSession.findMany).mockReset();
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns call sessions when authenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.callSession.findMany).mockResolvedValue([
      { id: 'cs-1', callerPhone: '+15559990001', status: 'completed' },
    ] as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('cs-1');
  });

  it('orders by createdAt desc', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.callSession.findMany).mockResolvedValue([]);

    await GET();
    expect(prisma.callSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
      })
    );
  });

  it('limits to 20 results', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.callSession.findMany).mockResolvedValue([]);

    await GET();
    expect(prisma.callSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 })
    );
  });

  it('includes client and lawyer relations', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.callSession.findMany).mockResolvedValue([]);

    await GET();
    expect(prisma.callSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          client: expect.any(Object),
          lawyer: expect.any(Object),
        }),
      })
    );
  });
});
