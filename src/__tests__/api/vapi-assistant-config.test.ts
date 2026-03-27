import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/webhooks/vapi/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
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
    vi.mocked(prisma.lawyer.findMany).mockResolvedValue([
      { id: 'l1', name: 'Sarah Chen', email: 's@t.com', phone: '+15551001001', specialties: ['family'], available: true, googleCalendarId: null },
    ] as any);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://ai-paralegal-andyp4293s-projects.vercel.app');
    vi.stubEnv('TRANSFER_PHONE_NUMBER', '+15559999999');
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
    expect(prompt).toContain('TRANSFER');
    expect(prompt).toContain('empathetic');
  });

  it('assistant has all tool definitions', async () => {
    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const { assistant } = await res.json();
    const toolNames = assistant.model.tools.filter((t: any) => t.function).map((t: any) => t.function.name);
    expect(toolNames).toContain('checkClient');
    expect(toolNames).toContain('identifyLawyer');
    expect(toolNames).toContain('scheduleConsultation');
    expect(toolNames).toContain('generateSummary');
    expect(toolNames).toContain('generateTransferSummary');
    expect(toolNames).toContain('checkAttorneyAvailability');
    expect(assistant.model.tools).toHaveLength(7); // 6 function tools + endCall
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
    expect(assistant.transcriber.model).toBe('nova-2');
    expect(assistant.transcriber.language).toBe('en');
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

  it('assistant has forwarding phone number when configured', async () => {
    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const { assistant } = await res.json();
    expect(assistant.forwardingPhoneNumber).toBe('+15559999999');
  });

  it('assistant omits forwarding number when not configured', async () => {
    vi.stubEnv('TRANSFER_PHONE_NUMBER', '');
    const req = makeRequest({ message: { type: 'assistant-request' } });
    const res = await POST(req);
    const { assistant } = await res.json();
    expect(assistant.forwardingPhoneNumber).toBeUndefined();
  });
});
