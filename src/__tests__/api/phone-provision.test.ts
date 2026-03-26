import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/phone/provision/route';
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

vi.mock('@/lib/phone-provisioning', () => ({
  provisionPhoneNumber: vi.fn(),
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { provisionPhoneNumber } from '@/lib/phone-provisioning';

describe('Phone Provision API', () => {
  beforeEach(() => {
    vi.mocked(getServerSession).mockReset();
    vi.mocked(prisma.user.findUnique).mockReset();
    vi.mocked(prisma.user.update).mockReset();
    vi.mocked(provisionPhoneNumber).mockReset();
  });

  describe('GET /api/phone/provision', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);
      const res = await GET();
      expect(res.status).toBe(401);
    });

    it('returns phone number when provisioned', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        vapiPhoneNumber: '+18005551234',
        vapiPhoneNumberId: 'vapi-123',
      } as any);

      const res = await GET();
      const data = await res.json();
      expect(data.phoneNumber).toBe('+18005551234');
      expect(data.provisioned).toBe(true);
    });

    it('returns null when not provisioned', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        vapiPhoneNumber: null,
        vapiPhoneNumberId: null,
      } as any);

      const res = await GET();
      const data = await res.json();
      expect(data.phoneNumber).toBeNull();
      expect(data.provisioned).toBe(false);
    });
  });

  describe('POST /api/phone/provision', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);
      const req = new NextRequest('http://localhost/api/phone/provision', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it('returns existing number if already provisioned', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1', name: 'Test' } } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        vapiPhoneNumber: '+18005551234',
        vapiPhoneNumberId: 'vapi-existing',
        name: 'Test',
      } as any);

      const req = new NextRequest('http://localhost/api/phone/provision', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      const data = await res.json();
      expect(data.phoneNumber).toBe('+18005551234');
      expect(provisionPhoneNumber).not.toHaveBeenCalled();
    });

    it('provisions new number successfully', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1', name: 'Test' } } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        vapiPhoneNumber: null,
        vapiPhoneNumberId: null,
        name: 'Test User',
      } as any);
      vi.mocked(provisionPhoneNumber).mockResolvedValue({
        success: true,
        phoneNumber: '+18009999999',
        twilioSid: 'PN_new',
        vapiPhoneNumberId: 'vapi-new',
      });
      vi.mocked(prisma.user.update).mockResolvedValue({} as any);

      const req = new NextRequest('http://localhost/api/phone/provision', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.phoneNumber).toBe('+18009999999');
    });

    it('saves provisioned number to database', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1', name: 'Test' } } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        vapiPhoneNumber: null,
        vapiPhoneNumberId: null,
        name: 'Test',
      } as any);
      vi.mocked(provisionPhoneNumber).mockResolvedValue({
        success: true,
        phoneNumber: '+18009999999',
        twilioSid: 'PN_new',
        vapiPhoneNumberId: 'vapi-new',
      });
      vi.mocked(prisma.user.update).mockResolvedValue({} as any);

      const req = new NextRequest('http://localhost/api/phone/provision', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      });
      await POST(req);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: expect.objectContaining({
            vapiPhoneNumber: '+18009999999',
            vapiPhoneNumberId: 'vapi-new',
            twilioNumberSid: 'PN_new',
          }),
        })
      );
    });

    it('returns 400 when provisioning fails', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1', name: 'Test' } } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        vapiPhoneNumber: null,
        vapiPhoneNumberId: null,
        name: 'Test',
      } as any);
      vi.mocked(provisionPhoneNumber).mockResolvedValue({
        success: false,
        error: 'No phone numbers available',
      });

      const req = new NextRequest('http://localhost/api/phone/provision', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('No phone numbers');
    });
  });
});
