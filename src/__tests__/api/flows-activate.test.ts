import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/flows/[id]/activate/route';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    intakeFlow: {
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

describe('POST /api/flows/[id]/activate', () => {
  beforeEach(() => {
    vi.mocked(getServerSession).mockReset();
    vi.mocked(prisma.intakeFlow.updateMany).mockReset();
    vi.mocked(prisma.intakeFlow.update).mockReset();
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/flows/f1/activate', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 'f1' }) });
    expect(res.status).toBe(401);
  });

  it('deactivates all other flows first', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.intakeFlow.updateMany).mockResolvedValue({ count: 2 } as any);
    vi.mocked(prisma.intakeFlow.update).mockResolvedValue({ id: 'f1' } as any);

    const req = new NextRequest('http://localhost/api/flows/f1/activate', { method: 'POST' });
    await POST(req, { params: Promise.resolve({ id: 'f1' }) });

    expect(prisma.intakeFlow.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1', isActive: true },
        data: { isActive: false },
      })
    );
  });

  it('activates the specified flow', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.intakeFlow.updateMany).mockResolvedValue({ count: 0 } as any);
    vi.mocked(prisma.intakeFlow.update).mockResolvedValue({ id: 'f1' } as any);

    const req = new NextRequest('http://localhost/api/flows/f1/activate', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 'f1' }) });
    const data = await res.json();

    expect(prisma.intakeFlow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'f1' },
        data: { isActive: true },
      })
    );
    expect(data.activeFlowId).toBe('f1');
  });
});
