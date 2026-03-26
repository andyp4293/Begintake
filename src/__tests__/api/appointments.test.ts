import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/appointments/route';
import { NextRequest } from 'next/server';

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

function makeRequest(params = '') {
  return new NextRequest(`http://localhost/api/appointments${params ? '?' + params : ''}`);
}

describe('GET /api/appointments', () => {
  beforeEach(() => {
    vi.mocked(getServerSession).mockReset();
    vi.mocked(prisma.appointment.findMany).mockReset();
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns paginated appointments', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([
      { id: 'apt-1', status: 'scheduled' },
    ] as any);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.appointments).toHaveLength(1);
    expect(data).toHaveProperty('nextCursor');
  });

  it('filters future scheduled appointments by default', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([]);

    await GET(makeRequest());
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          startTime: expect.objectContaining({ gte: expect.any(Date) }),
          status: 'scheduled',
        }),
      })
    );
  });

  it('supports lawyerId filter', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([]);

    await GET(makeRequest('lawyerId=law-1'));
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ lawyerId: 'law-1' }),
      })
    );
  });

  it('supports cursor pagination', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([]);

    await GET(makeRequest('cursor=apt-5'));
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: 'apt-5' }, skip: 1 })
    );
  });
});
