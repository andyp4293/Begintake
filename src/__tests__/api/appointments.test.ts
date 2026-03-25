import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/appointments/route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/app/api/auth/[...nextauth]/route', () => ({
  authOptions: {},
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    appointment: {
      findMany: vi.fn(),
    },
  },
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

describe('GET /api/appointments', () => {
  beforeEach(() => {
    vi.mocked(getServerSession).mockReset();
    vi.mocked(prisma.appointment.findMany).mockReset();
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns appointments when authenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      { id: 'apt-1', status: 'scheduled' },
    ] as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
  });

  it('only returns future scheduled appointments', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([]);

    await GET();
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          startTime: expect.objectContaining({ gte: expect.any(Date) }),
          status: 'scheduled',
        }),
      })
    );
  });

  it('orders by startTime asc', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([]);

    await GET();
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { startTime: 'asc' } })
    );
  });

  it('includes client and lawyer data', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([]);

    await GET();
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          client: expect.any(Object),
          lawyer: expect.any(Object),
        }),
      })
    );
  });
});
