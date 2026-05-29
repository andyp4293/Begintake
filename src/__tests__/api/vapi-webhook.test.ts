import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/webhooks/vapi/route';
import { NextRequest } from 'next/server';
import { createGeneralIntakeTemplate } from '@/lib/templates/general-intake';
import { FLOW_CURRENT_NODE_KEY, FLOW_POST_STATE_KEY } from '@/lib/active-flow-runner';

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
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    intakeFlow: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    intakeData: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
    appointment: {
      create: vi.fn(),
    },
    user: {
      findFirst: vi.fn().mockResolvedValue({ id: 'user-1' }),
      findUnique: vi.fn().mockResolvedValue({ id: 'user-1', googleRefreshToken: null }),
    },
  },
}));

vi.mock('@/lib/google-calendar', () => ({
  createCalendarEvent: vi.fn().mockResolvedValue('gcal-event-123'),
  getAvailableSlots: vi.fn().mockResolvedValue([]),
  checkAttorneyBusy: vi.fn().mockResolvedValue({ available: true, withinBusinessHours: true, calendarChecked: false }),
}));

vi.mock('@/lib/email', () => ({
  sendCallSummaryEmail: vi.fn().mockResolvedValue({ success: true }),
}));

import { prisma } from '@/lib/prisma';
import { createCalendarEvent } from '@/lib/google-calendar';
import { sendCallSummaryEmail } from '@/lib/email';

const generalFlow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

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

function getAssistantRequestCacheKey(body: any) {
  return body?.message?.call?.phoneNumberId || body?.message?.call?.phoneNumber?.id || '__default__';
}

async function waitForAssistantRequestCache(body: any) {
  const key = getAssistantRequestCacheKey(body);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const cache = (globalThis as any).assistantRequestContextCache as Map<string, unknown> | undefined;
    if (cache?.has(key)) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`assistant request cache did not warm for key ${key}`);
}

async function getAssistant(body: any, secret?: string) {
  const req = makeRequest(body, secret);
  const res = await POST(req);
  const data = await res.json();
  return { res, data };
}

async function getWarmedAssistant(body: any, secret?: string) {
  await getAssistant(body, secret);
  await waitForAssistantRequestCache(body);
  return getAssistant(body, secret);
}

const mockLawyers = [
  { id: 'law-1', name: 'Sarah Chen', email: 'sarah@test.com', phone: '+15551001001', specialties: ['family', 'divorce', 'custody'], available: true, googleCalendarId: null, availabilityStart: 9, availabilityEnd: 17 },
  { id: 'law-2', name: 'Marcus Johnson', email: 'marcus@test.com', phone: '+15551001002', specialties: ['criminal', 'dui', 'defense'], available: true, googleCalendarId: null, availabilityStart: 9, availabilityEnd: 17 },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('VAPI Webhook', () => {
  beforeEach(() => {
    ((globalThis as any).assistantRequestContextCache as Map<string, unknown> | undefined)?.clear();
    vi.clearAllMocks();
    vi.mocked(prisma.lawyer.findMany).mockResolvedValue(mockLawyers as any);
    vi.mocked(prisma.lawyer.findUnique).mockResolvedValue(mockLawyers[0] as any);
    vi.mocked(prisma.client.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.client.create).mockResolvedValue({ id: 'cli-new', name: 'Test', phone: '+15559990001', isCurrentClient: false } as any);
    vi.mocked(prisma.callSession.create).mockResolvedValue({ id: 'cs-1' } as any);
    vi.mocked(prisma.callSession.update).mockResolvedValue({ id: 'cs-1' } as any);
    vi.mocked(prisma.callSession.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(prisma.callSession.upsert).mockResolvedValue({ id: 'cs-1' } as any);
    vi.mocked(prisma.callSession.findFirst).mockResolvedValue({ id: 'cs-1', callerPhone: '+15559990001' } as any);
    vi.mocked(prisma.callSession.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.intakeData.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.intakeData.createMany).mockResolvedValue({ count: 0 } as any);
    vi.mocked(prisma.intakeFlow.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.intakeFlow.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.appointment.create).mockResolvedValue({ id: 'apt-1' } as any);
    vi.mocked(sendCallSummaryEmail).mockResolvedValue({ success: true });
    vi.unstubAllEnvs();
    vi.stubEnv('ENABLE_LIVE_CALL_TRANSFERS', '');
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
  });

  // ─── Secret verification ───────────────────────────────────────────────

  describe('secret verification', () => {
    it('allows request with invalid secret (warn only)', async () => {
      vi.stubEnv('VAPI_WEBHOOK_SECRET', 'correct-secret');
      const req = makeRequest({ message: { type: 'assistant-request' } }, 'wrong-secret');
      const res = await POST(req);
      expect(res.status).toBe(200);
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
      const { data } = await getAssistant({ message: { type: 'assistant-request' } });
      expect(data.assistant).toBeDefined();
      expect(data.assistant.model.messages[0].content).toContain('CURRENT CLIENT');
    });

    it('includes tool definitions', async () => {
      const { data } = await getWarmedAssistant({ message: { type: 'assistant-request' } });
      const toolNames = data.assistant.model.tools.filter((t: any) => t.function).map((t: any) => t.function.name);
      expect(toolNames).toContain('captureIntakeState');
      expect(toolNames).toContain('advanceActiveFlow');
      expect(toolNames).toContain('checkClient');
      expect(toolNames).toContain('identifyLawyer');
      expect(toolNames).toContain('scheduleConsultation');
      expect(toolNames).toContain('generateSummary');
      // transferCall removed - using forwardingPhoneNumber instead
      expect(data.assistant.model.tools.some((t: any) => t.type === 'endCall')).toBe(true);
    });

    it('includes lawyer list in system prompt', async () => {
      const { data } = await getWarmedAssistant({ message: { type: 'assistant-request' } });
      expect(data.assistant.model.messages[0].content).toContain('Sarah Chen');
      expect(data.assistant.model.messages[0].content).toContain('Marcus Johnson');
    });

    it('includes first message', async () => {
      const { data } = await getAssistant({ message: { type: 'assistant-request' } });
      expect(data.assistant.firstMessage).toContain('law firm');
    });

    it('does not write a call session during assistant-request bootstrap', async () => {
      const req = makeRequest({
        message: {
          type: 'assistant-request',
          call: {
            id: 'call-warmup-1',
            phoneNumberId: 'pn-warmup-1',
            customer: { number: '+15559990001' },
          },
        },
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(prisma.callSession.upsert).not.toHaveBeenCalled();
      expect(prisma.callSession.create).not.toHaveBeenCalled();
      expect(prisma.callSession.update).not.toHaveBeenCalled();
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

  describe('tool-calls: captureIntakeState', () => {
    it('persists captured slots and returns the remaining common fields', async () => {
      vi.mocked(prisma.callSession.findUnique).mockResolvedValue({ id: 'cs-1', callId: 'call-1', callerPhone: '+15559990001', clientType: null } as any);
      vi.mocked(prisma.intakeData.findMany).mockResolvedValue([
        { fieldName: 'callerName', fieldValue: 'Andy Pham' },
        { fieldName: 'clientStatus', fieldValue: 'new' },
      ] as any);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: {
            id: 'call-1',
            customer: { number: '+15559990001' },
          },
          toolCallList: [{
            id: 'tc-capture-1',
            function: {
              name: 'captureIntakeState',
              arguments: {
                callerName: 'Andy Pham',
                clientStatus: 'new',
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(prisma.intakeData.createMany).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.capturedFields.callerName).toBe('Andy Pham');
      expect(result.capturedFields.clientStatus).toBe('new');
      expect(result.missingCommonFields).toContain('callingFor');
      expect(result.missingCommonFields).toContain('issueSummary');
    });

    it('ignores weak issue summaries and same-number auto-confirmations', async () => {
      vi.mocked(prisma.callSession.findUnique).mockResolvedValue({ id: 'cs-1', callId: 'call-1', callerPhone: '+15559990001', clientType: null } as any);
      vi.mocked(prisma.intakeData.findMany).mockResolvedValue([] as any);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: {
            id: 'call-1',
            customer: { number: '+15559990001' },
          },
          toolCallList: [{
            id: 'tc-capture-2',
            function: {
              name: 'captureIntakeState',
              arguments: {
                callerPhone: '+15559990001',
                issueSummary: 'First time.',
                clientStatus: 'new',
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);
      const createManyArgs = vi.mocked(prisma.intakeData.createMany).mock.calls.at(-1)?.[0];

      expect(createManyArgs?.data).toEqual([
        expect.objectContaining({ fieldName: 'clientStatus', fieldValue: 'new' }),
      ]);
      expect(result.capturedFields.issueSummary).toBeUndefined();
      expect(result.capturedFields.callerPhone).toBe('+15559990001');
    });
  });

  describe('tool-calls: advanceActiveFlow', () => {
    it('skips already captured opening answers and asks the next real branch question', async () => {
      vi.mocked(prisma.intakeFlow.findUnique).mockResolvedValue(generalFlow);
      vi.mocked(prisma.callSession.findUnique).mockResolvedValue({
        id: 'cs-1',
        callId: 'call-1',
        callerPhone: '+15559990001',
        clientType: 'prospective',
        intakeFlowId: generalFlow.id,
      } as any);
      vi.mocked(prisma.intakeData.findMany).mockResolvedValue([
        { fieldName: 'callerName', fieldValue: 'Andy Pham' },
        { fieldName: 'caller_name', fieldValue: 'Andy Pham' },
        { fieldName: 'clientStatus', fieldValue: 'new' },
        { fieldName: 'callerPhone', fieldValue: '+15559990001' },
        { fieldName: 'callback_phone', fieldValue: '+15559990001' },
        { fieldName: 'callingFor', fieldValue: 'self' },
        { fieldName: 'issueSummary', fieldValue: 'I got in a car accident and broke my arm.' },
      ] as any);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: {
            id: 'call-1',
            customer: { number: '+15559990001' },
          },
          toolCallList: [{
            id: 'tc-advance-1',
            function: {
              name: 'advanceActiveFlow',
              arguments: {
                callerResponse: 'Yes',
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(true);
      expect(result.step).toBe('ask');
      expect(result.currentNodeLabel).toBe('PI D1. Date of Incident');
      expect(result.spokenByTool).toBe(true);
      expect(result.assistantMessage).toBeUndefined();
      expect(data.results[0].name).toBe('advanceActiveFlow');
      expect(data.results[0].message).toMatchObject({
        type: 'request-complete',
        role: 'assistant',
        content: 'Approximately when did the incident occur?',
      });
    });

    it('uses the assistant semantic branch hint to advance natural divorce answers without looping', async () => {
      vi.mocked(prisma.intakeFlow.findUnique).mockResolvedValue(generalFlow);
      vi.mocked(prisma.callSession.findUnique).mockResolvedValue({
        id: 'cs-1',
        callId: 'call-1',
        callerPhone: '+15559990001',
        clientType: 'prospective',
        intakeFlowId: generalFlow.id,
      } as any);
      vi.mocked(prisma.intakeData.findMany).mockResolvedValue([
        { fieldName: '__flow_current_node_id', fieldValue: generalFlow.nodes.find((node: any) => node.label === 'FH2. Filing Status / Court Dates')?.id },
      ] as any);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: {
            id: 'call-1',
            customer: { number: '+15559990001' },
          },
          toolCallList: [{
            id: 'tc-advance-semantic-1',
            function: {
              name: 'advanceActiveFlow',
              arguments: {
                callerResponse: 'No. None.',
                matchedChoiceLabel: 'nothing filed yet',
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(true);
      expect(result.step).toBe('ask');
      expect(result.currentNodeLabel).toBe('FH3. Children Involved');
      expect(result.spokenByTool).toBe(true);
      expect(result.assistantMessage).toBeUndefined();
      expect(data.results[0].message).toMatchObject({
        type: 'request-complete',
        role: 'assistant',
        content: 'Are there minor children involved in this matter?',
      });
    });

    it('uses semantic correction facts to reroute an out-of-order existing-client correction into the paralegal transfer path', async () => {
      vi.stubEnv('TRANSFER_PHONE_NUMBER', '+15559999999');
      vi.mocked(prisma.intakeFlow.findUnique).mockResolvedValue(generalFlow);
      vi.mocked(prisma.callSession.findUnique).mockResolvedValue({
        id: 'cs-1',
        callId: 'call-1',
        callerPhone: '+15559990001',
        clientType: 'prospective',
        intakeFlowId: generalFlow.id,
      } as any);
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'user-1', transferPhoneNumber: '+15559999999' } as any);
      vi.mocked(prisma.intakeData.findMany).mockResolvedValue([
        { fieldName: '__flow_current_node_id', fieldValue: generalFlow.nodes.find((node: any) => node.label === 'Q2. Caller Name')?.id },
        { fieldName: 'clientStatus', fieldValue: 'new' },
      ] as any);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: {
            id: 'call-1',
            customer: { number: '+15559990001' },
            monitor: { controlUrl: 'https://api.vapi.test/call/semantic-correction' },
          },
          toolCallList: [{
            id: 'tc-advance-semantic-correction-1',
            function: {
              name: 'advanceActiveFlow',
              arguments: {
                callerResponse: "Actually, it's not my first time.",
                semanticFacts: {
                  answerIntent: 'correction',
                  clientStatus: 'existing',
                },
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(true);
      expect(result.step).toBe('live_transfer');
      expect(result.transferred).toBe(true);
    });

    it('does not repeat the client-status question when the caller answers it with a greeting plus a clear first-time answer', async () => {
      const clientStatusQuestion = generalFlow.nodes.find((node: any) => node.label === 'Q1b. New or Existing Client?');
      const nameQuestion = generalFlow.nodes.find((node: any) => node.label === 'Q2. Caller Name');
      vi.mocked(prisma.intakeFlow.findUnique).mockResolvedValue(generalFlow);
      vi.mocked(prisma.callSession.findUnique).mockResolvedValue({
        id: 'cs-1',
        callId: 'call-1',
        callerPhone: '+15559990001',
        clientType: 'prospective',
        intakeFlowId: generalFlow.id,
      } as any);
      vi.mocked(prisma.intakeData.findMany).mockResolvedValue([
        { fieldName: '__flow_current_node_id', fieldValue: clientStatusQuestion?.id },
      ] as any);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: {
            id: 'call-1',
            customer: { number: '+15559990001' },
          },
          toolCallList: [{
            id: 'tc-advance-first-time-with-greeting-1',
            function: {
              name: 'advanceActiveFlow',
              arguments: {
                callerResponse: "Hello. It's, uh, my first time.",
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(true);
      expect(result.step).toBe('ask');
      expect(result.currentNodeLabel).toBe(nameQuestion?.label);
      expect(result.spokenByTool).toBe(true);
      expect(data.results[0].message).toMatchObject({
        type: 'request-complete',
        role: 'assistant',
        content: 'Could I start with your first and last name?',
      });
    });

    it('ends a clear wrong-number call from the opener when semantic understanding marks it as non-legal', async () => {
      vi.mocked(prisma.intakeFlow.findUnique).mockResolvedValue(generalFlow);
      vi.mocked(prisma.callSession.findUnique).mockResolvedValue({
        id: 'cs-1',
        callId: 'call-1',
        callerPhone: '+15559990001',
        clientType: 'prospective',
        intakeFlowId: generalFlow.id,
      } as any);
      vi.mocked(prisma.intakeData.findMany).mockResolvedValue([
        { fieldName: '__flow_current_node_id', fieldValue: generalFlow.nodes.find((node: any) => node.label === 'Q1. Shall We Get Started?')?.id },
      ] as any);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: {
            id: 'call-1',
            customer: { number: '+15559990001' },
          },
          toolCallList: [{
            id: 'tc-advance-wrong-number-1',
            function: {
              name: 'advanceActiveFlow',
              arguments: {
                callerResponse: "I'm trying to buy concert tickets.",
                semanticFacts: {
                  answerIntent: 'unclear',
                  conversationFit: 'wrong_number',
                  issueSummary: 'Caller is trying to buy concert tickets and is not seeking legal help.',
                },
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(true);
      expect(result.step).toBe('end');
      expect(result.spokenByTool).toBe(true);
      expect(data.results[0].message).toMatchObject({
        type: 'request-complete',
        role: 'assistant',
      });
      expect(data.results[0].message.content).toContain('wrong number');
    });

    it('ends an obvious scam or wrong-number turn even after the intake has already moved deeper into the legal flow', async () => {
      const childrenQuestion = generalFlow.nodes.find((node: any) => node.label === 'FH3. Children Involved?'
        || node.label === 'FH3. Children Involved');
      vi.mocked(prisma.intakeFlow.findUnique).mockResolvedValue(generalFlow);
      vi.mocked(prisma.callSession.findUnique).mockResolvedValue({
        id: 'cs-1',
        callId: 'call-1',
        callerPhone: '+15559990001',
        clientType: 'prospective',
        intakeFlowId: generalFlow.id,
      } as any);
      vi.mocked(prisma.intakeData.findMany).mockResolvedValue([
        { fieldName: '__flow_current_node_id', fieldValue: childrenQuestion?.id },
        { fieldName: 'issue_summary', fieldValue: 'I need help with a divorce.' },
      ] as any);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: {
            id: 'call-1',
            customer: { number: '+15559990001' },
          },
          toolCallList: [{
            id: 'tc-advance-scam-caller-deep-1',
            function: {
              name: 'advanceActiveFlow',
              arguments: {
                callerResponse: "Actually, I'm a scam caller.",
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(true);
      expect(result.step).toBe('end');
      expect(result.spokenByTool).toBe(true);
      expect(data.results[0].message.content).toContain('wrong number');
    });

    it('does not reject a real fraud story as a wrong-number call just because it mentions a ticketing agency', async () => {
      const issueQuestion = generalFlow.nodes.find((node: any) => node.label === "Q5. Tell Me What's Going On");
      vi.mocked(prisma.intakeFlow.findUnique).mockResolvedValue(generalFlow);
      vi.mocked(prisma.callSession.findUnique).mockResolvedValue({
        id: 'cs-1',
        callId: 'call-1',
        callerPhone: '+15559990001',
        clientType: 'prospective',
        intakeFlowId: generalFlow.id,
      } as any);
      vi.mocked(prisma.intakeData.findMany).mockResolvedValue([
        { fieldName: '__flow_current_node_id', fieldValue: issueQuestion?.id },
      ] as any);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: {
            id: 'call-1',
            customer: { number: '+15559990001' },
          },
          toolCallList: [{
            id: 'tc-advance-ticketing-fraud-legal-1',
            function: {
              name: 'advanceActiveFlow',
              arguments: {
                callerResponse: 'Someone pretending to be a ticketing agency scammed me out of money and I need legal help.',
                semanticFacts: {
                  answerIntent: 'answered',
                  conversationFit: 'legal_intake',
                  issueSummary: 'Caller says an impersonator posing as a ticketing agency scammed them out of money.',
                },
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(true);
      expect(result.step).not.toBe('end');
      expect(result.currentNodeLabel).toBeTruthy();
      expect(data.results[0].message.content).not.toContain('wrong number');
    });

    it('can move past a blocked non-core question when semantic understanding says the caller wants to move on', async () => {
      const childrenQuestion = generalFlow.nodes.find((node: any) => node.label === 'FH3. Children Involved?'
        || node.label === 'FH3. Children Involved');
      vi.mocked(prisma.intakeFlow.findUnique).mockResolvedValue(generalFlow);
      vi.mocked(prisma.callSession.findUnique).mockResolvedValue({
        id: 'cs-1',
        callId: 'call-1',
        callerPhone: '+15559990001',
        clientType: 'prospective',
        intakeFlowId: generalFlow.id,
      } as any);
      vi.mocked(prisma.intakeData.findMany).mockResolvedValue([
        { fieldName: '__flow_current_node_id', fieldValue: childrenQuestion?.id },
      ] as any);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: {
            id: 'call-1',
            customer: { number: '+15559990001' },
          },
          toolCallList: [{
            id: 'tc-advance-skip-1',
            function: {
              name: 'advanceActiveFlow',
              arguments: {
                callerResponse: "I don't know. Can we move on?",
                semanticFacts: {
                  questionState: 'wants_to_skip',
                },
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(true);
      expect(result.step).toBe('ask');
      expect(result.currentNodeLabel).toBe('FH4. Other Side Representation');
      expect(result.spokenByTool).toBe(true);
      expect(result.assistantMessage).toBeUndefined();
      expect(data.results[0].message).toMatchObject({
        type: 'request-complete',
        role: 'assistant',
        content: 'Does your spouse or partner already have a lawyer?',
      });
    });

    it('answers a short in-context follow-up question without drifting off-topic', async () => {
      const childrenQuestion = generalFlow.nodes.find((node: any) => node.label === 'FH3. Children Involved?'
        || node.label === 'FH3. Children Involved');
      vi.mocked(prisma.intakeFlow.findUnique).mockResolvedValue(generalFlow);
      vi.mocked(prisma.callSession.findUnique).mockResolvedValue({
        id: 'cs-1',
        callId: 'call-1',
        callerPhone: '+15559990001',
        clientType: 'prospective',
        intakeFlowId: generalFlow.id,
      } as any);
      vi.mocked(prisma.intakeData.findMany).mockResolvedValue([
        { fieldName: '__flow_current_node_id', fieldValue: childrenQuestion?.id },
      ] as any);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: {
            id: 'call-1',
            customer: { number: '+15559990001' },
          },
          toolCallList: [{
            id: 'tc-advance-define-minor-1',
            function: {
              name: 'advanceActiveFlow',
              arguments: {
                callerResponse: 'What is a minor?',
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(true);
      expect(result.step).toBe('clarify');
      expect(result.currentNodeLabel).toBe('FH3. Children Involved');
      expect(result.spokenByTool).toBe(true);
      expect(data.results[0].message).toMatchObject({
        type: 'request-complete',
        role: 'assistant',
        content: 'A minor means a child under 18. Are there any children under 18 involved in this matter?',
      });
    });

    it('answers natural post-summary follow-up questions instead of looping the anything-else prompt', async () => {
      vi.stubEnv('TRANSFER_PHONE_NUMBER', '+15559999999');
      vi.mocked(prisma.intakeFlow.findUnique).mockResolvedValue(generalFlow);
      vi.mocked(prisma.callSession.findUnique).mockResolvedValue({
        id: 'cs-1',
        callId: 'call-1',
        callerPhone: '+15559990001',
        clientType: 'prospective',
        intakeFlowId: generalFlow.id,
      } as any);
      vi.mocked(prisma.intakeData.findMany).mockResolvedValue([
        { fieldName: FLOW_POST_STATE_KEY, fieldValue: 'awaiting_anything_else' },
      ] as any);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: {
            id: 'call-1',
            customer: { number: '+15559990001' },
          },
          toolCallList: [{
            id: 'tc-advance-post-follow-up',
            function: {
              name: 'advanceActiveFlow',
              arguments: {
                callerResponse: 'How long would it take for a lawyer to reach out?',
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(true);
      expect(result.step).toBe('say');
      expect(result.spokenByTool).toBe(true);
      expect(data.results[0].message).toMatchObject({
        type: 'request-complete',
        role: 'assistant',
      });
      expect(data.results[0].message.content).toContain('Thank you. I wrote down everything you shared with me today');
      expect(data.results[0].message.content).toContain("I can't promise an exact timeline over the phone");
      expect(data.results[0].message.content).not.toContain('flag it for immediate review');
      expect(data.results[0].message.content).not.toContain('transfer this call to our paralegal team now');
      expect(data.results[0].message.content).toContain('Is there anything else I can help you with today?');
    });

    it('does not offer a live paralegal transfer in post-summary follow-up copy', async () => {
      vi.stubEnv('TRANSFER_PHONE_NUMBER', '+15559999999');
      vi.mocked(prisma.intakeFlow.findUnique).mockResolvedValue(generalFlow);
      vi.mocked(prisma.callSession.findUnique).mockResolvedValue({
        id: 'cs-1',
        callId: 'call-1',
        callerPhone: '+15559990001',
        clientType: 'prospective',
        intakeFlowId: generalFlow.id,
      } as any);
      vi.mocked(prisma.intakeData.findMany).mockResolvedValue([
        { fieldName: FLOW_POST_STATE_KEY, fieldValue: 'awaiting_anything_else' },
      ] as any);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: {
            id: 'call-1',
            customer: { number: '+15559990001' },
            monitor: { controlUrl: 'https://api.vapi.test/call/post-summary-follow-up' },
          },
          toolCallList: [{
            id: 'tc-advance-post-follow-up-transfer',
            function: {
              name: 'advanceActiveFlow',
              arguments: {
                callerResponse: 'How long would it take for a lawyer to reach out?',
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();

      expect(data.results[0].message.content).not.toContain('transfer this call to our paralegal team now');
      expect(data.results[0].message.content).not.toContain('flag it for immediate review');
    });

    it('ends the intake instead of live-transferring when the caller asks for a person after summary', async () => {
      vi.stubEnv('TRANSFER_PHONE_NUMBER', '+15559999999');
      vi.mocked(prisma.intakeFlow.findUnique).mockResolvedValue(generalFlow);
      vi.mocked(prisma.callSession.findUnique).mockResolvedValue({
        id: 'cs-1',
        callId: 'call-1',
        callerPhone: '+15559990001',
        clientType: 'prospective',
        intakeFlowId: generalFlow.id,
        summary: 'I need help with a divorce',
        notes: 'Caller said this feels urgent.',
      } as any);
      vi.mocked(prisma.intakeData.findMany).mockResolvedValue([
        { fieldName: FLOW_POST_STATE_KEY, fieldValue: 'awaiting_anything_else' },
        { fieldName: 'callerName', fieldValue: 'Jane Doe' },
        { fieldName: 'issueSummary', fieldValue: 'I need help with a divorce' },
      ] as any);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: {
            id: 'call-1',
            customer: { number: '+15559990001' },
            monitor: { controlUrl: 'https://api.vapi.test/call/post-summary-urgent' },
          },
          toolCallList: [{
            id: 'tc-advance-post-urgent-transfer',
            function: {
              name: 'advanceActiveFlow',
              arguments: {
                callerResponse: 'Yes, this is urgent. Please transfer me to the paralegal.',
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(true);
      expect(result.step).toBe('end');
      expect(result.spokenByTool).toBe(true);
      expect(data.results[0].message.content).toContain('flagged it for urgent review');
      expect(mockFetch).not.toHaveBeenCalledWith(
        'https://api.vapi.test/call/post-summary-urgent/control',
        expect.anything(),
      );
      expect(prisma.callSession.findUnique).toHaveBeenCalledWith({ where: { callId: 'call-1' } });
    });

    it('uses semantic post-call intent to end with urgent team follow-up instead of a live transfer', async () => {
      vi.stubEnv('TRANSFER_PHONE_NUMBER', '+15559999999');
      vi.mocked(prisma.intakeFlow.findUnique).mockResolvedValue(generalFlow);
      vi.mocked(prisma.callSession.findUnique).mockResolvedValue({
        id: 'cs-1',
        callId: 'call-1',
        callerPhone: '+15559990001',
        clientType: 'prospective',
        intakeFlowId: generalFlow.id,
        summary: 'I need help with a divorce',
        notes: 'Caller sounded desperate and needed a person right away.',
      } as any);
      vi.mocked(prisma.intakeData.findMany).mockResolvedValue([
        { fieldName: FLOW_POST_STATE_KEY, fieldValue: 'awaiting_anything_else' },
        { fieldName: 'callerName', fieldValue: 'Jane Doe' },
        { fieldName: 'issueSummary', fieldValue: 'I need help with a divorce' },
      ] as any);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: {
            id: 'call-1',
            customer: { number: '+15559990001' },
            monitor: { controlUrl: 'https://api.vapi.test/call/post-summary-semantic-urgent' },
          },
          toolCallList: [{
            id: 'tc-advance-post-semantic-urgent-transfer',
            function: {
              name: 'advanceActiveFlow',
              arguments: {
                callerResponse: 'We desperately need to talk to someone.',
                semanticFacts: {
                  postCallIntent: 'urgent_transfer',
                },
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(true);
      expect(result.step).toBe('end');
      expect(result.spokenByTool).toBe(true);
      expect(data.results[0].message.content).toContain('flagged it for urgent review');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('immediately live-transfers to the paralegal when the caller asks for a real person during intake', async () => {
      vi.stubEnv('TRANSFER_PHONE_NUMBER', '+15559999999');
      vi.mocked(prisma.intakeFlow.findUnique).mockResolvedValue(generalFlow);
      vi.mocked(prisma.callSession.findUnique).mockResolvedValue({
        id: 'cs-1',
        callId: 'call-1',
        callerPhone: '+15559990001',
        clientType: 'prospective',
        intakeFlowId: generalFlow.id,
      } as any);
      vi.mocked(prisma.intakeData.findMany).mockResolvedValue([
        { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: generalFlow.nodes.find((node: any) => node.label === 'Q2. Caller Name')?.id },
        { fieldName: 'callerName', fieldValue: 'Jane Doe' },
        { fieldName: 'issueSummary', fieldValue: 'I need help with a divorce' },
      ] as any);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: {
            id: 'call-1',
            customer: { number: '+15559990001' },
            monitor: { controlUrl: 'https://api.vapi.test/call/in-progress-real-person' },
          },
          toolCallList: [{
            id: 'tc-advance-real-person-mid-intake',
            function: {
              name: 'advanceActiveFlow',
              arguments: {
                callerResponse: 'I want to talk to a real person.',
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(true);
      expect(result.step).toBe('live_transfer');
      expect(result.transferred).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vapi.test/call/in-progress-real-person/control',
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        }),
      );
    });

    it('immediately live-transfers when semantic understanding says the caller wants a human without relying on an exact phrase', async () => {
      vi.stubEnv('TRANSFER_PHONE_NUMBER', '+15559999999');
      vi.mocked(prisma.intakeFlow.findUnique).mockResolvedValue(generalFlow);
      vi.mocked(prisma.callSession.findUnique).mockResolvedValue({
        id: 'cs-1',
        callId: 'call-1',
        callerPhone: '+15559990001',
        clientType: 'prospective',
        intakeFlowId: generalFlow.id,
      } as any);
      vi.mocked(prisma.intakeData.findMany).mockResolvedValue([
        { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: generalFlow.nodes.find((node: any) => node.label === 'Q2. Caller Name')?.id },
        { fieldName: 'callerName', fieldValue: 'Jane Doe' },
        { fieldName: 'issueSummary', fieldValue: 'I need help with a divorce' },
      ] as any);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: {
            id: 'call-1',
            customer: { number: '+15559990001' },
            monitor: { controlUrl: 'https://api.vapi.test/call/in-progress-semantic-human' },
          },
          toolCallList: [{
            id: 'tc-advance-semantic-human-mid-intake',
            function: {
              name: 'advanceActiveFlow',
              arguments: {
                callerResponse: 'Can somebody on your team take this from here?',
                semanticFacts: {
                  answerIntent: 'unclear',
                  requestHuman: true,
                },
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(true);
      expect(result.step).toBe('live_transfer');
      expect(result.transferred).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vapi.test/call/in-progress-semantic-human/control',
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        }),
      );
    });

    it('ends the call for natural done phrases after the anything-else prompt', async () => {
      vi.mocked(prisma.intakeFlow.findUnique).mockResolvedValue(generalFlow);
      vi.mocked(prisma.callSession.findUnique).mockResolvedValue({
        id: 'cs-1',
        callId: 'call-1',
        callerPhone: '+15559990001',
        clientType: 'prospective',
        intakeFlowId: generalFlow.id,
      } as any);
      vi.mocked(prisma.intakeData.findMany).mockResolvedValue([
        { fieldName: FLOW_POST_STATE_KEY, fieldValue: 'awaiting_anything_else' },
      ] as any);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: {
            id: 'call-1',
            customer: { number: '+15559990001' },
          },
          toolCallList: [{
            id: 'tc-advance-post-done',
            function: {
              name: 'advanceActiveFlow',
              arguments: {
                callerResponse: "Uh, I think I'm good, actually. I don't need any more help.",
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(true);
      expect(result.step).toBe('end');
      expect(result.spokenByTool).toBe(true);
      expect(data.results[0].message).toMatchObject({
        type: 'request-complete',
        role: 'assistant',
        content: 'Thank you for calling. Have a wonderful day. Goodbye!',
        endCallAfterSpokenEnabled: true,
      });
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
    it('returns a callback message when live transfers are disabled', async () => {
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
      expect(result.type).toBeUndefined();
      expect(result.liveTransfer).toBe(false);
      expect(result.message).toContain('right lawyer will reach out');
    });

    it('uses default transfer number when live transfers are enabled', async () => {
      vi.stubEnv('ENABLE_LIVE_CALL_TRANSFERS', 'true');
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
      expect(result.type).toBe('transfer');
      expect(result.destination.number).toBe('+15559999999');
    });

    it('posts a live transfer control request when a controlUrl is present', async () => {
      vi.stubEnv('ENABLE_LIVE_CALL_TRANSFERS', 'true');

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: {
            monitor: { controlUrl: 'https://api.vapi.test/call/mock-call' },
          },
          toolCallList: [{
            id: 'tc-13-control',
            function: { name: 'transferCall', arguments: { phoneNumber: '+15559999999' } },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);
      expect(result.transferred).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vapi.test/call/mock-call/control',
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        }),
      );
      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody).toEqual({
        type: 'transfer',
        destination: { type: 'number', number: '+15559999999' },
      });
    });
  });

  describe('tool-calls: generateTransferSummary', () => {
    it('returns summary-only follow-up by default', async () => {
      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: { id: 'call-queue-1' },
          toolCallList: [{
            id: 'tc-13a',
            function: {
              name: 'generateTransferSummary',
              arguments: {
                transferTarget: 'attorney',
                callerName: 'Jane Doe',
                callerPhone: '5559990001',
                issue: 'I need help with my divorce',
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);
      expect(result.type).toBeUndefined();
      expect(result.liveTransfer).toBe(false);
      expect(result.deliveryStatus).toBe('queued_until_call_end');
      expect(result.message).toContain('Thank you. I wrote down everything you shared with me today');
      expect(result.message).toContain('callback number I have for you');
      expect(result.message).not.toContain('flag it for immediate review');
      expect(result.message).not.toContain('recorded');
      expect(sendCallSummaryEmail).not.toHaveBeenCalled();
    });

    it('uses the live call id when queuing a summary-only follow-up', async () => {
      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: { id: 'call-queue-2' },
          toolCallList: [{
            id: 'tc-13a-fail',
            function: {
              name: 'generateTransferSummary',
              arguments: {
                transferTarget: 'attorney',
                callerName: 'Jane Doe',
                callerPhone: '5559990001',
                issue: 'I need help with my divorce',
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(true);
      expect(result.liveTransfer).toBe(false);
      expect(result.emailDelivered).toBe(false);
      expect(result.deliveryStatus).toBe('queued_until_call_end');
      expect(prisma.callSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cs-1' },
          data: expect.objectContaining({ callOutcome: 'summary_queued' }),
        })
      );
      expect(sendCallSummaryEmail).not.toHaveBeenCalled();
    });

    it('live-transfers to the paralegal without emailing a lawyer', async () => {
      vi.stubEnv('TRANSFER_PHONE_NUMBER', '+15559999999');
      vi.mocked(sendCallSummaryEmail).mockClear();

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: {
            monitor: { controlUrl: 'https://api.vapi.test/call/mock-paralegal' },
          },
          toolCallList: [{
            id: 'tc-13-paralegal',
            function: {
              name: 'generateTransferSummary',
              arguments: {
                transferTarget: 'paralegal',
                handoffMode: 'live_transfer',
                callerName: 'Jane Doe',
                callerPhone: '5559990001',
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);
      expect(result.liveTransfer).toBe(true);
      expect(result.transferred).toBe(true);
      expect(result.destination.number).toBe('+15559999999');
      expect(sendCallSummaryEmail).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vapi.test/call/mock-paralegal/control',
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        }),
      );
      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(fetchBody).toEqual({
        type: 'transfer',
        destination: { type: 'number', number: '+15559999999' },
        content: "Of course. I'll transfer you to our team right away.",
      });
    });

    it('returns a live transfer only when explicitly enabled', async () => {
      vi.stubEnv('ENABLE_LIVE_CALL_TRANSFERS', 'true');

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          toolCallList: [{
            id: 'tc-13b',
            function: {
              name: 'generateTransferSummary',
              arguments: {
                transferTarget: 'attorney',
                handoffMode: 'live_transfer',
                callerName: 'Jane Doe',
                callerPhone: '5559990001',
                issue: 'I need help with my divorce',
              },
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
  });

  // ─── tool-calls: generateSummary ───────────────────────────────────────

  describe('tool-calls: generateSummary', () => {
    it('rejects an incomplete divorce branch when the active flow still has unanswered divorce questions', async () => {
      vi.mocked(prisma.intakeFlow.findFirst).mockResolvedValue(generalFlow);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: { id: 'call-divorce-incomplete' },
          toolCallList: [{
            id: 'tc-divorce-incomplete',
            function: {
              name: 'generateSummary',
              arguments: {
                callerName: 'Divorce Caller',
                callerPhone: '5559990001',
                issue: 'I need help with my divorce',
                notes: 'Divorce or legal separation. Contested - we disagree on key issues. Child custody and support.',
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(false);
      expect(result.continueIntake).toBe(true);
      expect(result.deliveryStatus).toBe('incomplete_branch');
      expect(result.missingRequirements).toContain('Has anything already been filed, and is there any court date or deadline coming up?');
      expect(result.missingRequirements).toContain('Does your spouse or partner already have a lawyer?');
      expect(prisma.callSession.update).not.toHaveBeenCalled();
      expect(prisma.callSession.create).not.toHaveBeenCalled();
    });

    it('allows a divorce summary after the full divorce branch is covered in the active flow', async () => {
      vi.mocked(prisma.intakeFlow.findFirst).mockResolvedValue(generalFlow);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: { id: 'call-divorce-complete' },
          toolCallList: [{
            id: 'tc-divorce-complete',
            function: {
              name: 'generateSummary',
              arguments: {
                callerName: 'Divorce Caller',
                callerPhone: '5559990001',
                issue: 'I need help with my divorce',
                notes: [
                  'Divorce or legal separation.',
                  'Contested - we disagree on key issues.',
                  'Child custody and support.',
                  'Filed already - no court date yet.',
                  'Yes - minor children are involved.',
                  'No - the other side does not have a lawyer.',
                  'No - no immediate urgency.',
                ].join(' '),
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(true);
      expect(result.deliveryStatus).toBe('queued_until_call_end');
    });

    it('creates call session and queues email delivery until the call ends', async () => {
      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: { id: 'call-14' },
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
      expect(result.deliveryStatus).toBe('queued_until_call_end');
      expect(prisma.callSession.update).toHaveBeenCalled();
      expect(sendCallSummaryEmail).not.toHaveBeenCalled();
    });

    it('stores the matched lawyer and legal area on the queued summary', async () => {
      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: { id: 'call-15' },
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
      expect(prisma.callSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cs-1' },
          data: expect.objectContaining({
            callOutcome: 'summary_queued',
            legalArea: 'family',
            lawyerId: 'law-1',
          }),
        })
      );
      expect(sendCallSummaryEmail).not.toHaveBeenCalled();
    });

    it('prefers the verbally provided callback number over the inbound call number on queued summaries', async () => {
      vi.mocked(prisma.callSession.findUnique).mockResolvedValue({
        id: 'cs-callback',
        callId: 'call-callback',
        callerPhone: '+19087272437',
        status: 'active',
      } as any);
      vi.mocked(prisma.intakeData.findMany).mockResolvedValue([
        { fieldName: 'callerPhone', fieldValue: '+11237272437' },
      ] as any);
      vi.mocked(prisma.client.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.client.create).mockResolvedValue({
        id: 'cli-callback',
        name: 'Sammy Smith',
        phone: '+11237272437',
        isCurrentClient: false,
      } as any);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: {
            id: 'call-callback',
            customer: { number: '+19087272437' },
          },
          toolCallList: [{
            id: 'tc-callback',
            function: {
              name: 'generateSummary',
              arguments: {
                callerName: 'Sammy Smith',
                issue: 'I need help with an audit',
              },
            },
          }],
        },
      });

      await POST(req);

      expect(prisma.client.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            phone: '+11237272437',
          }),
        }),
      );
    });

    it('uses shared classification context to save the right legal area when the summary itself is vague', async () => {
      vi.mocked(prisma.lawyer.findMany).mockResolvedValueOnce([
        ...mockLawyers,
        {
          id: 'law-tax',
          name: 'Taylor Tax',
          email: 'tax@test.com',
          phone: '+15551001003',
          specialties: ['tax', 'irs', 'audit'],
          available: true,
          googleCalendarId: null,
          availabilityStart: 9,
          availabilityEnd: 17,
        },
      ] as any);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: { id: 'call-tax-context' },
          toolCallList: [{
            id: 'tc-tax-context',
            function: {
              name: 'generateSummary',
              arguments: {
                callerName: 'Tax Caller',
                callerPhone: '5559990001',
                issue: 'I need help',
                classificationContext: 'IRS or state tax audit. Active lien or levy on bank/wages.',
              },
            },
          }],
        },
      });

      await POST(req);

      expect(prisma.callSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cs-1' },
          data: expect.objectContaining({
            callOutcome: 'summary_queued',
            legalArea: 'tax',
            lawyerId: 'law-tax',
          }),
        }),
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

    it('does not attach a queued summary to a mismatched existing client just because the callback number matches', async () => {
      vi.mocked(prisma.client.findUnique).mockResolvedValue({
        id: 'cli-existing',
        name: 'Sammy Smith',
        phone: '+15559990001',
        email: null,
        isCurrentClient: false,
      } as any);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: { id: 'call-name-mismatch' },
          toolCallList: [{
            id: 'tc-name-mismatch',
            function: {
              name: 'generateSummary',
              arguments: {
                callerName: 'Andy Pham',
                callerPhone: '5559990001',
                issue: 'I am being audited by the IRS',
              },
            },
          }],
        },
      });

      await POST(req);

      expect(prisma.client.create).not.toHaveBeenCalled();
      expect(prisma.callSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cs-1' },
          data: expect.objectContaining({
            clientId: null,
            callOutcome: 'summary_queued',
          }),
        }),
      );
    });

    it('marks summary delivery as unassigned when no lawyer matches the case', async () => {
      vi.mocked(prisma.lawyer.findMany).mockResolvedValueOnce([]);

      const req = makeRequest({
        message: {
          type: 'tool-calls',
          toolCallList: [{
            id: 'tc-18',
            function: {
              name: 'generateSummary',
              arguments: {
                callerName: 'No Lawyer Match',
                callerPhone: '5559990001',
                issue: 'I need help with a maritime dispute',
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(true);
      expect(result.emailDelivered).toBe(false);
      expect(result.deliveryStatus).toBe('no_lawyer_assigned');
      expect(sendCallSummaryEmail).not.toHaveBeenCalled();
      expect(prisma.callSession.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: 'cs-1' },
          data: { callOutcome: 'summary_unassigned' },
        })
      );
    });

    it('rejects a premature personal injury summary before insurance status is collected', async () => {
      const req = makeRequest({
        message: {
          type: 'tool-calls',
          toolCallList: [{
            id: 'tc-19',
            function: {
              name: 'generateSummary',
              arguments: {
                callerName: 'Premature PI',
                callerPhone: '5559990001',
                issue: 'I got in a car accident',
                notes: 'It happened a week ago and I have a broken arm. I am still receiving treatment.',
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(false);
      expect(result.continueIntake).toBe(true);
      expect(result.deliveryStatus).toBe('incomplete_branch');
      expect(result.missingRequirements).toContain('insurance claim or existing representation status');
      expect(sendCallSummaryEmail).not.toHaveBeenCalled();
      expect(prisma.callSession.update).not.toHaveBeenCalled();
      expect(prisma.callSession.create).not.toHaveBeenCalled();
    });

    it('allows a personal injury summary after insurance status is collected', async () => {
      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: { id: 'call-20' },
          toolCallList: [{
            id: 'tc-20',
            function: {
              name: 'generateSummary',
              arguments: {
                callerName: 'Complete PI',
                callerPhone: '5559990001',
                issue: 'I got in a car accident',
                notes: 'It happened a week ago, I broke my arm, I am still in treatment, and no insurance claim has been filed yet.',
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(true);
      expect(result.deliveryStatus).toBe('queued_until_call_end');
      expect(sendCallSummaryEmail).not.toHaveBeenCalled();
    });

    it('allows an active-flow transfer summary to bypass text-only readiness fallback once the runner reached handoff', async () => {
      const req = makeRequest({
        message: {
          type: 'tool-calls',
          call: { id: 'call-20b' },
          toolCallList: [{
            id: 'tc-20b',
            function: {
              name: 'generateSummary',
              arguments: {
                callerName: 'Complete PI',
                callerPhone: '5559990001',
                issue: 'I got injured at work',
                notes: 'Injury Type: Workplace injury / workers comp',
                flowGuaranteedComplete: true,
              },
            },
          }],
        },
      });

      const res = await POST(req);
      const data = await res.json();
      const result = JSON.parse(data.results[0].result);

      expect(result.success).toBe(true);
      expect(result.deliveryStatus).toBe('queued_until_call_end');
      expect(sendCallSummaryEmail).not.toHaveBeenCalled();
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
      expect(prisma.callSession.upsert).toHaveBeenCalledWith(
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
      expect(prisma.callSession.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { callId: 'call-456' },
        })
      );
    });

    it('sends the queued summary email with the real transcript and recording after the call ends', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        assistantName: 'Bobby',
      } as any);
      vi.mocked(prisma.callSession.findUnique)
        .mockResolvedValueOnce({
          id: 'cs-queued',
          callId: 'call-queued',
          notes: 'Caller said they were rear-ended and have ER records.',
          summary: 'Car accident intake',
          callOutcome: 'summary_queued',
        } as any)
        .mockResolvedValueOnce({
          id: 'cs-queued',
          callId: 'call-queued',
          callerPhone: '+15559990001',
          summary: 'Car accident intake',
          notes: 'assistant: Thanks for calling.\nuser: I was rear-ended yesterday.',
          legalArea: 'personal_injury',
          callOutcome: 'summary_queued',
          petitionType: null,
          matterCategory: null,
          partyRole: null,
          urgencyFlag: null,
          client: { name: 'Jane Doe', email: 'jane@test.com' },
          lawyer: { id: 'law-1', name: 'Sarah Chen', email: 'sarah@test.com' },
        } as any)
        .mockResolvedValueOnce({
          id: 'cs-queued',
          callId: 'call-queued',
          callerPhone: '+15559990001',
          summary: 'Car accident intake',
          notes: 'assistant: Thanks for calling.\nuser: I was rear-ended yesterday.',
          legalArea: 'personal_injury',
          callOutcome: 'summary_queued',
          petitionType: null,
          matterCategory: null,
          partyRole: null,
          urgencyFlag: null,
          client: { name: 'Jane Doe', email: 'jane@test.com' },
          lawyer: { id: 'law-1', name: 'Sarah Chen', email: 'sarah@test.com' },
        } as any);

      const req = makeRequest({
        message: {
          type: 'end-of-call-report',
          call: { id: 'call-queued' },
          summary: 'Car accident intake',
          artifact: {
            transcript: [
              { role: 'assistant', content: 'Thanks for calling.' },
              { role: 'user', content: 'I was rear-ended yesterday.' },
            ],
            recording: { stereoUrl: 'https://api.vapi.ai/recordings/call-queued.mp3' },
          },
        },
      });

      await POST(req);

      expect(sendCallSummaryEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          lawyerEmail: 'sarah@test.com',
          assistantName: 'Bobby',
          callerName: 'Jane Doe',
          summary: 'Car accident intake',
          notes: 'Caller said they were rear-ended and have ER records.',
          transcript: 'Bobby: Thanks for calling.\nCaller: I was rear-ended yesterday.',
          recordingUrl: 'https://api.vapi.ai/recordings/call-queued.mp3',
        })
      );
      expect(prisma.callSession.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: 'cs-queued' },
          data: { callOutcome: 'summary_sent' },
        })
      );
    });

    it('uses captured intake state for caller identity when the queued summary has no linked client record', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        assistantName: 'Bobby',
      } as any);
      vi.mocked(prisma.callSession.findUnique)
        .mockResolvedValueOnce({
          id: 'cs-queued-fallback',
          callId: 'call-queued-fallback',
          notes: 'Caller said they were injured at work.',
          summary: 'Work injury intake',
          callOutcome: 'summary_queued',
        } as any)
        .mockResolvedValueOnce({
          id: 'cs-queued-fallback',
          callId: 'call-queued-fallback',
          callerPhone: '+15559990001',
          summary: 'Work injury intake',
          notes: 'assistant: Thanks for calling.\nuser: I was injured at work.',
          legalArea: 'personal_injury',
          callOutcome: 'summary_queued',
          petitionType: null,
          matterCategory: null,
          partyRole: null,
          urgencyFlag: null,
          client: null,
          lawyer: { id: 'law-1', name: 'Sarah Chen', email: 'sarah@test.com' },
        } as any)
        .mockResolvedValueOnce({
          id: 'cs-queued-fallback',
          callId: 'call-queued-fallback',
          callerPhone: '+15559990001',
          summary: 'Work injury intake',
          notes: 'assistant: Thanks for calling.\nuser: I was injured at work.',
          legalArea: 'personal_injury',
          callOutcome: 'summary_queued',
          petitionType: null,
          matterCategory: null,
          partyRole: null,
          urgencyFlag: null,
          client: null,
          lawyer: { id: 'law-1', name: 'Sarah Chen', email: 'sarah@test.com' },
        } as any)
        .mockResolvedValueOnce({
          id: 'cs-queued-fallback',
          callId: 'call-queued-fallback',
          callerPhone: '+15559990001',
          summary: 'Work injury intake',
          notes: 'assistant: Thanks for calling.\nuser: I was injured at work.',
          legalArea: 'personal_injury',
          callOutcome: 'summary_queued',
          petitionType: null,
          matterCategory: null,
          partyRole: null,
          urgencyFlag: null,
          client: null,
          lawyer: { id: 'law-1', name: 'Sarah Chen', email: 'sarah@test.com' },
        } as any);
      vi.mocked(prisma.intakeData.findMany).mockResolvedValueOnce([
        { fieldName: 'callerName', fieldValue: 'John Smith' },
        { fieldName: 'callerEmail', fieldValue: 'john@test.com' },
      ] as any);

      const req = makeRequest({
        message: {
          type: 'end-of-call-report',
          call: { id: 'call-queued-fallback', customer: { number: '+15559990001' } },
          summary: 'Work injury intake',
          artifact: {
            transcript: [
              { role: 'assistant', content: 'Thanks for calling.' },
              { role: 'user', content: 'I was injured at work.' },
            ],
          },
        },
      });

      await POST(req);

      expect(sendCallSummaryEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          assistantName: 'Bobby',
          callerName: 'John Smith',
          callerEmail: 'john@test.com',
        })
      );
    });

    it('prefers the latest flow-captured name and callback number in the summary email while still including the call-origin number', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        assistantName: 'Bobby',
      } as any);
      vi.mocked(prisma.callSession.findUnique)
        .mockResolvedValueOnce({
          id: 'cs-queued-latest',
          callId: 'call-queued-latest',
          notes: 'Caller is going through a divorce.',
          summary: 'Divorce intake',
          callOutcome: 'summary_queued',
        } as any)
        .mockResolvedValueOnce({
          id: 'cs-queued-latest',
          callId: 'call-queued-latest',
          callerPhone: '+19087272437',
          summary: 'Divorce intake',
          notes: 'assistant: Thanks for calling.\nuser: I am going through a divorce.',
          legalArea: 'family',
          callOutcome: 'summary_queued',
          petitionType: null,
          matterCategory: null,
          partyRole: null,
          urgencyFlag: null,
          client: { name: 'Old Client Name', phone: '+19087272437', email: null },
          lawyer: { id: 'law-1', name: 'Sarah Chen', email: 'sarah@test.com' },
        } as any)
        .mockResolvedValueOnce({
          id: 'cs-queued-latest',
          callId: 'call-queued-latest',
          callerPhone: '+19087272437',
          summary: 'Divorce intake',
          notes: 'assistant: Thanks for calling.\nuser: I am going through a divorce.',
          legalArea: 'family',
          callOutcome: 'summary_queued',
          petitionType: null,
          matterCategory: null,
          partyRole: null,
          urgencyFlag: null,
          client: { name: 'Old Client Name', phone: '+19087272437', email: null },
          lawyer: { id: 'law-1', name: 'Sarah Chen', email: 'sarah@test.com' },
        } as any);
      vi.mocked(prisma.intakeData.findMany).mockResolvedValueOnce([
        { fieldName: 'caller_name', fieldValue: 'Ten Sam' },
        { fieldName: 'callback_phone', fieldValue: '+11237272437' },
        { fieldName: 'call_origin_phone', fieldValue: '+19087272437' },
      ] as any);

      const req = makeRequest({
        message: {
          type: 'end-of-call-report',
          call: { id: 'call-queued-latest', customer: { number: '+19087272437' } },
          summary: 'Divorce intake',
          artifact: {
            transcript: [
              { role: 'assistant', content: 'Thanks for calling.' },
              { role: 'user', content: 'I am going through a divorce.' },
            ],
          },
        },
      });

      await POST(req);

      expect(sendCallSummaryEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          assistantName: 'Bobby',
          callerName: 'Ten Sam',
          callerPhone: '+11237272437',
          callOriginPhone: '+19087272437',
        }),
      );
    });

    it('includes the configured backup summary recipient when sending queued summaries', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        assistantName: 'Bobby',
      } as any);
      vi.mocked(prisma.intakeFlow.findUnique).mockResolvedValueOnce({
        user: { backupSummaryEmail: 'backup@test.com' },
      } as any);
      vi.mocked(prisma.callSession.findUnique)
        .mockResolvedValueOnce({
          id: 'cs-queued-backup',
          callId: 'call-queued-backup',
          notes: 'Caller needs help with probate.',
          summary: 'Probate intake',
          callOutcome: 'summary_queued',
        } as any)
        .mockResolvedValueOnce({
          id: 'cs-queued-backup',
          callId: 'call-queued-backup',
          callerPhone: '+15559990001',
          summary: 'Probate intake',
          notes: 'assistant: Thanks for calling.\nuser: I need help with probate.',
          legalArea: 'estate',
          callOutcome: 'summary_queued',
          petitionType: null,
          matterCategory: null,
          partyRole: null,
          urgencyFlag: null,
          intakeFlowId: 'flow-backup',
          client: { name: 'Jane Doe', email: 'jane@test.com' },
          lawyer: { id: 'law-1', name: 'Sarah Chen', email: 'sarah@test.com' },
        } as any)
        .mockResolvedValueOnce({
          id: 'cs-queued-backup',
          callId: 'call-queued-backup',
          callerPhone: '+15559990001',
          summary: 'Probate intake',
          notes: 'assistant: Thanks for calling.\nuser: I need help with probate.',
          legalArea: 'estate',
          callOutcome: 'summary_queued',
          petitionType: null,
          matterCategory: null,
          partyRole: null,
          urgencyFlag: null,
          intakeFlowId: 'flow-backup',
          client: { name: 'Jane Doe', email: 'jane@test.com' },
          lawyer: { id: 'law-1', name: 'Sarah Chen', email: 'sarah@test.com' },
        } as any);

      const req = makeRequest({
        message: {
          type: 'end-of-call-report',
          call: { id: 'call-queued-backup' },
          summary: 'Probate intake',
          artifact: {
            transcript: [
              { role: 'assistant', content: 'Thanks for calling.' },
              { role: 'user', content: 'I need help with probate.' },
            ],
          },
        },
      });

      await POST(req);

      expect(sendCallSummaryEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          lawyerEmail: 'sarah@test.com',
          backupEmail: 'backup@test.com',
        })
      );
    });

    it('includes additional internal summary recipients when configured', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        assistantName: 'Bobby',
      } as any);
      vi.mocked(prisma.intakeFlow.findUnique).mockResolvedValueOnce({
        user: {
          backupSummaryEmail: 'backup@test.com',
          additionalSummaryEmails: ['ops@test.com', 'paralegal@test.com'],
        },
      } as any);
      vi.mocked(prisma.callSession.findUnique)
        .mockResolvedValueOnce({
          id: 'cs-queued-extra-recipients',
          callId: 'call-queued-extra-recipients',
          notes: 'Caller needs help with probate.',
          summary: 'Probate intake',
          callOutcome: 'summary_queued',
        } as any)
        .mockResolvedValueOnce({
          id: 'cs-queued-extra-recipients',
          callId: 'call-queued-extra-recipients',
          callerPhone: '+15559990001',
          summary: 'Probate intake',
          notes: 'assistant: Thanks for calling.\nuser: I need help with probate.',
          legalArea: 'estate',
          callOutcome: 'summary_queued',
          petitionType: null,
          matterCategory: null,
          partyRole: null,
          urgencyFlag: null,
          intakeFlowId: 'flow-extra-recipients',
          client: { name: 'Jane Doe', email: 'jane@test.com' },
          lawyer: { id: 'law-1', name: 'Sarah Chen', email: 'sarah@test.com' },
        } as any)
        .mockResolvedValueOnce({
          id: 'cs-queued-extra-recipients',
          callId: 'call-queued-extra-recipients',
          callerPhone: '+15559990001',
          summary: 'Probate intake',
          notes: 'assistant: Thanks for calling.\nuser: I need help with probate.',
          legalArea: 'estate',
          callOutcome: 'summary_queued',
          petitionType: null,
          matterCategory: null,
          partyRole: null,
          urgencyFlag: null,
          intakeFlowId: 'flow-extra-recipients',
          client: { name: 'Jane Doe', email: 'jane@test.com' },
          lawyer: { id: 'law-1', name: 'Sarah Chen', email: 'sarah@test.com' },
        } as any);

      const req = makeRequest({
        message: {
          type: 'end-of-call-report',
          call: { id: 'call-queued-extra-recipients' },
          summary: 'Probate intake',
          artifact: {
            transcript: [
              { role: 'assistant', content: 'Thanks for calling.' },
              { role: 'user', content: 'I need help with probate.' },
            ],
          },
        },
      });

      await POST(req);

      expect(sendCallSummaryEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          lawyerEmail: 'sarah@test.com',
          backupEmail: 'backup@test.com',
          additionalEmails: ['ops@test.com', 'paralegal@test.com'],
        })
      );
    });

    it('picks up artifact.recordingUrl when the recording object is not present', async () => {
      vi.mocked(prisma.callSession.findUnique)
        .mockResolvedValueOnce({
          id: 'cs-queued',
          callId: 'call-queued-2',
          notes: 'Caller said they were rear-ended and have ER records.',
          summary: 'Car accident intake',
          callOutcome: 'summary_queued',
        } as any)
        .mockResolvedValueOnce({
          id: 'cs-queued',
          callId: 'call-queued-2',
          callerPhone: '+15559990001',
          summary: 'Car accident intake',
          notes: 'assistant: Thanks for calling.\nuser: I was rear-ended yesterday.',
          legalArea: 'personal_injury',
          callOutcome: 'summary_queued',
          petitionType: null,
          matterCategory: null,
          partyRole: null,
          urgencyFlag: null,
          client: { name: 'Jane Doe', email: 'jane@test.com' },
          lawyer: { id: 'law-1', name: 'Sarah Chen', email: 'sarah@test.com' },
        } as any)
        .mockResolvedValueOnce({
          id: 'cs-queued',
          callId: 'call-queued-2',
          callerPhone: '+15559990001',
          summary: 'Car accident intake',
          notes: 'assistant: Thanks for calling.\nuser: I was rear-ended yesterday.',
          legalArea: 'personal_injury',
          callOutcome: 'summary_queued',
          petitionType: null,
          matterCategory: null,
          partyRole: null,
          urgencyFlag: null,
          client: { name: 'Jane Doe', email: 'jane@test.com' },
          lawyer: { id: 'law-1', name: 'Sarah Chen', email: 'sarah@test.com' },
        } as any);

      const req = makeRequest({
        message: {
          type: 'end-of-call-report',
          call: { id: 'call-queued-2' },
          summary: 'Car accident intake',
          artifact: {
            transcript: [
              { role: 'assistant', content: 'Thanks for calling.' },
              { role: 'user', content: 'I was rear-ended yesterday.' },
            ],
            recordingUrl: 'https://storage.vapi.ai/call-queued-2-mono.wav',
          },
        },
      });

      await POST(req);

      expect(sendCallSummaryEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          callId: 'call-queued-2',
          recordingUrl: 'https://storage.vapi.ai/call-queued-2-mono.wav',
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
      expect(prisma.callSession.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { callId: 'call-789' },
        })
      );
    });

    it('recovers a missed summary email from the end-of-call report when the branch is complete', async () => {
      vi.mocked(prisma.intakeFlow.findUnique).mockResolvedValue(generalFlow);
      vi.mocked(prisma.callSession.findUnique)
        .mockResolvedValueOnce({
          id: 'cs-missed',
          callId: 'call-missed',
          callOutcome: 'general_inquiry',
          intakeFlowId: 'flow-general',
          notes: null,
          summary: null,
        } as any)
        .mockResolvedValueOnce({
          id: 'cs-missed',
          callId: 'call-missed',
          callOutcome: 'general_inquiry',
          intakeFlowId: 'flow-general',
          notes: null,
          summary: null,
        } as any)
        .mockResolvedValueOnce({
          id: 'cs-missed',
          callId: 'call-missed',
          callerPhone: '+15559990001',
          summary: 'Caller needs help with a contested divorce focused on child custody.',
          notes: 'assistant: Thanks for calling.\nuser: I need help with a contested divorce focused on child custody.',
          legalArea: 'family',
          callOutcome: 'general_inquiry',
          petitionType: null,
          matterCategory: null,
          partyRole: null,
          urgencyFlag: null,
          intakeFlowId: 'flow-general',
          client: null,
          lawyer: null,
        } as any)
        .mockResolvedValueOnce({
          id: 'cs-missed',
          callId: 'call-missed',
          callerPhone: '+15559990001',
          summary: 'Caller needs help with a contested divorce focused on child custody.',
          notes: 'assistant: Thanks for calling.\nuser: I need help with a contested divorce focused on child custody.',
          legalArea: 'family',
          callOutcome: 'summary_queued',
          petitionType: null,
          matterCategory: null,
          partyRole: null,
          urgencyFlag: null,
          client: null,
          lawyer: { id: 'law-1', name: 'Sarah Chen', email: 'sarah@test.com' },
        } as any);

      const req = makeRequest({
        message: {
          type: 'end-of-call-report',
          call: { id: 'call-missed' },
          summary: 'Caller needs help with a contested divorce focused on child custody.',
          transcript: [
            'assistant: Thanks for calling.',
            'user: First time calling.',
            'assistant: Is the number you are calling from the best number to reach you if we get disconnected?',
            'user: Yes, this number is fine.',
            'assistant: Are you calling for yourself or on behalf of someone else?',
            'user: For myself.',
            'assistant: Divorce or legal separation.',
            'user: Contested - we disagree on key issues.',
            'assistant: Child custody and support.',
            'user: Nothing filed yet.',
            'assistant: Are there minor children involved in this matter?',
            'user: Yes - minor children are involved.',
            'assistant: Does your spouse or partner already have a lawyer?',
            'user: No - the other side does not have a lawyer.',
            'assistant: Is there anything urgent right now?',
            'user: No - no immediate urgency.',
          ].join('\n'),
        },
      });

      await POST(req);

      expect(prisma.callSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cs-missed' },
          data: expect.objectContaining({
            callOutcome: 'summary_queued',
            legalArea: 'family',
            lawyerId: 'law-1',
          }),
        })
      );
      expect(sendCallSummaryEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          lawyerEmail: 'sarah@test.com',
          summary: 'Caller needs help with a contested divorce focused on child custody.',
          transcript: expect.stringContaining('Divorce or legal separation.'),
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

    it('accepts assistant speech lifecycle events for startup diagnostics', async () => {
      const req = makeRequest({
        message: {
          type: 'assistant.speechStarted',
          call: { id: 'call-speech-start-1' },
          text: 'Thank you for calling our law firm.',
          turn: 0,
          source: 'force-say',
        },
      });
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
