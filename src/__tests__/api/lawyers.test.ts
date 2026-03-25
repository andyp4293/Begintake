import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/lawyers/route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/app/api/auth/[...nextauth]/route', () => ({
  authOptions: {},
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    lawyer: {
      findMany: vi.fn(),
    },
  },
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

describe('GET /api/lawyers', () => {
  beforeEach(() => {
    vi.mocked(getServerSession).mockReset();
    vi.mocked(prisma.lawyer.findMany).mockReset();
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns lawyers when authenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.lawyer.findMany).mockResolvedValue([
      { id: 'l1', name: 'Sarah Chen', specialties: ['family'], available: true },
      { id: 'l2', name: 'Marcus Johnson', specialties: ['criminal'], available: false },
    ] as any);

    const res = await GET();
    const data = await res.json();
    expect(data).toHaveLength(2);
    expect(data[0].name).toBe('Sarah Chen');
  });

  it('orders by name', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.lawyer.findMany).mockResolvedValue([]);

    await GET();
    expect(prisma.lawyer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { name: 'asc' } })
    );
  });

  it('selects correct fields', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.lawyer.findMany).mockResolvedValue([]);

    await GET();
    expect(prisma.lawyer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          id: true,
          name: true,
          specialties: true,
          available: true,
        }),
      })
    );
  });
});
