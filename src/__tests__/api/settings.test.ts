import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PUT } from '@/app/api/settings/route';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/app/api/auth/[...nextauth]/route', () => ({
  authOptions: {},
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
  },
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

describe('Settings API', () => {
  beforeEach(() => {
    vi.mocked(getServerSession).mockReset();
    vi.mocked(prisma.user.findUnique).mockReset();
    vi.mocked(prisma.user.update).mockReset();
  });

  describe('GET /api/settings', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);
      const res = await GET();
      expect(res.status).toBe(401);
    });

    it('returns transfer phone number when set', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{
        transferPhoneNumber: '+15551234567',
        assistantName: 'Alex',
      }]);

      const res = await GET();
      const data = await res.json();
      expect(data.transferPhoneNumber).toBe('+15551234567');
      expect(data.assistantName).toBe('Alex');
    });

    it('returns empty strings when no settings', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{}]);

      const res = await GET();
      const data = await res.json();
      expect(data.transferPhoneNumber).toBe('');
      expect(data.assistantName).toBe('');
    });
  });

  describe('PUT /api/settings', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);
      const req = new NextRequest('http://localhost/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ transferPhoneNumber: '+15551234567' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await PUT(req);
      expect(res.status).toBe(401);
    });

    it('saves transfer phone number', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.user.update).mockResolvedValue({} as any);

      const req = new NextRequest('http://localhost/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ transferPhoneNumber: '+15559876543' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await PUT(req);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: { transferPhoneNumber: '+15559876543' },
        })
      );
    });

    it('clears transfer number when empty string', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.user.update).mockResolvedValue({} as any);

      const req = new NextRequest('http://localhost/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ transferPhoneNumber: '' }),
        headers: { 'content-type': 'application/json' },
      });
      await PUT(req);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { transferPhoneNumber: null },
        })
      );
    });
  });
});
