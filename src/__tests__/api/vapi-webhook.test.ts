import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/webhooks/vapi/route';
import { NextRequest } from 'next/server';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => ({
  prisma: {
    lawyer: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    client: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    callSession: {
      create: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    appointment: {
      create: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/google-calendar', () => ({
  createCalendarEvent: vi.fn().mockResolvedValue('gcal-event-123'),
  getAvailableSlots: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/email', () => ({
  sendCallSummaryEmail: vi.fn().mockResolvedValue({ success: true }),
}));

import { prisma } from '@/lib/prisma';
import { createCalendarEvent } from '@/lib/google-calendar';
import { sendCallSummaryEmail } from '@/lib/email';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(body: any, secret?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret) headers['x-vapi-secret'] = secret;

  return new NextRequest('http://localhost:3000/api/webhooks/vapi', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
}

const mockLawyers = [
  { id: 'law-1', name: 'Sarah Chen', email: 'sarah@test.com', phone: '+15551001001', specialties: ['family', 'divorce', 'custody'], available: true, googleCalendarId: null },
  { id: 'law-2', name: 'Marcus Johnson', email: 'marcus@test.com', phone: '+15551001002', specialties: ['criminal', 'dui', 'defense'], available: true, googleCalendarId: null },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('VAPI Webhook', () => {
  beforeEach(() => {
    vi.mocked(prisma.lawyer.findMany).mockResolvedValue(mockLawyers as any);
    vi.mocked(prisma.lawyer.findUnique).mockResolvedValue(mockLawyers[0] as any);
    vi.mocked(prisma.client.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.client.create).mockResolvedValue({ id: 'cli-new', name: 'Test', phone: '+15559990001', isCurrentClient: false } as any);
    vi.mocked(prisma.callSession.create).mockResolvedValue({ id: 'cs-1' } as any);
    vi.mocked(prisma.callSession.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(prisma.callSession.upsert).mockResolvedValue({ id: 'cs-1' } as any);
    vi.mocked(prisma.appointment.create).mockResolvedValue({ id: 'apt-1' } as any);
    vi.unstubAllEnvs();
  });

  // ─── Secret verification ───────────────────────────────────────────────

  describe('secret verification', () => {
    it('rejects request with invalid secret', async () => {
      vi.stubEnv('VAPI_WEBHOOK_SECRET', 'correct-secret');
      const req = makeRequest({ type: 'assistant-request' }, 'wrong-secret');
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it('allows request with correct secret', async () => {
      vi.stubEnv('VAPI_WEBHOOK_SECRET', 'correct-secret');
      const req = makeRequest({ message: { type: 'assistant-request' } }, 'correct-secret');
      const res = await POST(req);
      expect(res.status).toBe(200);
    });

    it('allows request when no secret configured', async () => {
      vi.stubEnv('VAPI_WEBHOOK_SECRET', '');
      const req = makeRequest({ message: { type: 'assistant-request' } });
      const res = await POST(req);
      expect(res.status).toBe(200);
    });
  });

  // ─── assistant-request ─────────────────────────────────────────────────

  describe('assistant-request', () => {
    it('returns assistant config with system prompt', async () => {
      const req = makeRequest({ message: { type: 'assistant-request' } });
      const res = await POST(req);
      const data = await res.json();
      expect(data.assistant).toBeDefined();
      expect(data.assistant.model.messages[0].content).toContain('AI paralegal');
    });

    it('includes tool definitions', async () => {
      const req = makeRequest({ message: { type: 'assistant-request' } });
      const res = await POST(req);
      const data = await res.json();
      const toolNames = data.assistant.model.tools.map((t: any) => t.function.name);
      expect(toolNames).toContain('checkClient');
      expect(toolNames).toContain('identifyLawyer');
      expect(toolNames).toContain('scheduleConsultation');
      expect(toolNames).toContain('transferCall');
      expect(toolNames).toContain('generateSummary');
    });

    it('includes lawyer list in system prompt', async () => {
      const req = makeRequest({ message: { type: 'assistant-request' } });
      const res = await POST(req);
      const data = await res.json();
      expect(data.assistant.model.messages[0].content).toContain('Sarah Chen');
      expect(data.assistant.model.messages[0].content).toContain('Marcus Johnson');
    });

    it('includes first message', async () => {
      const req = makeRequest({ message: { type: 'assistant-request' } });
      const res = await POST(req);
      const data = await res.json();
      expect(data.assistant.firstMessage).toContain('law firm');
    });
  });

  // ─── tool-calls: checkClient ───────────────────────────────────────────

  describe('tool-calls: checkClient', () => {
    it('returns isCurrentClient true for existing client', async () => {
      vi.mocked(prisma.client.findUnique).mockResolvedValue({
        id: 'cli-1',
        name: 'John Martinez',
        phone: '+15559990001',
        isCurrentClient: true,
        assignedLawyer: { name: 'Sarah Chen', phone: '+15551001001' },
      } as any);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          toolCallList: [{
            id: 'tc-1',
            function: { name: 'checkClient', arguments: { name: 'John', phone: '5559990001' } },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);
      expect(result.isCurrentClient).toBe(true);
      expect(result.assignedLawyerName).toBe('Sarah Chen');
    });

    it('returns isCurrentClient false for unknown caller', async () => {
      vi.mocked(prisma.client.findUnique).mockResolvedValue(null);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          toolCallList: [{
            id: 'tc-2',
            function: { name: 'checkClient', arguments: { phone: '5550000000' } },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);
      expect(result.isCurrentClient).toBe(false);
    });

    it('handles missing phone number', async () => {
      const req = makeRequest({
        message: {
          type: 'tool-calls',
          toolCallList: [{
            id: 'tc-3',
            function: { name: 'checkClient', arguments: {} },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);
      expect(result.isCurrentClient).toBe(false);
    });
  });

  // ─── tool-calls: identifyLawyer ────────────────────────────────────────

  describe('tool-calls: identifyLawyer', () => {
    it('identifies family lawyer for divorce case', async () => {
      const req = makeRequest({
        message: {
          type: 'tool-calls',
          toolCallList: [{
            id: 'tc-4',
            function: { name: 'identifyLawyer', arguments: { legalIssueDescription: 'I need help with my divorce' } },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);
      expect(result.found).toBe(true);
      expect(result.legalArea).toBe('family');
      expect(result.lawyerName).toBe('Sarah Chen');
    });

    it('identifies criminal lawyer for DUI', async () => {
      const req = makeRequest({
        message: {
          type: 'tool-calls',
          toolCallList: [{
            id: 'tc-5',
            function: { name: 'identifyLawyer', arguments: { legalIssueDescription: 'I got arrested for DUI' } },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);
      expect(result.found).toBe(true);
      expect(result.legalArea).toBe('criminal');
    });

    it('returns first available lawyer for unknown area', async () => {
      const req = makeRequest({
        message: {
          type: 'tool-calls',
          toolCallList: [{
            id: 'tc-6',
            function: { name: 'identifyLawyer', arguments: { legalIssueDescription: 'I need help' } },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);
      expect(result.found).toBe(true);
    });
  });

  // ─── tool-calls: scheduleConsultation ──────────────────────────────────

  describe('tool-calls: scheduleConsultation', () => {
    it('creates appointment successfully', async () => {
      const req = makeRequest({
        message: {
          type: 'tool-calls',
          toolCallList: [{
            id: 'tc-7',
            function: {
              name: 'scheduleConsultation',
              arguments: {
                clientName: 'Jane Smith',
                clientPhone: '5559990001',
                lawyerId: 'law-1',
                preferredDate: '2025-03-30',
                preferredTime: '2 PM',
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);
      expect(result.success).toBe(true);
      expect(result.lawyerName).toBe('Sarah Chen');
    });

    it('creates client record if not existing', async () => {
      vi.mocked(prisma.client.findUnique).mockResolvedValue(null);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          toolCallList: [{
            id: 'tc-8',
            function: {
              name: 'scheduleConsultation',
              arguments: {
                clientName: 'New Person',
                clientPhone: '5550001111',
                lawyerId: 'law-1',
                preferredDate: '2025-03-30',
                preferredTime: '3 PM',
              },
            },
          }],
        },
      });

      await POST(req);
      expect(prisma.client.create).toHaveBeenCalled();
    });

    it('calls Google Calendar to create event', async () => {
      const req = makeRequest({
        message: {
          type: 'tool-calls',
          toolCallList: [{
            id: 'tc-9',
            function: {
              name: 'scheduleConsultation',
              arguments: {
                clientName: 'Test Client',
                clientPhone: '5559990001',
                lawyerId: 'law-1',
                preferredDate: '2025-03-30',
                preferredTime: '10 AM',
              },
            },
          }],
        },
      });

      await POST(req);
      expect(createCalendarEvent).toHaveBeenCalled();
    });

    it('returns error for invalid time', async () => {
      const req = makeRequest({
        message: {
          type: 'tool-calls',
          toolCallList: [{
            id: 'tc-10',
            function: {
              name: 'scheduleConsultation',
              arguments: {
                clientName: 'Test',
                clientPhone: '5559990001',
                lawyerId: 'law-1',
                preferredDate: '2025-03-30',
                preferredTime: 'sometime around noon maybe',
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);
      expect(result.success).toBe(false);
    });

    it('returns error for unknown lawyer', async () => {
      vi.mocked(prisma.lawyer.findUnique).mockResolvedValue(null);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          toolCallList: [{
            id: 'tc-11',
            function: {
              name: 'scheduleConsultation',
              arguments: {
                clientName: 'Test',
                clientPhone: '5559990001',
                lawyerId: 'law-nonexistent',
                preferredDate: '2025-03-30',
                preferredTime: '2 PM',
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);
      expect(result.success).toBe(false);
    });
  });

  // ─── tool-calls: transferCall ──────────────────────────────────────────

  describe('tool-calls: transferCall', () => {
    it('returns transfer destination', async () => {
      const req = makeRequest({
        message: {
          type: 'tool-calls',
          toolCallList: [{
            id: 'tc-12',
            function: {
              name: 'transferCall',
              arguments: { phoneNumber: '+15551001001', reason: 'Current client' },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);
      expect(result.type).toBe('transfer');
      expect(result.destination.number).toBe('+15551001001');
    });

    it('uses default transfer number when none provided', async () => {
      vi.stubEnv('TRANSFER_PHONE_NUMBER', '+15559999999');
      vi.mocked(prisma.user.findFirst).mockResolvedValue(null);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          toolCallList: [{
            id: 'tc-13',
            function: { name: 'transferCall', arguments: {} },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);
      expect(result.destination.number).toBe('+15559999999');
    });
  });

  // ─── tool-calls: generateSummary ───────────────────────────────────────

  describe('tool-calls: generateSummary', () => {
    it('creates call session and sends email', async () => {
      const req = makeRequest({
        message: {
          type: 'tool-calls',
          toolCallList: [{
            id: 'tc-14',
            function: {
              name: 'generateSummary',
              arguments: {
                callerName: 'Jane Doe',
                callerPhone: '5559990001',
                issue: 'Going through a difficult divorce with custody dispute',
                notes: 'Two children ages 5 and 8, married 10 years',
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(true);
      expect(prisma.callSession.create).toHaveBeenCalled();
      expect(sendCallSummaryEmail).toHaveBeenCalled();
    });

    it('sends email to matched lawyer', async () => {
      const req = makeRequest({
        message: {
          type: 'tool-calls',
          toolCallList: [{
            id: 'tc-15',
            function: {
              name: 'generateSummary',
              arguments: {
                callerName: 'Test Person',
                callerPhone: '5559990001',
                issue: 'I need help with my divorce',
              },
            },
          }],
        },
      });

      await POST(req);
      expect(sendCallSummaryEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          lawyerEmail: 'sarah@test.com',
          callerName: 'Test Person',
          legalArea: 'family',
        })
      );
    });

    it('creates client record if not existing', async () => {
      vi.mocked(prisma.client.findUnique).mockResolvedValue(null);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          toolCallList: [{
            id: 'tc-16',
            function: {
              name: 'generateSummary',
              arguments: {
                callerName: 'New Caller',
                callerPhone: '5550001111',
                issue: 'Legal help needed',
              },
            },
          }],
        },
      });

      await POST(req);
      expect(prisma.client.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isCurrentClient: false }),
        })
      );
    });
  });

  // ─── status-update ─────────────────────────────────────────────────────

  describe('status-update', () => {
    it('updates call session on call end', async () => {
      const req = makeRequest({
        message: {
          type: 'status-update',
          status: 'ended',
          call: { id: 'call-123' },
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(prisma.callSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { callId: 'call-123' },
        })
      );
    });

    it('processes non-ended status updates without error', async () => {
      const req = makeRequest({
        message: { type: 'status-update', status: 'ringing', call: { id: 'call-123' } },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
    });
  });

  // ─── end-of-call-report ────────────────────────────────────────────────

  describe('end-of-call-report', () => {
    it('saves summary and transcript', async () => {
      const req = makeRequest({
        message: {
          type: 'end-of-call-report',
          call: { id: 'call-456' },
          summary: 'Client needs help with divorce',
          transcript: [
            { role: 'assistant', content: 'How can I help?' },
            { role: 'user', content: 'I need a divorce lawyer' },
          ],
        },
      });

      await POST(req);
      expect(prisma.callSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { callId: 'call-456' },
          data: expect.objectContaining({
            summary: 'Client needs help with divorce',
          }),
        })
      );
    });

    it('handles string transcript', async () => {
      const req = makeRequest({
        message: {
          type: 'end-of-call-report',
          call: { id: 'call-789' },
          summary: 'Test',
          transcript: 'Some transcript text',
        },
      });

      await POST(req);
      expect(prisma.callSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ notes: 'Some transcript text' }),
        })
      );
    });
  });

  // ─── call-start ────────────────────────────────────────────────────────

  describe('call-start', () => {
    it('creates call session on call start', async () => {
      const req = makeRequest({
        message: {
          type: 'call-start',
          call: { id: 'call-new', customer: { number: '+15559990001' } },
        },
      });

      await POST(req);
      expect(prisma.callSession.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { callId: 'call-new' },
        })
      );
    });
  });

  // ─── unknown message type ──────────────────────────────────────────────

  describe('unknown message types', () => {
    it('returns 200 with received: true', async () => {
      const req = makeRequest({ message: { type: 'unknown-type' } });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.received).toBe(true);
    });
  });

  // ─── error handling ────────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns 400 on invalid JSON body', async () => {
      const req = new NextRequest('http://localhost:3000/api/webhooks/vapi', {
        method: 'POST',
        body: 'invalid json{{{',
        headers: { 'content-type': 'application/json' },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });
});
