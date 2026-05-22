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

    it('returns all three fields when set', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        transferPhoneNumber: '+15551234567',
        assistantName: 'Alex',
        firmName: 'Smith & Jones',
        backupSummaryEmail: 'backup@test.com',
      } as any);

      const res = await GET();
      const data = await res.json();
      expect(data.transferPhoneNumber).toBe('+15551234567');
      expect(data.assistantName).toBe('Alex');
      expect(data.firmName).toBe('Smith & Jones');
      expect(data.backupSummaryEmail).toBe('backup@test.com');
    });

    it('returns empty strings when no settings saved', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        transferPhoneNumber: null,
        assistantName: null,
        firmName: null,
        backupSummaryEmail: null,
      } as any);

      const res = await GET();
      const data = await res.json();
      expect(data.transferPhoneNumber).toBe('');
      expect(data.assistantName).toBe('');
      expect(data.firmName).toBe('');
      expect(data.backupSummaryEmail).toBe('');
    });

    it('queries the correct user id', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'user-abc' } } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      await GET();
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-abc' } })
      );
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

    it('saves assistant name', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.user.update).mockResolvedValue({} as any);

      const req = new NextRequest('http://localhost/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ assistantName: 'Jordan' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await PUT(req);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { assistantName: 'Jordan' } })
      );
    });

    it('saves firm name', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.user.update).mockResolvedValue({} as any);

      const req = new NextRequest('http://localhost/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ firmName: 'Anderson Bowman PLLC' }),
        headers: { 'content-type': 'application/json' },
      });
      await PUT(req);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { firmName: 'Anderson Bowman PLLC' } })
      );
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

    it('saves all three fields at once', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.user.update).mockResolvedValue({} as any);

      const req = new NextRequest('http://localhost/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ assistantName: 'Alex', firmName: 'Law Firm', transferPhoneNumber: '+15550001111' }),
        headers: { 'content-type': 'application/json' },
      });
      await PUT(req);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { assistantName: 'Alex', firmName: 'Law Firm', transferPhoneNumber: '+15550001111' },
        })
      );
    });

    it('clears a field when empty string sent', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.user.update).mockResolvedValue({} as any);

      const req = new NextRequest('http://localhost/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ assistantName: '' }),
        headers: { 'content-type': 'application/json' },
      });
      await PUT(req);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { assistantName: null } })
      );
    });

    it('does not call update when body has no known fields', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);

      const req = new NextRequest('http://localhost/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ unknownField: 'value' }),
        headers: { 'content-type': 'application/json' },
      });
      await PUT(req);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('saves backup summary email', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.user.update).mockResolvedValue({} as any);

      const req = new NextRequest('http://localhost/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ backupSummaryEmail: 'backup@test.com' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await PUT(req);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { backupSummaryEmail: 'backup@test.com' },
        })
      );
    });

    it('trims and clears backup summary email when empty string is sent', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.user.update).mockResolvedValue({} as any);

      const req = new NextRequest('http://localhost/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ backupSummaryEmail: '   ' }),
        headers: { 'content-type': 'application/json' },
      });
      await PUT(req);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { backupSummaryEmail: null },
        })
      );
    });

    it('rejects invalid backup summary email addresses', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);

      const req = new NextRequest('http://localhost/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ backupSummaryEmail: 'not-an-email' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await PUT(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain('valid backup email');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
