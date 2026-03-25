import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/documents/upload/route';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/app/api/auth/[...nextauth]/route', () => ({
  authOptions: {},
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    document: {
      create: vi.fn(),
    },
  },
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

function makeFormDataRequest(file?: { name: string; content: string; type: string; size?: number }) {
  const formData = new FormData();
  if (file) {
    const blob = new Blob([file.content], { type: file.type });
    formData.append('file', blob, file.name);
  }
  return new NextRequest('http://localhost:3000/api/documents/upload', {
    method: 'POST',
    body: formData,
  });
}

describe('POST /api/documents/upload', () => {
  beforeEach(() => {
    vi.mocked(getServerSession).mockReset();
    vi.mocked(prisma.document.create).mockReset();
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const req = makeFormDataRequest({ name: 'test.pdf', content: 'content', type: 'application/pdf' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 when no file provided', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    const formData = new FormData();
    const req = new NextRequest('http://localhost:3000/api/documents/upload', {
      method: 'POST',
      body: formData,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('creates document record on successful upload', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.document.create).mockResolvedValue({
      id: 'doc-1',
      name: 'contract.pdf',
      url: '/uploads/contract.pdf',
      size: 100,
    } as any);

    const req = makeFormDataRequest({ name: 'contract.pdf', content: 'PDF content', type: 'application/pdf' });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it('saves file name correctly', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.document.create).mockResolvedValue({ id: 'doc-1' } as any);

    const req = makeFormDataRequest({ name: 'legal-brief.docx', content: 'content', type: 'application/docx' });
    await POST(req);

    expect(prisma.document.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'legal-brief.docx',
          uploadedById: 'u1',
        }),
      })
    );
  });
});
