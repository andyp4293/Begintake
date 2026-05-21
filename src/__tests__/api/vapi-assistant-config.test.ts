import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/webhooks/vapi/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    intakeFlow: { findFirst: vi.fn() },
    intakeData: { findMany: vi.fn(), createMany: vi.fn() },
    lawyer: { findMany: vi.fn(), findUnique: vi.fn() },
    client: { findUnique: vi.fn(), create: vi.fn() },
    callSession: { create: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    appointment: { create: vi.fn() },
    user: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/google-calendar', () => ({
  createCalendarEvent: vi.fn().mockResolvedValue('gcal-123'),
}));

vi.mock('@/lib/email', () => ({
  sendCallSummaryEmail: vi.fn().mockResolvedValue({ success: true }),
}));

import { prisma } from '@/lib/prisma';

function makeRequest(body: any) {
  return new NextRequest('http://localhost:3000/api/webhooks/vapi', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('VAPI Assistant Config (thorough)', () => {
  beforeEach(() => {
    vi.mocked(prisma.intakeFlow.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.lawyer.findMany).mockResolvedValue([
      { id: 'l1', name: 'Sarah Chen', email: 's@t.com', phone: '+15551001001', specialties: ['family'], available: true, googleCalendarId: null },
    ] as any);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://ai-paralegal-andyp4293s-projects.vercel.app');
    vi.stubEnv('TRANSFER_PHONE_NUMBER', '+15559999999');
    vi.stubEnv('ENABLE_LIVE_CALL_TRANSFERS', '');
  });

  it('returns assistant object at top level', async () => {
    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const data = await res.json();
    expect(data).toHaveProperty('assistant');
    expect(typeof data.assistant).toBe('object');
  });

  it('assistant has name field', async () => {
    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const { assistant } = await res.json();
    expect(assistant.name).toBeDefined();
    expect(typeof assistant.name).toBe('string');
  });

  it('assistant has firstMessage', async () => {
    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const { assistant } = await res.json();
    expect(assistant.firstMessage).toBeDefined();
    expect(assistant.firstMessage.length).toBeGreaterThan(0);
  });

  it('assistant has model with provider and model name', async () => {
    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const { assistant } = await res.json();
    expect(assistant.model.provider).toBe('openai');
    expect(assistant.model.model).toBeDefined();
  });

  it('assistant has model with temperature', async () => {
    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const { assistant } = await res.json();
    expect(assistant.model.temperature).toBeDefined();
    expect(typeof assistant.model.temperature).toBe('number');
  });

  it('assistant has system message in model.messages', async () => {
    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const { assistant } = await res.json();
    expect(assistant.model.messages).toHaveLength(1);
    expect(assistant.model.messages[0].role).toBe('system');
    expect(assistant.model.messages[0].content.length).toBeGreaterThan(100);
  });

  it('system prompt contains lawyer names', async () => {
    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const { assistant } = await res.json();
    expect(assistant.model.messages[0].content).toContain('Sarah Chen');
  });

  it('system prompt contains call flow instructions', async () => {
    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const { assistant } = await res.json();
    const prompt = assistant.model.messages[0].content;
    expect(prompt).toContain('CURRENT CLIENT');
    expect(prompt).toContain('PROSPECTIVE CLIENT');
    expect(prompt).toContain('REQUESTS FOR A REAL PERSON');
    expect(prompt).toContain('empathetic');
    expect(prompt).toContain('Call tools silently');
    expect(prompt).toContain('silently call captureIntakeState');
    expect(prompt).toContain('Do NOT add filler like "one moment"');
    expect(prompt).toContain('The live transfer itself will say exactly: "Welcome back. We\'ll transfer you to our team right away."');
    expect(prompt).toContain('Continue the normal intake flow. Do NOT transfer them to the paralegal just because they are new.');
    expect(prompt).toContain('If the caller volunteers answers to later intake questions early, capture those facts immediately and skip the later duplicate questions instead of re-asking them.');
    expect(prompt).toContain('If one caller response answers multiple intake slots at once, treat every clearly answered slot as captured and move to the first still-unanswered question.');
  });

  it('dedupes the first spoken message when the next question repeats the greeting ending', async () => {
    vi.mocked(prisma.intakeFlow.findFirst).mockResolvedValue({
      id: 'flow-1',
      name: 'Test Flow',
      description: null,
      nodes: [
        {
          id: 'start-1',
          type: 'start',
          label: 'Opening Greeting',
          sortOrder: 0,
          config: {
            greeting: "Thank you for calling {firm}. I am the AI assistant, {name}, and I'll ask you a few questions to figure out how we can best help you. You may request to get transferred to a paralegal at any time. Shall we get started?",
          },
        },
        {
          id: 'q-1',
          type: 'question',
          label: 'Q1. Shall we get started?',
          sortOrder: 1,
          config: {
            question: 'Shall we get started?',
          },
        },
      ],
      edges: [
        { id: 'e-1', sourceNodeId: 'start-1', targetNodeId: 'q-1', label: null, condition: null, sortOrder: 0 },
      ],
    } as any);

    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const { assistant } = await res.json();
    expect(assistant.firstMessage).toBe("Thank you for calling our law firm. I am the AI assistant, Aria, and I'll ask you a few questions to figure out how we can best help you. You may request to get transferred to a paralegal at any time. Shall we get started?");
  });

  it('includes the next question in the first spoken message for active flows', async () => {
    vi.mocked(prisma.intakeFlow.findFirst).mockResolvedValue({
      id: 'flow-2',
      name: 'Test Flow With Name Question',
      description: null,
      nodes: [
        {
          id: 'start-1',
          type: 'start',
          label: 'Opening Greeting',
          sortOrder: 0,
          config: {
            greeting: "Thank you for calling {firm}. I am the AI assistant, {name}, and I'll ask you a few questions to figure out how we can best help you. You may request to get transferred to a paralegal at any time.",
          },
        },
        {
          id: 'q-1',
          type: 'question',
          label: 'Q1. Caller Name',
          sortOrder: 1,
          config: {
            question: 'Could I start with your first and last name?',
          },
        },
      ],
      edges: [
        { id: 'e-1', sourceNodeId: 'start-1', targetNodeId: 'q-1', label: null, condition: null, sortOrder: 0 },
      ],
    } as any);

    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const { assistant } = await res.json();
    expect(assistant.firstMessage).toBe("Thank you for calling our law firm. I am the AI assistant, Aria, and I'll ask you a few questions to figure out how we can best help you. You may request to get transferred to a paralegal at any time. Could I start with your first and last name?");
  });

  it('assistant has all tool definitions', async () => {
    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const { assistant } = await res.json();
    const toolNames = assistant.model.tools.filter((t: any) => t.function).map((t: any) => t.function.name);
    expect(toolNames).toContain('captureIntakeState');
    expect(toolNames).toContain('advanceActiveFlow');
    expect(toolNames).toContain('checkClient');
    expect(toolNames).toContain('identifyLawyer');
    expect(toolNames).toContain('scheduleConsultation');
    expect(toolNames).toContain('generateSummary');
    expect(toolNames).toContain('generateTransferSummary');
    expect(toolNames).toContain('checkAttorneyAvailability');
    expect(assistant.model.tools).toHaveLength(9); // 8 function tools + endCall
  });

  it('each function tool has type, function.name, function.description, function.parameters', async () => {
    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const { assistant } = await res.json();
    const functionTools = assistant.model.tools.filter((t: any) => t.type === 'function');
    for (const tool of functionTools) {
      expect(tool.function.name).toBeDefined();
      expect(tool.function.description).toBeDefined();
      expect(tool.function.parameters).toBeDefined();
      expect(tool.function.parameters.type).toBe('object');
    }
    // Also has endCall tool
    expect(assistant.model.tools.some((t: any) => t.type === 'endCall')).toBe(true);
  });

  it('assistant has voice config with provider and voiceId', async () => {
    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const { assistant } = await res.json();
    expect(assistant.voice.provider).toBe('11labs');
    expect(assistant.voice.voiceId).toBeDefined();
    expect(assistant.voice.stability).toBeDefined();
    expect(assistant.voice.similarityBoost).toBeDefined();
  });

  it('assistant has transcriber config', async () => {
    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const { assistant } = await res.json();
    expect(assistant.transcriber.provider).toBe('deepgram');
    expect(assistant.transcriber.model).toBe('flux-general-en');
    expect(assistant.transcriber.language).toBe('en');
    expect(assistant.transcriber.smartFormat).toBe(true);
    expect(assistant.transcriber.eotThreshold).toBe(0.7);
    expect(assistant.transcriber.eotTimeoutMs).toBe(5000);
    expect(assistant.backgroundSpeechDenoisingPlan).toEqual({
      smartDenoisingPlan: { enabled: true },
    });
  });

  it('assistant has server URL pointing to webhook', async () => {
    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const { assistant } = await res.json();
    expect(assistant.server.url).toBe(
      'https://ai-paralegal-andyp4293s-projects.vercel.app/api/webhooks/vapi'
    );
  });

  it('assistant has speaking plan configs', async () => {
    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const { assistant } = await res.json();
    expect(assistant.startSpeakingPlan).toBeDefined();
    expect(assistant.stopSpeakingPlan).toBeDefined();
    expect(assistant.silenceTimeoutSeconds).toBeGreaterThan(0);
  });

  it('assistant has voicemail detection', async () => {
    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const { assistant } = await res.json();
    expect(assistant.voicemailDetection).toBeDefined();
    expect(assistant.voicemailMessage).toBeDefined();
  });

  it('assistant omits forwarding number by default even when a transfer number exists', async () => {
    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const { assistant } = await res.json();
    expect(assistant.forwardingPhoneNumber).toBeUndefined();
  });

  it('assistant includes forwarding number when live transfers are enabled', async () => {
    vi.stubEnv('ENABLE_LIVE_CALL_TRANSFERS', 'true');
    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const { assistant } = await res.json();
    expect(assistant.forwardingPhoneNumber).toBe('+15559999999');
  });

  it('assistant omits forwarding number when not configured', async () => {
    vi.stubEnv('TRANSFER_PHONE_NUMBER', '');
    vi.stubEnv('ENABLE_LIVE_CALL_TRANSFERS', 'true');
    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const { assistant } = await res.json();
    expect(assistant.forwardingPhoneNumber).toBeUndefined();
  });
});
