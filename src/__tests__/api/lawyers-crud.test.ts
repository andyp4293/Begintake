import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/lawyers/route';
import { PUT, DELETE } from '@/app/api/lawyers/[id]/route';
import { NextRequest } from 'next/server';

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
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    appointment: {
      deleteMany: vi.fn(),
    },
    callSession: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn((ops: any[]) => Promise.all(ops)),
  },
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

describe('Lawyers CRUD API', () => {
  beforeEach(() => {
    vi.mocked(getServerSession).mockReset();
    vi.mocked(prisma.lawyer.findMany).mockReset();
    vi.mocked(prisma.lawyer.create).mockReset();
    vi.mocked(prisma.lawyer.update).mockReset();
    vi.mocked(prisma.lawyer.delete).mockReset();
  });

  // ─── POST /api/lawyers ────────────────────────────────────────────────

  describe('POST /api/lawyers', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);
      const req = new NextRequest('http://localhost/api/lawyers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test', email: 'test@test.com' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it('returns 400 when name missing', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      const req = new NextRequest('http://localhost/api/lawyers', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@test.com' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 when email missing', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      const req = new NextRequest('http://localhost/api/lawyers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('creates lawyer successfully', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.lawyer.create).mockResolvedValue({
        id: 'l1', name: 'Sarah Chen', email: 'sarah@test.com', phone: '+15551234567',
        specialties: ['family'], available: true,
      } as any);

      const req = new NextRequest('http://localhost/api/lawyers', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Sarah Chen',
          email: 'sarah@test.com',
          phone: '+15551234567',
          specialties: ['family'],
        }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.name).toBe('Sarah Chen');
    });

    it('returns 409 on duplicate email', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.lawyer.create).mockRejectedValue({ code: 'P2002' });

      const req = new NextRequest('http://localhost/api/lawyers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test', email: 'dupe@test.com' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await POST(req);
      expect(res.status).toBe(409);
    });

    it('defaults available to true', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.lawyer.create).mockResolvedValue({ id: 'l2' } as any);

      const req = new NextRequest('http://localhost/api/lawyers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test', email: 'test@t.com' }),
        headers: { 'content-type': 'application/json' },
      });
      await POST(req);
      expect(prisma.lawyer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ available: true }),
        })
      );
    });

    it('handles non-array specialties gracefully', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.lawyer.create).mockResolvedValue({ id: 'l3' } as any);

      const req = new NextRequest('http://localhost/api/lawyers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test', email: 'test@t.com', specialties: 'family' }),
        headers: { 'content-type': 'application/json' },
      });
      await POST(req);
      expect(prisma.lawyer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ specialties: [] }),
        })
      );
    });
  });

  // ─── PUT /api/lawyers/[id] ────────────────────────────────────────────

  describe('PUT /api/lawyers/[id]', () => {
    const makeParams = (id: string) => Promise.resolve({ id });

    it('returns 401 when not authenticated', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);
      const req = new NextRequest('http://localhost/api/lawyers/l1', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Updated' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await PUT(req, { params: makeParams('l1') });
      expect(res.status).toBe(401);
    });

    it('updates lawyer successfully', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.lawyer.update).mockResolvedValue({
        id: 'l1', name: 'Updated Name', email: 'e@e.com',
      } as any);

      const req = new NextRequest('http://localhost/api/lawyers/l1', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Updated Name' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await PUT(req, { params: makeParams('l1') });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.name).toBe('Updated Name');
    });

    it('returns 404 when lawyer not found', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.lawyer.update).mockRejectedValue({ code: 'P2025' });

      const req = new NextRequest('http://localhost/api/lawyers/nonexistent', {
        method: 'PUT',
        body: JSON.stringify({ name: 'Test' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await PUT(req, { params: makeParams('nonexistent') });
      expect(res.status).toBe(404);
    });

    it('returns 409 on duplicate email update', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.lawyer.update).mockRejectedValue({ code: 'P2002' });

      const req = new NextRequest('http://localhost/api/lawyers/l1', {
        method: 'PUT',
        body: JSON.stringify({ email: 'dupe@test.com' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await PUT(req, { params: makeParams('l1') });
      expect(res.status).toBe(409);
    });
  });

  // ─── DELETE /api/lawyers/[id] ─────────────────────────────────────────

  describe('DELETE /api/lawyers/[id]', () => {
    const makeParams = (id: string) => Promise.resolve({ id });

    it('returns 401 when not authenticated', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);
      const req = new NextRequest('http://localhost/api/lawyers/l1', { method: 'DELETE' });
      const res = await DELETE(req, { params: makeParams('l1') });
      expect(res.status).toBe(401);
    });

    it('deletes lawyer successfully', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.appointment.deleteMany).mockResolvedValue({ count: 0 } as any);
      vi.mocked(prisma.callSession.updateMany).mockResolvedValue({ count: 0 } as any);
      vi.mocked(prisma.lawyer.delete).mockResolvedValue({} as any);

      const req = new NextRequest('http://localhost/api/lawyers/l1', { method: 'DELETE' });
      const res = await DELETE(req, { params: makeParams('l1') });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('returns 404 when lawyer not found', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
      vi.mocked(prisma.appointment.deleteMany).mockResolvedValue({ count: 0 } as any);
      vi.mocked(prisma.callSession.updateMany).mockResolvedValue({ count: 0 } as any);
      vi.mocked(prisma.lawyer.delete).mockRejectedValue({ code: 'P2025' });

      const req = new NextRequest('http://localhost/api/lawyers/nonexistent', { method: 'DELETE' });
      const res = await DELETE(req, { params: makeParams('nonexistent') });
      expect(res.status).toBe(404);
    });
  });
});
