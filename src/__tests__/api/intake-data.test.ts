import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/calls/[id]/intake-data/route';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    callSession: { findUnique: vi.fn() },
  },
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

describe('GET /api/calls/[id]/intake-data', () => {
  beforeEach(() => {
    vi.mocked(getServerSession).mockReset();
    vi.mocked(prisma.callSession.findUnique).mockReset();
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/calls/cs1/intake-data');
    const res = await GET(req, { params: Promise.resolve({ id: 'cs1' }) });
    expect(res.status).toBe(401);
  });

  it('returns 404 when call not found', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.callSession.findUnique).mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/calls/nonexistent/intake-data');
    const res = await GET(req, { params: Promise.resolve({ id: 'nonexistent' }) });
    expect(res.status).toBe(404);
  });

  it('returns structured intake data', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.callSession.findUnique).mockResolvedValue({
      id: 'cs1',
      callerPhone: '+15551234567',
      clientType: 'prospective',
      callOutcome: 'transferred',
      legalArea: 'family',
      urgencyFlag: 'standard',
      petitionType: 'V-Petition - new',
      matterCategory: 'Custody & Visitation',
      partyRole: 'self',
      summary: 'Custody dispute',
      notes: 'Two children',
      transferred: true,
      transferredTo: '+18482612613',
      client: { name: 'John', phone: '+15551234567', email: 'john@test.com' },
      lawyer: { name: 'Sarah Chen', email: 'sarah@test.com', specialties: ['family'] },
      intakeData: [
        { id: 'id1', fieldName: 'caller_name', fieldValue: 'John Smith', createdAt: new Date() },
        { id: 'id-flow', fieldName: '__flow_current_node_id', fieldValue: 'node-123', createdAt: new Date() },
        { id: 'id2', fieldName: 'num_children', fieldValue: '2', createdAt: new Date() },
      ],
      createdAt: new Date(),
    } as any);

    const req = new NextRequest('http://localhost/api/calls/cs1/intake-data');
    const res = await GET(req, { params: Promise.resolve({ id: 'cs1' }) });
    const data = await res.json();

    expect(data.petitionType).toBe('V-Petition - new');
    expect(data.matterCategory).toBe('Custody & Visitation');
    expect(data.urgencyFlag).toBe('standard');
    expect(data.partyRole).toBe('self');
    expect(data.intakeData).toHaveLength(2);
    expect(data.intakeData.some((row: any) => row.fieldName === '__flow_current_node_id')).toBe(false);
    expect(data.client.name).toBe('John');
    expect(data.lawyer.name).toBe('Sarah Chen');
  });

  it('returns all intake data fields', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as any);
    vi.mocked(prisma.callSession.findUnique).mockResolvedValue({
      id: 'cs2',
      callerPhone: '+15559990001',
      clientType: null,
      callOutcome: null,
      legalArea: null,
      urgencyFlag: null,
      petitionType: null,
      matterCategory: null,
      partyRole: null,
      summary: null,
      notes: null,
      transferred: false,
      transferredTo: null,
      client: null,
      lawyer: null,
      intakeData: [],
      createdAt: new Date(),
    } as any);

    const req = new NextRequest('http://localhost/api/calls/cs2/intake-data');
    const res = await GET(req, { params: Promise.resolve({ id: 'cs2' }) });
    const data = await res.json();

    expect(data.id).toBe('cs2');
    expect(data.intakeData).toEqual([]);
  });
});
