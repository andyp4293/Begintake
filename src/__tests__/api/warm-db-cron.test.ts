import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/cron/warm-db/route';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
    },
    intakeFlow: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';

function makeRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost:3000/api/cron/warm-db', {
    method: 'GET',
    headers,
  });
}

describe('warm-db cron route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'user-1' } as any);
    vi.mocked(prisma.intakeFlow.findFirst).mockResolvedValue({ id: 'flow-1' } as any);
  });

  it('rejects unauthorized requests', async () => {
    vi.stubEnv('CRON_SECRET', 'top-secret');

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.intakeFlow.findFirst).not.toHaveBeenCalled();
  });

  it('accepts Vercel cron user-agent requests when CRON_SECRET is not configured', async () => {
    const res = await GET(makeRequest({ 'user-agent': 'vercel-cron/1.0' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.warmed).toBe(true);
    expect(data.userId).toBe('user-1');
    expect(data.activeFlowId).toBe('flow-1');
    expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.intakeFlow.findFirst).toHaveBeenCalledTimes(1);
  });

  it('accepts authorized cron requests when CRON_SECRET is configured', async () => {
    vi.stubEnv('CRON_SECRET', 'top-secret');

    const res = await GET(makeRequest({ authorization: 'Bearer top-secret' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.intakeFlow.findFirst).toHaveBeenCalledTimes(1);
  });
});
