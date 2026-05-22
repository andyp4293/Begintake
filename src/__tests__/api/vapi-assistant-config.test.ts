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

async function getAssistant(body: any) {
  const req = makeRequest(body);
  const res = await POST(req);
  const data = await res.json();
  return data.assistant;
}

async function getWarmedAssistant(body: any) {
  await getAssistant(body);
  await waitForAssistantRequestCache(body);
  return getAssistant(body);
}

describe('VAPI Assistant Config (thorough)', () => {
  beforeEach(() => {
    ((globalThis as any).assistantRequestContextCache as Map<string, unknown> | undefined)?.clear();
    vi.mocked(prisma.intakeFlow.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.lawyer.findMany).mockResolvedValue([
      { id: 'l1', name: 'Sarah Chen', email: 's@t.com', phone: '+15551001001', specialties: ['family'], available: true, googleCalendarId: null },
    ] as any);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as any);
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://ai-paralegal-andyp4293s-projects.vercel.app');
    vi.stubEnv('TRANSFER_PHONE_NUMBER', '+15559999999');
    vi.stubEnv('ENABLE_LIVE_CALL_TRANSFERS', '');
  });

  it('returns assistant object at top level', async () => {
    const data = { assistant: await getAssistant({ message: { type: 'assistant-request' } }) };
    expect(data).toHaveProperty('assistant');
    expect(typeof data.assistant).toBe('object');
  });

  it('assistant has name field', async () => {
    const assistant = await getAssistant({ message: { type: 'assistant-request' } });
    expect(assistant.name).toBeDefined();
    expect(typeof assistant.name).toBe('string');
  });

  it('assistant has firstMessage', async () => {
    const assistant = await getAssistant({ message: { type: 'assistant-request' } });
    expect(assistant.firstMessage).toBeDefined();
    expect(assistant.firstMessage.length).toBeGreaterThan(0);
  });

  it('assistant has model with provider and model name', async () => {
    const assistant = await getAssistant({ message: { type: 'assistant-request' } });
    expect(assistant.model.provider).toBe('openai');
    expect(assistant.model.model).toBeDefined();
  });

  it('assistant has model with temperature', async () => {
    const assistant = await getAssistant({ message: { type: 'assistant-request' } });
    expect(assistant.model.temperature).toBe(0);
  });

  it('assistant has system message in model.messages', async () => {
    const assistant = await getAssistant({ message: { type: 'assistant-request' } });
    expect(assistant.model.messages).toHaveLength(1);
    expect(assistant.model.messages[0].role).toBe('system');
    expect(assistant.model.messages[0].content.length).toBeGreaterThan(100);
  });

  it('system prompt contains lawyer names', async () => {
    const assistant = await getWarmedAssistant({ message: { type: 'assistant-request' } });
    expect(assistant.model.messages[0].content).toContain('Sarah Chen');
  });

  it('system prompt contains call flow instructions', async () => {
    const assistant = await getWarmedAssistant({ message: { type: 'assistant-request' } });
    const prompt = assistant.model.messages[0].content;
    expect(prompt).toContain('CURRENT CLIENT');
    expect(prompt).toContain('PROSPECTIVE CLIENT');
    expect(prompt).toContain('REQUESTS FOR A REAL PERSON');
    expect(prompt).toContain('ABSOLUTE RULE: never say filler phrases');
    expect(prompt).toContain('empathetic');
    expect(prompt).toContain('sound like a calm human receptionist');
    expect(prompt).toContain('do not know legal procedure');
    expect(prompt).toContain('plain-English follow-up');
    expect(prompt).toContain('Call tools silently');
    expect(prompt).toContain('silently call captureIntakeState');
    expect(prompt).toContain('Do NOT add filler like "one moment"');
    expect(prompt).toContain('The live transfer itself will say exactly: "Of course. I\'ll transfer you to our team right away."');
    expect(prompt).toContain('Continue the normal intake flow. Do NOT transfer them to the paralegal just because they are new.');
    expect(prompt).toContain('immediately call generateTransferSummary with transferTarget="paralegal" and handoffMode="live_transfer"');
    expect(prompt).toContain('After the summary stage, do NOT offer or attempt a live paralegal transfer.');
    expect(prompt).toContain('If the caller clearly wants a real person, live staff member, or someone on the team during the intake');
    expect(prompt).toContain('If the caller volunteers answers to later intake questions early, capture those facts immediately and skip the later duplicate questions instead of re-asking them.');
    expect(prompt).toContain('If one caller response answers multiple intake slots at once, treat every clearly answered slot as captured and move to the first still-unanswered question.');
    expect(prompt).toContain('If the caller gives a plausible direct answer to the current question');
    expect(prompt).toContain('If the caller sounds confused about legal labels or choices, explain the difference in plain English');
    expect(prompt).toContain('If the caller is clearly trying to reach a non-legal business or service that does not fit a law firm at all');
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

    const assistant = await getWarmedAssistant({ message: { type: 'assistant-request' } });
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

    const assistant = await getWarmedAssistant({ message: { type: 'assistant-request' } });
    expect(assistant.firstMessage).toBe("Thank you for calling our law firm. I am the AI assistant, Aria, and I'll ask you a few questions to figure out how we can best help you. You may request to get transferred to a paralegal at any time. Could I start with your first and last name?");
  });

  it('keeps the standalone get-started gate as the first spoken question', async () => {
    vi.mocked(prisma.intakeFlow.findFirst).mockResolvedValue({
      id: 'flow-2b',
      name: 'Test Flow With Get Started',
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
          label: 'Q1. Shall we get started?',
          sortOrder: 1,
          config: {
            question: 'Shall we get started?',
          },
        },
        {
          id: 'r-yes',
          type: 'response',
          label: 'Yes, let’s begin',
          sortOrder: 2,
          config: {
            response: "Yes, let's begin",
          },
        },
        {
          id: 'q-2',
          type: 'question',
          label: 'Q1b. New or Existing Client?',
          sortOrder: 3,
          config: {
            question: 'Have you worked with our firm before, or is this your first time reaching out to us?',
          },
        },
      ],
      edges: [
        { id: 'e-1', sourceNodeId: 'start-1', targetNodeId: 'q-1', label: null, condition: null, sortOrder: 0 },
        { id: 'e-2', sourceNodeId: 'q-1', targetNodeId: 'r-yes', label: "Yes, let's begin", condition: null, sortOrder: 0 },
        { id: 'e-3', sourceNodeId: 'r-yes', targetNodeId: 'q-2', label: null, condition: null, sortOrder: 0 },
      ],
    } as any);

    const assistant = await getWarmedAssistant({ message: { type: 'assistant-request' } });
    expect(assistant.firstMessage).toBe("Thank you for calling our law firm. I am the AI assistant, Aria, and I'll ask you a few questions to figure out how we can best help you. You may request to get transferred to a paralegal at any time. Shall we get started?");
  });

  it('omits captureIntakeState from active-flow assistants so the runner owns slot capture', async () => {
    vi.mocked(prisma.intakeFlow.findFirst).mockResolvedValue({
      id: 'flow-3',
      name: 'Active Flow',
      description: null,
      nodes: [
        {
          id: 'start-1',
          type: 'start',
          label: 'Opening Greeting',
          sortOrder: 0,
          config: { greeting: 'Thank you for calling {firm}.' },
        },
        {
          id: 'q-1',
          type: 'question',
          label: 'Q1. Starter',
          sortOrder: 1,
          config: { question: 'Shall we get started?' },
        },
      ],
      edges: [
        { id: 'e-1', sourceNodeId: 'start-1', targetNodeId: 'q-1', label: null, condition: null, sortOrder: 0 },
      ],
    } as any);

    const assistant = await getWarmedAssistant({ message: { type: 'assistant-request' } });
    const prompt = assistant.model.messages[0].content;
    const toolNames = assistant.model.tools.filter((t: any) => t.function).map((t: any) => t.function.name);
    const advanceTool = assistant.model.tools.find((t: any) => t.function?.name === 'advanceActiveFlow');

    expect(prompt).toContain('do NOT call captureIntakeState');
    expect(prompt).toContain('include matchedChoiceLabel');
    expect(prompt).toContain('include those in semanticFacts');
    expect(prompt).toContain('semanticFacts.answerIntent');
    expect(prompt).toContain('semanticFacts.questionState');
    expect(prompt).toContain('semanticFacts.conversationFit');
    expect(prompt).toContain('semanticFacts.requestHuman');
    expect(prompt).toContain('semanticFacts.postCallIntent');
    expect(prompt).toContain('If the caller gives a vague, noisy, or non-routable answer to the open-ended issue question');
    expect(toolNames).not.toContain('captureIntakeState');
    expect(toolNames).toContain('advanceActiveFlow');
    expect(advanceTool.function.parameters.properties.matchedChoiceLabel).toBeDefined();
    expect(advanceTool.function.parameters.properties.semanticFacts).toBeDefined();
    expect(advanceTool.function.parameters.properties.semanticFacts.properties.answerIntent).toBeDefined();
    expect(advanceTool.function.parameters.properties.semanticFacts.properties.questionState).toBeDefined();
    expect(advanceTool.function.parameters.properties.semanticFacts.properties.conversationFit).toBeDefined();
    expect(advanceTool.function.parameters.properties.semanticFacts.properties.requestHuman).toBeDefined();
    expect(advanceTool.function.parameters.properties.semanticFacts.properties.postCallIntent).toBeDefined();
  });

  it('assistant has all tool definitions', async () => {
    const assistant = await getWarmedAssistant({ message: { type: 'assistant-request' } });
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
    const assistant = await getWarmedAssistant({ message: { type: 'assistant-request' } });
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

  it('makes function tools silent at the Vapi layer', async () => {
    const assistant = await getAssistant({ message: { type: 'assistant-request' } });
    const functionTools = assistant.model.tools.filter((t: any) => t.type === 'function');

    for (const tool of functionTools) {
      expect(tool.messages).toEqual([
        { type: 'request-start', content: '' },
        { type: 'request-response-delayed', content: '' },
      ]);
    }
  });

  it('assistant has voice config with provider and voiceId', async () => {
    const assistant = await getAssistant({ message: { type: 'assistant-request' } });
    expect(assistant.voice.provider).toBe('11labs');
    expect(assistant.voice.voiceId).toBeDefined();
    expect(assistant.voice.stability).toBe(0.62);
    expect(assistant.voice.similarityBoost).toBe(0.68);
    expect(assistant.backgroundSound).toBe('office');
  });

  it('does not send the invalid transient messagePlan field', async () => {
    const assistant = await getAssistant({ message: { type: 'assistant-request' } });
    expect(assistant.messagePlan).toBeUndefined();
    expect(assistant.model.fillerInjectionPlan).toBeUndefined();
  });

  it('assistant has transcriber config', async () => {
    const assistant = await getAssistant({ message: { type: 'assistant-request' } });
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
    const assistant = await getAssistant({ message: { type: 'assistant-request' } });
    expect(assistant.server.url).toBe(
      'https://ai-paralegal-andyp4293s-projects.vercel.app/api/webhooks/vapi'
    );
  });

  it('assistant has speaking plan configs', async () => {
    const assistant = await getAssistant({ message: { type: 'assistant-request' } });
    expect(assistant.startSpeakingPlan).toBeDefined();
    expect(assistant.stopSpeakingPlan).toBeDefined();
    expect(assistant.silenceTimeoutSeconds).toBeGreaterThan(0);
  });

  it('assistant has idle re-engagement hooks so the caller does not sit in dead air', async () => {
    const assistant = await getAssistant({ message: { type: 'assistant-request' } });

    expect(assistant.hooks).toEqual([
      {
        on: 'customer.speech.timeout',
        options: {
          timeoutSeconds: 5,
          triggerMaxCount: 1,
          triggerResetMode: 'onUserSpeech',
        },
        do: [
          {
            type: 'say',
            exact: "I'm still here whenever you're ready.",
          },
        ],
        name: 'customer_silence_reengage_fast',
      },
      {
        on: 'customer.speech.timeout',
        options: {
          timeoutSeconds: 12,
          triggerMaxCount: 1,
          triggerResetMode: 'onUserSpeech',
        },
        do: [
          {
            type: 'say',
            exact: 'If you can hear me, go ahead and say anything and we can keep going.',
          },
        ],
        name: 'customer_silence_reengage_followup',
      },
    ]);
  });

  it('assistant has voicemail detection', async () => {
    const assistant = await getAssistant({ message: { type: 'assistant-request' } });
    expect(assistant.voicemailDetection).toBeDefined();
    expect(assistant.voicemailMessage).toBeDefined();
  });

  it('assistant omits forwarding number by default even when a transfer number exists', async () => {
    const assistant = await getAssistant({ message: { type: 'assistant-request' } });
    expect(assistant.forwardingPhoneNumber).toBeUndefined();
  });

  it('assistant includes forwarding number when live transfers are enabled', async () => {
    vi.stubEnv('ENABLE_LIVE_CALL_TRANSFERS', 'true');
    const assistant = await getAssistant({ message: { type: 'assistant-request' } });
    expect(assistant.forwardingPhoneNumber).toBe('+15559999999');
  });

  it('assistant omits forwarding number when not configured', async () => {
    vi.stubEnv('TRANSFER_PHONE_NUMBER', '');
    vi.stubEnv('ENABLE_LIVE_CALL_TRANSFERS', 'true');
    const assistant = await getAssistant({ message: { type: 'assistant-request' } });
    expect(assistant.forwardingPhoneNumber).toBeUndefined();
  });

  it('falls back to a generic active-flow assistant when the cold context misses the fast bootstrap deadline', async () => {
    vi.mocked(prisma.user.findFirst).mockImplementation(
      () => new Promise(() => {}) as any
    );

    const assistant = await getAssistant({
      message: {
        type: 'assistant-request',
        call: { phoneNumberId: 'pn-slow-1' },
      },
    });
    const toolNames = assistant.model.tools.filter((t: any) => t.function).map((t: any) => t.function.name);

    expect(assistant.firstMessage).toContain('Shall we get started?');
    expect(assistant.model.messages[0].content).toContain('ACTIVE FLOW CONTROL');
    expect(toolNames).toContain('advanceActiveFlow');
    expect(toolNames).not.toContain('captureIntakeState');
  });
});
