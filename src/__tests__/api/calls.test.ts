import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/calls/route';
import { NextRequest } from 'next/server';

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

function makeRequest(params = '') {
  return new NextRequest(`http://localhost/api/calls${params ? '?' + params : ''}`);
}

describe('GET /api/calls', () => {
  beforeEach(() => {
    vi.mocked(getServerSession).mockReset();
    vi.mocked(prisma.callSession.findMany).mockReset();
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns paginated call sessions', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.callSession.findMany).mockResolvedValue([
      { id: 'cs-1', callerPhone: '+15559990001', status: 'completed' },
    ] as any);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.calls).toHaveLength(1);
    expect(data).toHaveProperty('nextCursor');
  });

  it('defaults to newest first', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.callSession.findMany).mockResolvedValue([]);

    await GET(makeRequest());
    expect(prisma.callSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } })
    );
  });

  it('supports oldest sort', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.callSession.findMany).mockResolvedValue([]);

    await GET(makeRequest('sort=oldest'));
    expect(prisma.callSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'asc' } })
    );
  });

  it('supports cursor pagination', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.callSession.findMany).mockResolvedValue([]);

    await GET(makeRequest('cursor=cs-5'));
    expect(prisma.callSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: 'cs-5' }, skip: 1 })
    );
  });

  it('supports clientType filter', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.callSession.findMany).mockResolvedValue([]);

    await GET(makeRequest('clientType=prospective'));
    expect(prisma.callSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ clientType: 'prospective' }) })
    );
  });

  it('returns nextCursor when more results exist', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    const items = Array.from({ length: 11 }, (_, i) => ({ id: `cs-${i}` }));
    vi.mocked(prisma.callSession.findMany).mockResolvedValue(items as any);

    const res = await GET(makeRequest('limit=10'));
    const data = await res.json();
    expect(data.calls).toHaveLength(10);
    expect(data.nextCursor).toBe('cs-9');
  });

  it('returns null nextCursor when no more results', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.callSession.findMany).mockResolvedValue([{ id: 'cs-1' }] as any);

    const res = await GET(makeRequest('limit=10'));
    const data = await res.json();
    expect(data.nextCursor).toBeNull();
  });
});
