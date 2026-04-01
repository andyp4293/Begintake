import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizePhoneNumber, normalizeOptionalPhoneNumber } from '@/lib/phone';
import { verifyVapiSecret, parseToolArguments } from '@/lib/vapi';
import { identifyLegalArea, findBestLawyer } from '@/lib/lawyer-matcher';
import { createCalendarEvent, checkAttorneyBusy } from '@/lib/google-calendar';
import { sendCallSummaryEmail } from '@/lib/email';
import { compileFlowToPrompt } from '@/lib/flow-compiler';
import { validateFlowSummaryReadiness } from '@/lib/flow-summary-readiness';
import {
  FLOW_COMPLETED_NODE_ID,
  FLOW_CURRENT_NODE_KEY,
  FLOW_POST_STATE_KEY,
  getFlowActionWrites,
  getFlowCollectedValue,
  getFlowFlagValue,
  hydrateFlowRuntimeState,
  isInternalFlowFieldName,
  progressActiveFlow,
  type FlowRuntimeWrite,
} from '@/lib/active-flow-runner';
import {
  getLiveTransferAnnouncement,
  getTransferTarget,
  isLiveTransferEnabled,
  resolveTransferCallbackMessage,
} from '@/lib/transfer-handoff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── System prompt for the AI paralegal ──────────────────────────────────────

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripTrailingDuplicateQuestion(greeting: string, nextQuestion?: string | null): string {
  if (!nextQuestion) return greeting;

  const trimmedGreeting = greeting.trim();
  const trimmedQuestion = nextQuestion.trim();
  if (!trimmedGreeting || !trimmedQuestion) return greeting;

  const normalize = (text: string) => text.trim().replace(/\s+/g, ' ').replace(/[.?!]+$/g, '').toLowerCase();
  if (!normalize(trimmedGreeting).endsWith(normalize(trimmedQuestion))) {
    return greeting;
  }

  const pattern = new RegExp(`${escapeRegExp(trimmedQuestion)}[\\s]*$`, 'i');
  const stripped = trimmedGreeting.replace(pattern, '').trim().replace(/[.?!]+$/g, '').trim();
  return stripped ? `${stripped}.` : greeting;
}

function buildInitialFirstMessage(greeting?: string, nextQuestion?: string | null): string | undefined {
  if (!greeting) {
    return nextQuestion || undefined;
  }

  const baseGreeting = stripTrailingDuplicateQuestion(greeting, nextQuestion);
  if (!nextQuestion) {
    return baseGreeting;
  }

  const trimmedGreeting = baseGreeting.trim();
  const trimmedQuestion = nextQuestion.trim();
  if (!trimmedGreeting) {
    return trimmedQuestion;
  }

  const normalize = (text: string) => text.trim().replace(/\s+/g, ' ').replace(/[.?!]+$/g, '').toLowerCase();
  if (normalize(trimmedGreeting).endsWith(normalize(trimmedQuestion))) {
    return trimmedGreeting;
  }

  const separator = /[.?!]\s*$/.test(trimmedGreeting) ? ' ' : '. ';
  return `${trimmedGreeting}${separator}${trimmedQuestion}`;
}

async function loadActiveFlow() {
  return prisma.intakeFlow.findFirst({
    where: { isActive: true },
    include: {
      nodes: { orderBy: { sortOrder: 'asc' } },
      edges: { orderBy: { sortOrder: 'asc' } },
    },
  });
}

async function buildSystemPrompt(assistantName?: string, firmName?: string): Promise<{ prompt: string; firstMessage?: string; flowId?: string }> {
  // Check for active flow first
  try {
    const activeFlow = await loadActiveFlow();

    if (activeFlow) {
      console.log(`[vapi] Using active flow: ${activeFlow.name} (${activeFlow.id})`);
      const prompt = compileFlowToPrompt(activeFlow, assistantName, firmName);
      // Extract the greeting from the start node to use as firstMessage
      const startNode = activeFlow.nodes.find((n: any) => n.type === 'start');
      const startConfig = startNode?.config as any;
      const rawGreeting = startConfig?.greeting as string | undefined;
      const nextStartEdge = startNode
        ? activeFlow.edges
            .filter((e: any) => e.sourceNodeId === startNode.id)
            .sort((a: any, b: any) => a.sortOrder - b.sortOrder)[0]
        : null;
      const nextStartNode = nextStartEdge
        ? activeFlow.nodes.find((n: any) => n.id === nextStartEdge.targetNodeId)
        : null;
      const nextStartConfig = nextStartNode?.config as any;
      const nextQuestion = typeof nextStartConfig?.question === 'string'
        ? nextStartConfig.question
        : null;
      // Replace {name} and {firm} variables
      const greeting = rawGreeting
        ?.replace(/\{name\}/gi, assistantName || 'Aria')
        .replace(/\{firm\}/gi, firmName || 'our law firm');
      return { prompt, firstMessage: buildInitialFirstMessage(greeting, nextQuestion), flowId: activeFlow.id };
    }
  } catch (err) {
    console.error('[vapi] Failed to load active flow, falling back to legacy prompt:', err);
  }

  // Legacy prompt (existing behavior)
  const lawyers = await prisma.lawyer.findMany({
    where: { available: true },
    select: { id: true, name: true, specialties: true, phone: true, email: true },
  });

  const lawyerList = lawyers
    .map((l) => `- ${l.name}: ${l.specialties.join(', ')} (ID: ${l.id})`)
    .join('\n');

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return { prompt: `You are the AI paralegal receptionist for a law firm.
Today is ${today}.

Available attorneys (use the ID field when calling tools, never say the ID aloud):
${lawyerList}

Your job:
- Greet callers warmly and ask for their name.
- Then ask: "Is the number you're calling from the best number to reach you?" If yes, use that number. If no, ask for their preferred callback number.
- Also ask for their email address so the attorney can follow up. When confirming it back, only spell out the part before the @ sign one letter at a time - e.g. "So that's A... N... D... Y... at gmail.com, is that right?" Do NOT spell out common domains like gmail.com, yahoo.com, outlook.com - just say them normally.
- Once you have their name, phone, and email, call checkClient to look them up.

IF CURRENT CLIENT (checkClient returns isCurrentClient: true):
- Immediately call generateTransferSummary with transferTarget="paralegal", handoffMode="live_transfer", and the caller details you have.
- The live transfer itself will say exactly: "Welcome back. We'll transfer you to our team right away."
- Do not add any filler like "hold on", "hold on a sec", "just a sec", or "one moment" before the tool call.
- Do not say anything else unless the transfer fails.

IF PROSPECTIVE CLIENT (not in our system):
- Continue the normal intake flow. Do NOT transfer them to the paralegal just because they are new.

REQUESTS FOR A REAL PERSON:
- If the caller says "talk to a person", "real person", "human", "paralegal", "manager", "transfer", "connect me", or similar - say "Absolutely. I'll send this to the right person on our team so they can reach out to you." Do NOT promise an immediate live transfer.
- If the situation sounds like an emergency - say "I'm flagging this for immediate review and sending it to the right lawyer now." Do NOT promise an immediate live transfer.
- If you cannot determine the appropriate response - say "I'll make sure this gets to the right lawyer and they will reach out to you."

ENDING THE CALL:
- When the caller says "no", "nope", "nothing else", "that's all", "I'm good", "goodbye", "bye", or anything similar indicating they're done:
  1. Say: "Thank you for calling! Have a wonderful day. Goodbye!"
  2. Immediately call the endCall tool. Do NOT keep talking after saying goodbye.
- You MUST call endCall after saying goodbye. The call will NOT end unless you call endCall.
- Never combine the goodbye with other information - keep it as its own separate message.

IMPORTANT RULES:
- NEVER give legal advice. You are a paralegal, not an attorney.
- Be empathetic. People calling a law firm are often stressed or scared.
- Keep ALL responses under 2 sentences - this is a phone call, be brief.
- Call tools silently. Never say their tool names aloud.
- Whenever the caller clearly provides their name, callback number, email, whether they are new or existing, whether they are calling for themselves or someone else, or their core issue, silently call captureIntakeState with every slot you now know.
- Do NOT add filler like "one moment", "hold on", "hold on a sec", "just a sec", or "let me check" before calling a tool.
- Once the caller has already confirmed their callback number, name, email, or whether they are calling for themselves, do not ask that same question again unless they corrected you or you genuinely did not understand them.
- If the caller volunteers answers to later intake questions early, capture those facts immediately and skip the later duplicate questions instead of re-asking them.
- If one caller response answers multiple intake slots at once, treat every clearly answered slot as captured and move to the first still-unanswered question.
- If the caller says "hello?" or asks if you are still there, briefly reassure them and resume the current unanswered question. Do not restart the intake or reconfirm earlier answers.
- Do not invent extra follow-up questions after you already have the scripted answer you need. Move to the next intake question.
- Never read IDs aloud; they are internal references only.
- If you don't know the answer, say "I'll make sure the right person on our team follows up with you."` };
}

async function loadFlowForSummaryValidation(intakeFlowId?: string | null) {
  if (intakeFlowId) {
    const persistedFlow = await prisma.intakeFlow.findUnique({
      where: { id: intakeFlowId },
      include: {
        nodes: { orderBy: { sortOrder: 'asc' } },
        edges: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (persistedFlow) return persistedFlow;
  }

  return loadActiveFlow();
}

// ─── Tool definitions for VAPI assistant config ──────────────────────────────

function getToolDefinitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'captureIntakeState',
        description: 'Silently save common intake facts the caller has already provided so duplicate questions can be skipped later in the call.',
        parameters: {
          type: 'object',
          properties: {
            callerName: { type: 'string', description: 'Caller full name if already known' },
            callerPhone: { type: 'string', description: 'Best callback phone number if already known' },
            callerEmail: { type: 'string', description: 'Caller email if already known' },
            clientStatus: { type: 'string', enum: ['new', 'existing'], description: 'Whether the caller is new or an existing client' },
            callingFor: { type: 'string', enum: ['self', 'other'], description: 'Whether the caller is calling for themselves or someone else' },
            issueSummary: { type: 'string', description: 'The caller’s core issue in plain language if they already described it' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'advanceActiveFlow',
        description: 'Server-owned intake flow runner. After each caller answer on an active flow, call this with the latest caller response so the server can decide the next step, skip already-answered questions, and complete handoff or scheduling actions.',
        parameters: {
          type: 'object',
          properties: {
            callerResponse: { type: 'string', description: 'The caller’s exact latest answer in plain language.' },
          },
          required: ['callerResponse'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'checkClient',
        description: 'Check if a caller is an existing client by their phone number',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Caller name' },
            phone: { type: 'string', description: 'Caller phone number' },
          },
          required: ['phone'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'identifyLawyer',
        description: 'Identify the best lawyer for a legal issue based on description',
        parameters: {
          type: 'object',
          properties: {
            legalIssueDescription: { type: 'string', description: 'Description of the legal issue' },
          },
          required: ['legalIssueDescription'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'scheduleConsultation',
        description: 'Schedule a consultation appointment. Automatically selects the best matched attorney based on the legal issue — no lawyerId needed.',
        parameters: {
          type: 'object',
          properties: {
            callerName:    { type: 'string', description: 'Caller full name' },
            callerPhone:   { type: 'string', description: 'Caller phone number' },
            callerEmail:   { type: 'string', description: 'Caller email address (optional)' },
            legalIssue:    { type: 'string', description: 'Brief description of the legal issue, used to match the right attorney' },
            preferredDate: { type: 'string', description: 'Preferred date in YYYY-MM-DD format' },
            preferredTime: { type: 'string', description: 'Preferred time e.g. "2 PM" or "14:00"' },
          },
          required: ['callerName', 'callerPhone', 'preferredDate', 'preferredTime'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'checkAttorneyAvailability',
        description: 'Check whether the best matched attorney is available right now — combines their business hours and live Google Calendar status. Call this before transferring to an attorney to avoid sending callers to someone who is busy.',
        parameters: {
          type: 'object',
          properties: {
            legalArea: { type: 'string', description: 'The legal area of the caller\'s issue, used to select the best matched attorney' },
            proposedTime: { type: 'string', description: 'ISO 8601 datetime to check availability for (optional, defaults to now)' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'generateTransferSummary',
        description: 'Used by intake flows at the handoff step. Saves intake data and prepares follow-up for the matched lawyer or team member, with live transfer only when explicitly enabled.',
        parameters: {
          type: 'object',
          properties: {
            transferTarget: { type: 'string', enum: ['attorney', 'paralegal'], description: '"attorney" to route to the best matched attorney, "paralegal" to route to the firm paralegal number' },
            handoffMode: { type: 'string', enum: ['summary_only', 'live_transfer'], description: 'Use "summary_only" for callback follow-up without a live transfer, or "live_transfer" only when that mode is explicitly enabled.' },
            callerName:     { type: 'string', description: 'Caller name' },
            callerPhone:    { type: 'string', description: 'Caller phone number' },
            callerEmail:    { type: 'string', description: 'Caller email address' },
            issue:          { type: 'string', description: 'Summary of the legal issue' },
            notes:          { type: 'string', description: 'Detailed intake notes' },
            petitionType:   { type: 'string', description: 'Petition type flag (e.g. V-Petition, F-Petition)' },
            matterCategory: { type: 'string', description: 'Matter category from intake' },
            partyRole:      { type: 'string', description: 'Petitioner or respondent' },
            urgencyFlag:    { type: 'string', description: 'Urgency flag if set during intake' },
          },
          required: ['transferTarget'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'generateSummary',
        description: 'Generate a call summary and email it to the appropriate lawyer. Only call this after the caller has completed the full active intake branch; do not call it early.',
        parameters: {
          type: 'object',
          properties: {
            callerName: { type: 'string', description: 'Caller name' },
            callerPhone: { type: 'string', description: 'Caller phone number' },
            callerEmail: { type: 'string', description: 'Caller email address' },
            issue: { type: 'string', description: 'Summary of the legal issue discussed' },
            notes: { type: 'string', description: 'Detailed notes from the conversation' },
            petitionType: { type: 'string', description: 'Petition type flag set during intake (e.g. V-Petition, F-Petition, O-Petition)' },
            matterCategory: { type: 'string', description: 'Matter category determined during intake (e.g. custody, support, family_offense)' },
            partyRole: { type: 'string', description: 'Whether caller is petitioner or respondent' },
            urgencyFlag: { type: 'string', description: 'Urgency level if flagged during intake (e.g. safety_first, urgent)' },
          },
          required: ['callerName', 'callerPhone', 'issue'],
        },
      },
    },
  ];
}

// ─── Resolve which firm (User) owns this VAPI call ───────────────────────────
// Looks up the user by the VAPI phone number ID that received the call.
// Falls back to the first user if the phone number ID isn't matched
// (handles single-tenant deployments and legacy calls).

async function resolveUserId(vapiPhoneNumberId?: string): Promise<string | null> {
  if (vapiPhoneNumberId) {
    const user = await prisma.user.findFirst({
      where: { vapiPhoneNumberId },
      select: { id: true },
    });
    if (user) return user.id;
  }
  // Fallback: single-tenant or unmatched number
  const fallback = await prisma.user.findFirst({ select: { id: true } });
  return fallback?.id ?? null;
}

// ─── Helper: update most recent call session ─────────────────────────────────

async function updateLatestCallSession(callerPhone: string | null, data: Record<string, any>) {
  if (!callerPhone) return;
  const session = await prisma.callSession.findFirst({
    where: { callerPhone },
    orderBy: { createdAt: 'desc' },
  });
  if (session) {
    await prisma.callSession.update({
      where: { id: session.id },
      data,
    });
  }
}

const COMMON_CAPTURED_FIELDS = [
  'callerName',
  'callerPhone',
  'callerEmail',
  'clientStatus',
  'callingFor',
  'issueSummary',
] as const;

type CapturedFieldName = typeof COMMON_CAPTURED_FIELDS[number];
type CapturedIntakeState = Partial<Record<CapturedFieldName, string>>;

function normalizeCapturedFieldValue(fieldName: CapturedFieldName, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (fieldName === 'callerPhone') {
    const normalizedPhone = normalizeOptionalPhoneNumber(trimmed);
    return normalizedPhone || null;
  }

  if (fieldName === 'clientStatus') {
    const normalized = trimmed.toLowerCase();
    if (['new', 'first time', 'prospective'].includes(normalized)) return 'new';
    if (['existing', 'current', 'returning'].includes(normalized)) return 'existing';
    return null;
  }

  if (fieldName === 'callingFor') {
    const normalized = trimmed.toLowerCase();
    if (['self', 'myself', 'me'].includes(normalized)) return 'self';
    if (['other', 'someone else', 'behalf'].includes(normalized)) return 'other';
    return null;
  }

  return trimmed;
}

async function findOrCreateCallSessionForCapturedState(activeCallId?: string, callerPhone?: string | null) {
  let session = activeCallId
    ? await prisma.callSession.findUnique({ where: { callId: activeCallId } })
    : null;

  const normalizedPhone = normalizeOptionalPhoneNumber(callerPhone || '') || null;

  if (!session && normalizedPhone) {
    session = await prisma.callSession.findFirst({
      where: { callerPhone: normalizedPhone },
      orderBy: { createdAt: 'desc' },
    });
  }

  if (!session) {
    session = await prisma.callSession.create({
      data: {
        callId: activeCallId || `capture-${Date.now()}`,
        callerPhone: normalizedPhone,
        status: 'active',
      },
    });
  }

  return session;
}

async function loadCapturedIntakeState(activeCallId?: string, callerPhone?: string | null): Promise<{ sessionId: string | null; state: CapturedIntakeState }> {
  const normalizedPhone = normalizeOptionalPhoneNumber(callerPhone || '') || null;
  const session = activeCallId
    ? await prisma.callSession.findUnique({ where: { callId: activeCallId } })
    : normalizedPhone
    ? await prisma.callSession.findFirst({
        where: { callerPhone: normalizedPhone },
        orderBy: { createdAt: 'desc' },
      })
    : null;

  if (!session) {
    return { sessionId: null, state: {} };
  }

  const rows = await prisma.intakeData.findMany({
    where: { callSessionId: session.id },
    orderBy: { createdAt: 'asc' },
  });

  const state: CapturedIntakeState = {};
  for (const row of rows) {
    if (COMMON_CAPTURED_FIELDS.includes(row.fieldName as CapturedFieldName)) {
      state[row.fieldName as CapturedFieldName] = row.fieldValue;
    }
  }

  if (!state.callerPhone && session.callerPhone) {
    state.callerPhone = session.callerPhone;
  }

  if (!state.clientStatus && session.clientType) {
    const normalizedStatus = normalizeCapturedFieldValue('clientStatus', session.clientType);
    if (normalizedStatus) state.clientStatus = normalizedStatus;
  }

  return { sessionId: session.id, state };
}

function getMissingCapturedFieldNames(state: CapturedIntakeState): string[] {
  const missing: string[] = [];
  if (!state.callerName) missing.push('callerName');
  if (!state.clientStatus) missing.push('clientStatus');
  if (!state.callerPhone) missing.push('callerPhone');
  if (!state.callingFor) missing.push('callingFor');
  if (!state.issueSummary) missing.push('issueSummary');
  return missing;
}

async function handleCaptureIntakeState(
  args: Record<string, unknown>,
  activeCallId?: string,
  fallbackCallerPhone?: string | null,
) {
  const entries = COMMON_CAPTURED_FIELDS
    .map((fieldName) => {
      const fallbackValue = fieldName === 'callerPhone' ? fallbackCallerPhone : undefined;
      const value = normalizeCapturedFieldValue(fieldName, args[fieldName] ?? fallbackValue);
      return value
        ? {
            fieldName,
            fieldValue: value,
          }
        : null;
    })
    .filter((entry): entry is { fieldName: CapturedFieldName; fieldValue: string } => Boolean(entry));

  const resolvedPhone = entries.find((entry) => entry.fieldName === 'callerPhone')?.fieldValue || fallbackCallerPhone || null;
  const session = await findOrCreateCallSessionForCapturedState(activeCallId, resolvedPhone);

  if (entries.length > 0) {
    await prisma.intakeData.createMany({
      data: entries.map((entry) => ({
        callSessionId: session.id,
        fieldName: entry.fieldName,
        fieldValue: entry.fieldValue,
      })),
    });
  }

  const clientStatus = entries.find((entry) => entry.fieldName === 'clientStatus')?.fieldValue;
  const callerPhone = entries.find((entry) => entry.fieldName === 'callerPhone')?.fieldValue;

  const sessionPatch = {
    ...(callerPhone && !session.callerPhone ? { callerPhone } : {}),
    ...(clientStatus ? { clientType: clientStatus === 'existing' ? 'current' : 'prospective' } : {}),
  };

  if (Object.keys(sessionPatch).length > 0) {
    await prisma.callSession.update({
      where: { id: session.id },
      data: sessionPatch,
    });
  }

  const { state } = await loadCapturedIntakeState(activeCallId || session.callId, callerPhone || session.callerPhone);
  return {
    success: true,
    callSessionId: session.id,
    capturedFields: state,
    missingCommonFields: getMissingCapturedFieldNames(state),
  };
}

const FLOW_POST_STATE_AWAITING_ANYTHING_ELSE = 'awaiting_anything_else';

function normalizeClientStatusForFlow(clientType?: string | null): string | null {
  if (!clientType) return null;
  if (clientType === 'current') return 'existing';
  if (clientType === 'prospective') return 'new';
  return null;
}

function isCallerDoneResponse(value: string): boolean {
  const normalized = value.toLowerCase().trim();
  if (!normalized) return false;
  return /^(no|nope|nah|nothing else|that'?s all|thats all|i'?m good|im good|goodbye|bye|all set|all good|no thank you)\b/.test(normalized);
}

function humanizeFieldName(fieldName: string): string {
  return fieldName
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

async function loadFlowRuntimeRows(callSessionId: string) {
  return prisma.intakeData.findMany({
    where: { callSessionId },
    orderBy: { createdAt: 'asc' },
  });
}

async function persistFlowRuntimeWrites(
  callSessionId: string,
  flowId: string | null | undefined,
  writes: FlowRuntimeWrite[],
) {
  if (writes.length === 0) return;

  await prisma.intakeData.createMany({
    data: writes.map((write) => ({
      callSessionId,
      flowId: flowId || null,
      fieldName: write.fieldName,
      fieldValue: write.fieldValue,
      nodeId: write.nodeId || null,
      branchPath: write.branchPath || null,
    })),
  });
}

function mergeRuntimeRows(
  existingRows: Array<{ fieldName: string; fieldValue: string; nodeId?: string | null }>,
  writes: FlowRuntimeWrite[],
) {
  return [
    ...existingRows,
    ...writes.map((write) => ({
      fieldName: write.fieldName,
      fieldValue: write.fieldValue,
      nodeId: write.nodeId || null,
    })),
  ];
}

async function findOrCreateCallSessionForActiveFlow(
  activeCallId?: string,
  callerPhone?: string | null,
  flowId?: string | null,
) {
  const normalizedPhone = normalizeOptionalPhoneNumber(callerPhone || '') || null;

  let session = activeCallId
    ? await prisma.callSession.findUnique({ where: { callId: activeCallId } })
    : null;

  if (!session && normalizedPhone) {
    session = await prisma.callSession.findFirst({
      where: { callerPhone: normalizedPhone },
      orderBy: { createdAt: 'desc' },
    });
  }

  if (!session) {
    session = await prisma.callSession.create({
      data: {
        callId: activeCallId || `active-flow-${Date.now()}`,
        callerPhone: normalizedPhone,
        intakeFlowId: flowId || null,
        status: 'active',
      },
    });
  } else if (flowId && session.intakeFlowId !== flowId) {
    session = await prisma.callSession.update({
      where: { id: session.id },
      data: { intakeFlowId: flowId },
    });
  }

  return session;
}

function buildIntakeNotesFromState(state: ReturnType<typeof hydrateFlowRuntimeState>): string {
  const lines = Object.entries(state.fieldValues)
    .filter(([fieldName, fieldValue]) => {
      if (!fieldValue?.trim()) return false;
      if (isInternalFlowFieldName(fieldName)) return false;
      return ![
        'caller_name',
        'callerName',
        'callback_phone',
        'callerPhone',
        'email',
        'callerEmail',
        'issue_summary',
        'issueSummary',
      ].includes(fieldName);
    })
    .map(([fieldName, fieldValue]) => `${humanizeFieldName(fieldName)}: ${fieldValue}`);

  return lines.join('\n');
}

function buildTransferSummaryArgs(
  state: ReturnType<typeof hydrateFlowRuntimeState>,
  session: { callerPhone?: string | null },
  config: any,
) {
  return {
    transferTarget: config?.transferTarget,
    handoffMode: config?.handoffMode,
    callbackMessage: typeof config?.callbackMessage === 'string' ? config.callbackMessage : undefined,
    message: typeof config?.message === 'string' ? config.message : undefined,
    callerName: getFlowCollectedValue(state, 'caller_name', 'callerName') || 'Unknown',
    callerPhone: getFlowCollectedValue(state, 'callback_phone', 'callerPhone') || session.callerPhone || '',
    callerEmail: getFlowCollectedValue(state, 'email', 'callerEmail') || undefined,
    issue: getFlowCollectedValue(state, 'issue_summary', 'issueSummary') || '',
    notes: buildIntakeNotesFromState(state),
    petitionType: getFlowFlagValue(state, 'petitionType') || undefined,
    matterCategory:
      getFlowFlagValue(state, 'matterCategory') ||
      getFlowFlagValue(state, 'practice_area') ||
      getFlowFlagValue(state, 'matter_type') ||
      undefined,
    partyRole:
      getFlowFlagValue(state, 'partyRole') ||
      getFlowCollectedValue(state, 'callingFor') ||
      undefined,
    urgencyFlag:
      getFlowFlagValue(state, 'urgencyFlag') ||
      getFlowFlagValue(state, 'urgency_flag') ||
      undefined,
  };
}

function buildBookAppointmentArgs(
  state: ReturnType<typeof hydrateFlowRuntimeState>,
  session: { callerPhone?: string | null },
) {
  return {
    callerName: getFlowCollectedValue(state, 'caller_name', 'callerName') || 'Unknown',
    callerPhone: getFlowCollectedValue(state, 'callback_phone', 'callerPhone') || session.callerPhone || '',
    callerEmail: getFlowCollectedValue(state, 'email', 'callerEmail') || undefined,
    legalIssue: getFlowCollectedValue(state, 'issue_summary', 'issueSummary') || '',
    preferredDate: getFlowCollectedValue(state, 'preferred_date') || '',
    preferredTime: getFlowCollectedValue(state, 'preferred_time') || '',
  };
}

function findPreviousQuestionNode(flow: any, nodeId: string) {
  const nodeMap = new Map<string, any>(flow.nodes.map((node: any) => [node.id, node]));
  const sourceEdge = flow.edges.find((edge: any) => edge.targetNodeId === nodeId);
  if (!sourceEdge) return null;

  let current: any = nodeMap.get(sourceEdge.sourceNodeId);
  while (current) {
    if (current.type === 'question') return current;
    const incomingEdge = flow.edges.find((edge: any) => edge.targetNodeId === current.id);
    current = incomingEdge ? nodeMap.get(incomingEdge.sourceNodeId) : null;
  }

  return null;
}

async function handlePostFlowState(
  callerResponse: string,
  callSessionId: string,
  flowId?: string | null,
) {
  const writes: FlowRuntimeWrite[] = [];

  if (isCallerDoneResponse(callerResponse)) {
    writes.push(
      { fieldName: FLOW_POST_STATE_KEY, fieldValue: 'none' },
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: FLOW_COMPLETED_NODE_ID },
    );
    await persistFlowRuntimeWrites(callSessionId, flowId, writes);
    return {
      success: true,
      step: 'end',
      assistantMessage: 'Thank you for calling. Have a wonderful day. Goodbye!',
      endCallAfterSpeaking: true,
    };
  }

  writes.push({ fieldName: FLOW_POST_STATE_KEY, fieldValue: FLOW_POST_STATE_AWAITING_ANYTHING_ELSE });
  await persistFlowRuntimeWrites(callSessionId, flowId, writes);
  return {
    success: true,
    step: 'ask',
    assistantMessage: 'Of course. What else can I help you with today?',
  };
}

// ─── Tool handlers ───────────────────────────────────────────────────────────

async function handleCheckClient(args: Record<string, unknown>) {
  const phone = typeof args.phone === 'string' ? normalizePhoneNumber(args.phone) : null;
  const name = typeof args.name === 'string' ? args.name : null;

  if (!phone) {
    return { isCurrentClient: false, message: 'No phone number provided' };
  }

  const client = await prisma.client.findUnique({
    where: { phone },
    include: { assignedLawyer: true },
  });

  if (client?.isCurrentClient) {
    await updateLatestCallSession(phone, { clientType: 'current', clientId: client.id });
    return {
      isCurrentClient: true,
      clientId: client.id,
      clientName: client.name,
      assignedLawyerName: client.assignedLawyer?.name || null,
      assignedLawyerPhone: client.assignedLawyer?.phone || process.env.TRANSFER_PHONE_NUMBER || null,
    };
  }

  await updateLatestCallSession(phone, { clientType: 'prospective' });
  return {
    isCurrentClient: false,
    clientId: client?.id || null,
    message: 'Caller is not a current client',
  };
}

async function handleIdentifyLawyer(args: Record<string, unknown>) {
  const description = typeof args.legalIssueDescription === 'string' ? args.legalIssueDescription : '';
  const legalArea = identifyLegalArea(description);
  const lawyer = await findBestLawyer(legalArea);

  if (!lawyer) {
    return {
      found: false,
      legalArea,
      message: 'No available lawyer found for this area. Please transfer to the main office.',
    };
  }

  return {
    found: true,
    legalArea,
    lawyerId: lawyer.id,
    lawyerName: lawyer.name,
    specialties: lawyer.specialties,
    available: lawyer.available,
    phone: lawyer.phone,
  };
}

function parseTimeString(timeStr: string): { hour: number; minute: number } | null {
  const normalized = timeStr.trim().toUpperCase().replace(/\./g, '');
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2] ?? '0', 10);
  const meridiem = match[3];
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

async function handleScheduleConsultation(args: Record<string, unknown>, userId: string) {
  const clientName = typeof args.clientName === 'string' ? args.clientName : 'Unknown';
  const clientPhone = typeof args.clientPhone === 'string' ? normalizePhoneNumber(args.clientPhone) : '';
  const clientEmail = typeof args.clientEmail === 'string' ? args.clientEmail : undefined;
  const lawyerId = typeof args.lawyerId === 'string' ? args.lawyerId : '';
  const preferredDate = typeof args.preferredDate === 'string' ? args.preferredDate : '';
  const preferredTime = typeof args.preferredTime === 'string' ? args.preferredTime : '';

  // Find lawyer
  const lawyer = await prisma.lawyer.findUnique({ where: { id: lawyerId } });
  if (!lawyer) {
    return { success: false, message: 'Lawyer not found' };
  }

  // Parse time
  const parsedTime = parseTimeString(preferredTime);
  if (!parsedTime) {
    return { success: false, message: 'Could not understand the time. Please try again with a format like "2 PM" or "14:00".' };
  }

  // Build start/end times
  const startTime = new Date(`${preferredDate}T00:00:00`);
  startTime.setHours(parsedTime.hour, parsedTime.minute, 0, 0);
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1-hour consultation

  // Create or find client
  let client = await prisma.client.findUnique({ where: { phone: clientPhone } });
  if (!client) {
    client = await prisma.client.create({
      data: {
        name: clientName,
        phone: clientPhone,
        email: clientEmail || null,
        isCurrentClient: false,
      },
    });
  }

  // Create Google Calendar event
  let googleEventId: string | null = null;
  try {
    googleEventId = await createCalendarEvent({
      calendarId: lawyer.googleCalendarId || lawyer.email,
      summary: `Consultation: ${clientName}`,
      description: `Phone consultation with ${clientName} (${clientPhone})`,
      startTime,
      endTime,
      attendeeEmail: clientEmail,
    }, userId);
  } catch (error) {
    console.error('Google Calendar error:', error);
  }

  // Create appointment in DB
  const appointment = await prisma.appointment.create({
    data: {
      clientId: client.id,
      lawyerId: lawyer.id,
      startTime,
      endTime,
      status: 'scheduled',
      googleCalendarEventId: googleEventId,
      notes: `Scheduled via Begintake call`,
    },
  });

  const dateStr = startTime.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = startTime.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  // Tag the call session
  await updateLatestCallSession(clientPhone, {
    callOutcome: 'consultation_scheduled',
    legalArea: lawyer.specialties[0] || null,
    lawyerId: lawyer.id,
  });

  return {
    success: true,
    appointmentId: appointment.id,
    lawyerName: lawyer.name,
    date: dateStr,
    time: timeStr,
    message: `Consultation scheduled with ${lawyer.name} on ${dateStr} at ${timeStr}.`,
  };
}

async function handleTransferCall(args: Record<string, unknown>) {
  if (process.env.ENABLE_LIVE_CALL_TRANSFERS !== 'true') {
    return {
      success: true,
      liveTransfer: false,
      message: "Live call transfers are disabled right now. Let the caller know their information has been sent and the right lawyer will reach out to them.",
    };
  }

  const reason = typeof args.reason === 'string' ? args.reason : 'Client requested transfer';
  const legalAreaHint = typeof args.legalArea === 'string' ? args.legalArea : null;

  // Try the provided number first
  let phoneNumber = typeof args.phoneNumber === 'string' ? args.phoneNumber : null;
  let transferringToName: string | null = null;

  if (!phoneNumber) {
    // Try to find the best matched attorney and use their direct phone
    if (legalAreaHint) {
      const legalArea = identifyLegalArea(legalAreaHint);
      const lawyer = await findBestLawyer(legalArea);
      if (lawyer?.phone) {
        phoneNumber = lawyer.phone;
        transferringToName = lawyer.name;
      }
    }
  }

  if (!phoneNumber) {
    // Fall back to the firm's general transfer number
    const user = await prisma.user.findFirst({
      where: { transferPhoneNumber: { not: null } },
      select: { transferPhoneNumber: true },
    });
    phoneNumber = user?.transferPhoneNumber || process.env.TRANSFER_PHONE_NUMBER || null;
  }

  if (!phoneNumber) {
    return {
      message: 'No transfer number is configured. Please ask the caller to call back during business hours.',
    };
  }

  // We don't have callerPhone here, but the status-update will catch it
  return {
    type: 'transfer',
    callOutcome: 'transferred',
    destination: {
      type: 'number',
      number: phoneNumber,
      message: transferringToName
        ? `Transferring to ${transferringToName}. Reason: ${reason}`
        : `Transferring the call. Reason: ${reason}`,
    },
  };
}

function getVapiControlUrl(call: any): string | null {
  const raw = call?.monitor?.controlUrl;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

async function triggerVapiTransfer(
  controlUrl: string,
  destination: { type: 'number'; number: string },
  content?: string,
) {
  const endpoint = controlUrl.endsWith('/control')
    ? controlUrl
    : `${controlUrl.replace(/\/$/, '')}/control`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'transfer',
      destination,
      ...(content ? { content } : {}),
    }),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    throw new Error(`Vapi transfer control failed (${response.status}): ${responseText.slice(0, 300)}`);
  }
}

async function handleBookAppointment(args: Record<string, unknown>, userId: string) {
  const callerName  = typeof args.callerName  === 'string' ? args.callerName  : 'Unknown';
  const rawPhone    = typeof args.callerPhone  === 'string' ? args.callerPhone  : '';
  const callerPhone = normalizeOptionalPhoneNumber(rawPhone) || '';
  const callerEmail = typeof args.callerEmail  === 'string' ? args.callerEmail  : undefined;
  const legalIssue  = typeof args.legalIssue   === 'string' ? args.legalIssue   : '';
  const preferredDate = typeof args.preferredDate === 'string' ? args.preferredDate : '';
  const preferredTime = typeof args.preferredTime === 'string' ? args.preferredTime : '';

  // Find the best lawyer automatically — no lawyerId required from the AI
  const legalArea = identifyLegalArea(legalIssue || 'other');
  const lawyer = await findBestLawyer(legalArea);
  if (!lawyer) {
    return { success: false, message: 'No attorneys are available to book right now. Your information has been saved and someone will call you back.' };
  }

  // Delegate to the existing scheduleConsultation handler
  return handleScheduleConsultation({
    clientName:    callerName,
    clientPhone:   callerPhone,
    clientEmail:   callerEmail,
    lawyerId:      lawyer.id,
    preferredDate,
    preferredTime,
  }, userId);
}

async function handleCheckAttorneyAvailability(args: Record<string, unknown>, userId: string) {
  const legalAreaHint = typeof args.legalArea === 'string' ? args.legalArea : '';
  const proposedTimeStr = typeof args.proposedTime === 'string' ? args.proposedTime : null;
  const checkTime = proposedTimeStr ? new Date(proposedTimeStr) : new Date();

  // Find best matched attorney
  const legalArea = identifyLegalArea(legalAreaHint || 'other');
  const lawyer = await findBestLawyer(legalArea);

  if (!lawyer) {
    return {
      available: false,
      reason: 'No attorneys are currently configured in the system.',
      lawyerName: null,
      lawyerPhone: null,
    };
  }

  // Use email as calendar ID (works with service account + domain delegation or shared calendars)
  // Fall back to googleCalendarId if set
  const calendarId = lawyer.googleCalendarId || lawyer.email;

  const availability = await checkAttorneyBusy({
    calendarId,
    timeMin: checkTime,
    timeMax: new Date(checkTime.getTime() + 30 * 60 * 1000),
    availabilityStart: lawyer.availabilityStart,
    availabilityEnd: lawyer.availabilityEnd,
  }, userId);

  return {
    available: availability.available,
    lawyerName: lawyer.name,
    lawyerPhone: lawyer.phone || null,
    withinBusinessHours: availability.withinBusinessHours,
    calendarChecked: availability.calendarChecked,
    reason: availability.reason || null,
    nextFreeAt: availability.nextFreeAt || null,
    message: availability.available
      ? `${lawyer.name} is available${availability.calendarChecked ? ' and has no calendar conflicts' : ' (based on business hours)'}.`
      : `${lawyer.name} is not available right now. ${availability.reason || ''}${availability.nextFreeAt ? ` They may be free around ${new Date(availability.nextFreeAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}.` : ''}`,
  };
}

async function persistParalegalHandoff(args: Record<string, unknown>, callOutcome: string) {
  const rawPhone = typeof args.callerPhone === 'string' ? args.callerPhone : (typeof args.phone === 'string' ? args.phone : '');
  const normalizedToolPhone = normalizeOptionalPhoneNumber(rawPhone) || '';
  const { state: capturedState } = await loadCapturedIntakeState(undefined, normalizedToolPhone);
  const callerName = typeof args.callerName === 'string' ? args.callerName : capturedState.callerName || 'Unknown';
  const callerPhone = normalizedToolPhone || capturedState.callerPhone || '';
  const callerEmail = typeof args.callerEmail === 'string' ? args.callerEmail : capturedState.callerEmail || '';
  const issue = typeof args.issue === 'string' ? args.issue : capturedState.issueSummary || '';
  const notes = typeof args.notes === 'string' ? args.notes : '';

  let client = callerPhone
    ? await prisma.client.findUnique({ where: { phone: callerPhone } })
    : null;

  if (!client && callerPhone) {
    client = await prisma.client.create({
      data: {
        name: callerName,
        phone: callerPhone,
        email: callerEmail || null,
        isCurrentClient: false,
      },
    });
  }

  let existing = callerPhone ? await prisma.callSession.findFirst({
    where: { callerPhone },
    orderBy: { createdAt: 'desc' },
  }) : null;

  if (!existing) {
    existing = await prisma.callSession.findFirst({
      where: { status: { in: ['active', 'completed'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  const sessionData = {
    ...(client?.id ? { clientId: client.id } : {}),
    ...(client ? { clientType: client.isCurrentClient ? 'current' : 'prospective' } : {}),
    callOutcome,
    ...(issue ? { summary: issue } : {}),
    ...(notes ? { notes } : {}),
    ...(callerPhone && !existing?.callerPhone ? { callerPhone } : {}),
  };

  const callSession = existing
    ? await prisma.callSession.update({
        where: { id: existing.id },
        data: sessionData,
      })
    : await prisma.callSession.create({
        data: {
          callId: `paralegal-handoff-${Date.now()}`,
          callerPhone,
          status: callOutcome === 'transferred' ? 'active' : 'completed',
          ...sessionData,
        },
      });

  return {
    success: true,
    callSessionId: callSession.id,
  };
}

async function handleGenerateTransferSummary(
  args: Record<string, unknown>,
  controlUrl?: string | null,
  activeCallId?: string
) {
  const transferTarget = getTransferTarget(args.transferTarget);
  const callbackMessage = resolveTransferCallbackMessage({
    transferTarget,
    callbackMessage: args.callbackMessage,
    message: args.message,
  });
  const liveTransfer = isLiveTransferEnabled(args.handoffMode, transferTarget);

  if (transferTarget === 'paralegal') {
    const handoffResult = await persistParalegalHandoff(args, liveTransfer ? 'transferred' : 'team_followup');

    if (liveTransfer) {
      const user = await prisma.user.findFirst({
        where: { transferPhoneNumber: { not: null } },
        select: { transferPhoneNumber: true },
      });
      const phoneNumber = user?.transferPhoneNumber || process.env.TRANSFER_PHONE_NUMBER || null;
      if (!phoneNumber) {
        return { ...handoffResult, liveTransfer: false, message: callbackMessage };
      }
      if (controlUrl) {
        try {
          await triggerVapiTransfer(
            controlUrl,
            { type: 'number', number: phoneNumber },
            getLiveTransferAnnouncement('paralegal'),
          );
          return {
            ...handoffResult,
            liveTransfer: true,
            transferred: true,
            destination: { type: 'number', number: phoneNumber },
          };
        } catch (error) {
          console.error('[vapi] Failed to trigger paralegal live transfer:', error);
          return {
            ...handoffResult,
            liveTransfer: false,
            transferTarget,
            message: callbackMessage,
          };
        }
      }
      return {
        ...handoffResult,
        liveTransfer: true,
        type: 'transfer',
        destination: {
          type: 'number',
          number: phoneNumber,
          message: getLiveTransferAnnouncement('paralegal'),
        },
      };
    }

    return {
      ...handoffResult,
      liveTransfer: false,
      transferTarget,
      message: callbackMessage,
    };
  }

  // Delegate to the shared summary handler which saves data and emails the lawyer
  const summaryResult = await handleGenerateSummary({ ...args }, activeCallId);

  if (!liveTransfer) {
    return {
      ...summaryResult,
      liveTransfer: false,
      transferTarget,
      message: summaryResult.success && summaryResult.emailDelivered !== false
        ? callbackMessage
        : summaryResult.message,
    };
  }

  // attorney path: find best matched attorney and transfer to their direct line
  const issueText = typeof args.issue === 'string' ? args.issue : '';
  const legalArea = identifyLegalArea(issueText || 'other');
  const lawyer = await findBestLawyer(legalArea);
  if (lawyer?.phone) {
    if (controlUrl) {
      try {
        await triggerVapiTransfer(controlUrl, { type: 'number', number: lawyer.phone });
        return {
          ...summaryResult,
          liveTransfer: true,
          transferred: true,
          transferTarget,
          destination: { type: 'number', number: lawyer.phone },
          lawyerName: lawyer.name,
        };
      } catch (error) {
        console.error('[vapi] Failed to trigger attorney live transfer:', error);
        return {
          ...summaryResult,
          liveTransfer: false,
          transferTarget,
          message: callbackMessage,
        };
      }
    }
    return {
      ...summaryResult,
      type: 'transfer',
      destination: {
        type: 'number',
        number: lawyer.phone,
        message: getLiveTransferAnnouncement('attorney'),
      },
    };
  }

  return {
    ...summaryResult,
    liveTransfer: false,
    transferTarget,
    message: callbackMessage,
  };
}

function normalizeTranscriptText(transcript: unknown): string {
  if (Array.isArray(transcript)) {
    return transcript
      .map((entry: any) => {
        const role = typeof entry?.role === 'string' ? entry.role : 'speaker';
        const content = typeof entry?.content === 'string'
          ? entry.content
          : typeof entry?.message === 'string'
          ? entry.message
          : '';
        return content ? `${role}: ${content}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }

  return typeof transcript === 'string' ? transcript : '';
}

function extractRecordingUrl(message: any): string | undefined {
  const recording = message?.artifact?.recording
    ?? message?.call?.artifact?.recording
    ?? message?.recording
    ?? message?.recordingUrl;

  const directUrl = message?.artifact?.recordingUrl
    ?? message?.call?.artifact?.recordingUrl
    ?? message?.artifact?.stereoRecordingUrl
    ?? message?.call?.artifact?.stereoRecordingUrl
    ?? message?.stereoRecordingUrl;

  if (typeof directUrl === 'string' && directUrl) {
    return directUrl;
  }

  if (typeof recording === 'string' && recording) {
    return recording;
  }

  if (recording && typeof recording === 'object') {
    const monoCombinedUrl = recording?.mono?.combinedUrl;
    if (typeof monoCombinedUrl === 'string' && monoCombinedUrl) {
      return monoCombinedUrl;
    }

    for (const key of ['recordingUrl', 'stereoRecordingUrl', 'stereoUrl', 'monoUrl', 'url', 'mp3Url', 'wavUrl']) {
      const value = recording[key];
      if (typeof value === 'string' && value) {
        return value;
      }
    }
  }

  return undefined;
}

async function deliverQueuedSummaryEmail(
  callSessionId: string,
  options: { intakeNotes?: string; transcriptText?: string; recordingUrl?: string }
) {
  const callSession = await prisma.callSession.findUnique({
    where: { id: callSessionId },
    include: {
      client: true,
      lawyer: true,
    },
  });

  if (!callSession || callSession.callOutcome !== 'summary_queued') {
    return;
  }

  if (!callSession.lawyer) {
    await prisma.callSession.update({
      where: { id: callSession.id },
      data: { callOutcome: 'summary_unassigned' },
    });
    console.error(`[vapi] No lawyer matched for queued summary call session ${callSession.id}`);
    return;
  }

  if (!callSession.lawyer.email) {
    await prisma.callSession.update({
      where: { id: callSession.id },
      data: { callOutcome: 'summary_delivery_failed' },
    });
    console.error(`[vapi] Lawyer ${callSession.lawyer.id} has no email address for queued summary call session ${callSession.id}`);
    return;
  }

  const emailResult = await sendCallSummaryEmail({
    callId: callSession.callId,
    lawyerEmail: callSession.lawyer.email,
    lawyerName: callSession.lawyer.name,
    callerName: callSession.client?.name || 'Unknown caller',
    callerPhone: callSession.callerPhone || '',
    callerEmail: callSession.client?.email || undefined,
    summary: callSession.summary || 'No summary available.',
    notes: options.intakeNotes,
    transcript: options.transcriptText,
    recordingUrl: options.recordingUrl,
    legalArea: callSession.legalArea || 'other',
    petitionType: callSession.petitionType || undefined,
    matterCategory: callSession.matterCategory || undefined,
    partyRole: callSession.partyRole || undefined,
    urgencyFlag: callSession.urgencyFlag || undefined,
  });

  if (!emailResult.success) {
    await prisma.callSession.update({
      where: { id: callSession.id },
      data: { callOutcome: 'summary_delivery_failed' },
    });
    console.error(`[vapi] Summary email delivery failed for queued call session ${callSession.id} to ${callSession.lawyer.email}: ${emailResult.error || 'Unknown error'}`);
    return;
  }

  await prisma.callSession.update({
    where: { id: callSession.id },
    data: { callOutcome: 'summary_sent' },
  });
}

async function handleGenerateSummary(args: Record<string, unknown>, activeCallId?: string) {
  const rawPhone = typeof args.callerPhone === 'string' ? args.callerPhone : (typeof args.phone === 'string' ? args.phone : '');
  const normalizedToolPhone = normalizeOptionalPhoneNumber(rawPhone) || '';
  const { state: capturedState } = await loadCapturedIntakeState(activeCallId, normalizedToolPhone);
  const callerName = typeof args.callerName === 'string' ? args.callerName : capturedState.callerName || 'Unknown';
  const callerPhone = normalizedToolPhone || capturedState.callerPhone || '';
  const callerEmail = typeof args.callerEmail === 'string' ? args.callerEmail : capturedState.callerEmail || '';
  const issue = typeof args.issue === 'string' ? args.issue : capturedState.issueSummary || '';
  const notes = typeof args.notes === 'string' ? args.notes : '';
  const petitionType = typeof args.petitionType === 'string' ? args.petitionType : undefined;
  const matterCategory = typeof args.matterCategory === 'string' ? args.matterCategory : undefined;
  const partyRole = typeof args.partyRole === 'string' ? args.partyRole : undefined;
  const urgencyFlag = typeof args.urgencyFlag === 'string' ? args.urgencyFlag : undefined;

  // Identify the right lawyer
  const legalArea = identifyLegalArea(issue);

  // Create or find client
  let client = await prisma.client.findUnique({ where: { phone: callerPhone } });
  if (!client && callerPhone) {
    client = await prisma.client.create({
      data: { name: callerName, phone: callerPhone, email: callerEmail || null, isCurrentClient: false },
    });
  }

  // Update existing call session or create new one
  // Try by phone first, then find the most recent active session as fallback
  let existing = activeCallId
    ? await prisma.callSession.findUnique({ where: { callId: activeCallId } })
    : null;

  if (!existing) {
    existing = callerPhone ? await prisma.callSession.findFirst({
      where: { callerPhone },
      orderBy: { createdAt: 'desc' },
    }) : null;
  }

  if (!existing) {
    // Fallback: find the most recent active/completed session (likely the current call)
    existing = await prisma.callSession.findFirst({
      where: { status: { in: ['active', 'completed'] } },
      orderBy: { createdAt: 'desc' },
    });
    // Use the existing session's callerPhone if we don't have one from the tool
    if (existing?.callerPhone && !callerPhone) {
      // Phone was captured from VAPI customer.number - use it
    }
  }

  const validationFlow = await loadFlowForSummaryValidation(existing?.intakeFlowId || null);
  const summaryReadiness = validateSummaryReadiness({
    flow: validationFlow,
    legalArea,
    issue,
    notes,
    petitionType,
    matterCategory,
    partyRole,
    urgencyFlag,
  });
  if (!summaryReadiness.ready) {
    console.warn(`[vapi] generateSummary blocked for incomplete branch in ${legalArea}: ${summaryReadiness.missingRequirements.join(', ')}`);
    return {
      success: false,
      continueIntake: true,
      deliveryStatus: 'incomplete_branch',
      legalArea,
      missingRequirements: summaryReadiness.missingRequirements,
      message: summaryReadiness.message,
    };
  }

  const lawyer = await findBestLawyer(legalArea);
  console.log(`[vapi] generateSummary accepted for ${legalArea}; matched lawyer: ${lawyer?.name || 'none'}`);

  // Use the VAPI-captured phone if the tool didn't provide a valid one
  const effectivePhone = callerPhone || existing?.callerPhone || '';

  const callSession = existing
    ? await prisma.callSession.update({
        where: { id: existing.id },
        data: {
          clientId: client?.id,
          clientType: 'prospective',
          callOutcome: 'summary_queued',
          legalArea,
          summary: issue,
          notes,
          lawyerId: lawyer?.id,
          ...(validationFlow?.id ? { intakeFlowId: validationFlow.id } : {}),
          ...(effectivePhone && !existing.callerPhone ? { callerPhone: effectivePhone } : {}),
          ...(petitionType  !== undefined ? { petitionType }  : {}),
          ...(matterCategory !== undefined ? { matterCategory } : {}),
          ...(partyRole     !== undefined ? { partyRole }     : {}),
          ...(urgencyFlag   !== undefined ? { urgencyFlag }   : {}),
        },
      })
    : await prisma.callSession.create({
        data: {
          callId: activeCallId || `summary-${Date.now()}`,
          callerPhone: effectivePhone,
          clientId: client?.id,
          clientType: 'prospective',
          callOutcome: 'summary_queued',
          legalArea,
          status: 'active',
          summary: issue,
          notes,
          lawyerId: lawyer?.id,
          ...(validationFlow?.id ? { intakeFlowId: validationFlow.id } : {}),
          ...(petitionType   !== undefined ? { petitionType }   : {}),
          ...(matterCategory !== undefined ? { matterCategory } : {}),
          ...(partyRole      !== undefined ? { partyRole }      : {}),
          ...(urgencyFlag    !== undefined ? { urgencyFlag }    : {}),
        },
      });

  if (!lawyer) {
    await prisma.callSession.update({
      where: { id: callSession.id },
      data: { callOutcome: 'summary_unassigned' },
    });
    console.error(`[vapi] No lawyer matched for summary call session ${callSession.id} in legal area ${legalArea}`);

    return {
      success: true,
      callSessionId: callSession.id,
      lawyerName: 'No lawyer assigned',
      lawyerId: null,
      legalArea,
      emailDelivered: false,
      deliveryStatus: 'no_lawyer_assigned',
      message: 'Your information has been recorded for internal follow-up. Our team will review your situation and reach out to you.',
    };
  }

  if (!lawyer.email) {
    await prisma.callSession.update({
      where: { id: callSession.id },
      data: { callOutcome: 'summary_delivery_failed' },
    });
    console.error(`[vapi] Lawyer ${lawyer.id} has no email address for summary call session ${callSession.id}`);

    return {
      success: true,
      callSessionId: callSession.id,
      lawyerName: lawyer.name,
      lawyerId: lawyer.id,
      legalArea,
      emailDelivered: false,
      deliveryStatus: 'lawyer_missing_email',
      message: `Your information has been recorded for ${lawyer.name}'s team, and they will review your situation and reach out to you.`,
    };
  }

  return {
    success: true,
    callSessionId: callSession.id,
    lawyerName: lawyer.name,
    lawyerId: lawyer.id,
    legalArea,
    emailDelivered: false,
    deliveryStatus: 'queued_until_call_end',
    message: `Your information has been recorded for ${lawyer.name}. They will review your situation and reach out to you.`,
  };
}

async function handleAdvanceActiveFlow(
  args: Record<string, unknown>,
  activeCallId?: string,
  fallbackCallerPhone?: string | null,
  controlUrl?: string | null,
  userId?: string,
) {
  const callerResponse = typeof args.callerResponse === 'string' ? args.callerResponse.trim() : '';
  if (!callerResponse) {
    return {
      success: false,
      message: 'No caller response was provided.',
    };
  }

  const activeFlow = await loadActiveFlow();
  const session = await findOrCreateCallSessionForActiveFlow(activeCallId, fallbackCallerPhone, activeFlow?.id || null);
  const flow = session.intakeFlowId
    ? await prisma.intakeFlow.findUnique({
        where: { id: session.intakeFlowId },
        include: {
          nodes: { orderBy: { sortOrder: 'asc' } },
          edges: { orderBy: { sortOrder: 'asc' } },
        },
      })
    : activeFlow;

  if (!flow) {
    return {
      success: false,
      message: 'No active intake flow is configured.',
    };
  }

  let runtimeRows: Array<{ fieldName: string; fieldValue: string; nodeId?: string | null }> = await loadFlowRuntimeRows(session.id);
  let runtimeState = hydrateFlowRuntimeState(runtimeRows);
  const postState = runtimeState.internalValues[FLOW_POST_STATE_KEY] || 'none';

  if (postState === FLOW_POST_STATE_AWAITING_ANYTHING_ELSE) {
    return handlePostFlowState(callerResponse, session.id, flow.id);
  }

  let pendingResponse: string | null = callerResponse;
  for (let guard = 0; guard < 40; guard += 1) {
    const progress = progressActiveFlow(flow, runtimeState, pendingResponse, {
      sessionCallerPhone: session.callerPhone,
      sessionClientType: normalizeClientStatusForFlow(session.clientType),
    });
    pendingResponse = null;

    if (progress.writes.length > 0) {
      await persistFlowRuntimeWrites(session.id, flow.id, progress.writes);
      runtimeRows = mergeRuntimeRows(runtimeRows, progress.writes);
      runtimeState = hydrateFlowRuntimeState(runtimeRows);
    }

    if (progress.kind === 'ask' || progress.kind === 'clarify') {
      return {
        success: true,
        step: progress.kind,
        assistantMessage: progress.assistantMessage,
        currentNodeLabel: progress.node.label,
      };
    }

    if (progress.kind === 'end') {
      await persistFlowRuntimeWrites(session.id, flow.id, [
        { fieldName: FLOW_POST_STATE_KEY, fieldValue: 'none' },
      ]);
      return {
        success: true,
        step: 'end',
        assistantMessage: progress.assistantMessage,
        endCallAfterSpeaking: true,
      };
    }

    if (progress.kind === 'transfer') {
      const transferResult: any = await handleGenerateTransferSummary(
        buildTransferSummaryArgs(runtimeState, session, progress.node.config || {}),
        controlUrl,
        activeCallId,
      );

      await persistFlowRuntimeWrites(session.id, flow.id, [
        { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: FLOW_COMPLETED_NODE_ID },
      ]);

      if (transferResult?.liveTransfer && transferResult?.transferred) {
        await persistFlowRuntimeWrites(session.id, flow.id, [
          { fieldName: FLOW_POST_STATE_KEY, fieldValue: 'none' },
        ]);
        return {
          success: true,
          step: 'live_transfer',
          transferred: true,
        };
      }

      await persistFlowRuntimeWrites(session.id, flow.id, [
        { fieldName: FLOW_POST_STATE_KEY, fieldValue: FLOW_POST_STATE_AWAITING_ANYTHING_ELSE },
      ]);

      return {
        success: true,
        step: 'say',
        assistantMessage: `${transferResult.message} Is there anything else I can help you with today?`,
      };
    }

    if (progress.kind === 'action') {
      const config = progress.node.config || {};

      if (config.actionType === 'set_flag') {
        const actionWrites = getFlowActionWrites(progress.node);
        const nextWrites: FlowRuntimeWrite[] = [
          ...actionWrites,
          { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: progress.nextNodeId || FLOW_COMPLETED_NODE_ID },
        ];
        await persistFlowRuntimeWrites(session.id, flow.id, nextWrites);
        runtimeRows = mergeRuntimeRows(runtimeRows, nextWrites);
        runtimeState = hydrateFlowRuntimeState(runtimeRows);

        const callSessionPatch: Record<string, any> = {};
        if (config.flagName === 'petitionType') callSessionPatch.petitionType = config.flagValue;
        if (config.flagName === 'matterCategory') callSessionPatch.matterCategory = config.flagValue;
        if (config.flagName === 'partyRole') callSessionPatch.partyRole = config.flagValue;
        if (config.flagName === 'urgencyFlag' || config.flagName === 'urgency_flag') callSessionPatch.urgencyFlag = config.flagValue;
        if (Object.keys(callSessionPatch).length > 0) {
          await prisma.callSession.update({
            where: { id: session.id },
            data: callSessionPatch,
          });
        }
        continue;
      }

      if (config.actionType === 'call_tool') {
        if (config.toolName === 'checkClient') {
          const checkResult = await handleCheckClient({
            name: getFlowCollectedValue(runtimeState, 'caller_name', 'callerName') || undefined,
            phone: getFlowCollectedValue(runtimeState, 'callback_phone', 'callerPhone') || session.callerPhone || undefined,
          });

          const toolWrites: FlowRuntimeWrite[] = [
            {
              fieldName: 'clientStatus',
              fieldValue: checkResult.isCurrentClient ? 'existing' : 'new',
              nodeId: progress.node.id,
            },
            {
              fieldName: FLOW_CURRENT_NODE_KEY,
              fieldValue: progress.nextNodeId || FLOW_COMPLETED_NODE_ID,
            },
          ];
          await persistFlowRuntimeWrites(session.id, flow.id, toolWrites);
          runtimeRows = mergeRuntimeRows(runtimeRows, toolWrites);
          runtimeState = hydrateFlowRuntimeState(runtimeRows);
          continue;
        }

        if (config.toolName === 'identifyLawyer') {
          const identifyResult = await handleIdentifyLawyer({
            legalIssueDescription: getFlowCollectedValue(runtimeState, 'issue_summary', 'issueSummary') || '',
          });

          const toolWrites: FlowRuntimeWrite[] = [
            ...(identifyResult.legalArea
              ? [{
                  fieldName: 'identified_legal_area',
                  fieldValue: identifyResult.legalArea,
                  nodeId: progress.node.id,
                } satisfies FlowRuntimeWrite]
              : []),
            ...(identifyResult.lawyerName
              ? [{
                  fieldName: 'identified_lawyer_name',
                  fieldValue: identifyResult.lawyerName,
                  nodeId: progress.node.id,
                } satisfies FlowRuntimeWrite]
              : []),
            {
              fieldName: FLOW_CURRENT_NODE_KEY,
              fieldValue: progress.nextNodeId || FLOW_COMPLETED_NODE_ID,
            },
          ];
          await persistFlowRuntimeWrites(session.id, flow.id, toolWrites);
          runtimeRows = mergeRuntimeRows(runtimeRows, toolWrites);
          runtimeState = hydrateFlowRuntimeState(runtimeRows);
          continue;
        }
      }

      if (config.actionType === 'book_appointment') {
        const bookingArgs = buildBookAppointmentArgs(runtimeState, session);
        if (!bookingArgs.preferredDate || !bookingArgs.preferredTime) {
          const retryQuestion = findPreviousQuestionNode(flow, progress.node.id);
          const retryWrites: FlowRuntimeWrite[] = [
            { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: retryQuestion?.id || progress.node.id },
          ];
          await persistFlowRuntimeWrites(session.id, flow.id, retryWrites);
          return {
            success: true,
            step: 'clarify',
            assistantMessage: retryQuestion?.config?.question || 'What day and time usually works best for a consultation?',
            currentNodeLabel: retryQuestion?.label || progress.node.label,
          };
        }

        const bookingResult = await handleBookAppointment(bookingArgs, userId || '');
        if (!bookingResult.success) {
          const retryQuestion = findPreviousQuestionNode(flow, progress.node.id);
          const retryWrites: FlowRuntimeWrite[] = [
            { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: retryQuestion?.id || progress.node.id },
          ];
          await persistFlowRuntimeWrites(session.id, flow.id, retryWrites);
          return {
            success: true,
            step: 'clarify',
            assistantMessage: bookingResult.message,
            currentNodeLabel: retryQuestion?.label || progress.node.label,
          };
        }

        const endNode: any = progress.nextNodeId
          ? flow.nodes.find((node: any) => node.id === progress.nextNodeId)
          : null;
        await persistFlowRuntimeWrites(session.id, flow.id, [
          { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: FLOW_COMPLETED_NODE_ID },
          { fieldName: FLOW_POST_STATE_KEY, fieldValue: 'none' },
        ]);
        return {
          success: true,
          step: 'end',
          assistantMessage: endNode?.type === 'end' && typeof endNode.config?.closingMessage === 'string'
            ? `${bookingResult.message} ${endNode.config.closingMessage}`.trim()
            : bookingResult.message,
          endCallAfterSpeaking: true,
        };
      }

      const fallbackWrites: FlowRuntimeWrite[] = [
        { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: progress.nextNodeId || FLOW_COMPLETED_NODE_ID },
      ];
      await persistFlowRuntimeWrites(session.id, flow.id, fallbackWrites);
      runtimeRows = mergeRuntimeRows(runtimeRows, fallbackWrites);
      runtimeState = hydrateFlowRuntimeState(runtimeRows);
      continue;
    }

    if (progress.kind === 'complete') {
      await persistFlowRuntimeWrites(session.id, flow.id, [
        { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: FLOW_COMPLETED_NODE_ID },
      ]);
      return {
        success: true,
        step: 'complete',
      };
    }
  }

  return {
    success: false,
    message: 'The flow runner exceeded its safety limit.',
  };
}

async function maybeDeliverInferredSummaryEmail(
  callSessionId: string,
  options: { transcriptText?: string; recordingUrl?: string; summary?: string | null },
) {
  const callSession = await prisma.callSession.findUnique({
    where: { id: callSessionId },
    include: {
      client: true,
      lawyer: true,
    },
  });

  if (!callSession) return;
  if (callSession.callOutcome === 'summary_queued' || callSession.callOutcome === 'summary_sent') return;

  const issue = options.summary || callSession.summary || '';
  if (!issue) return;

  const legalArea = identifyLegalArea(issue);
  if (legalArea === 'other') return;

  const validationFlow = await loadFlowForSummaryValidation(callSession.intakeFlowId || null);
  const summaryReadiness = validateSummaryReadiness({
    flow: validationFlow,
    legalArea,
    issue,
    notes: options.transcriptText || callSession.notes || '',
    petitionType: callSession.petitionType || undefined,
    matterCategory: callSession.matterCategory || undefined,
    partyRole: callSession.partyRole || undefined,
    urgencyFlag: callSession.urgencyFlag || undefined,
  });

  if (!summaryReadiness.ready) {
    console.warn(`[vapi] Skipping inferred summary email for ${callSession.callId}; branch still incomplete: ${summaryReadiness.missingRequirements.join(', ')}`);
    return;
  }

  const lawyer = await findBestLawyer(legalArea);
  if (!lawyer?.email) {
    console.warn(`[vapi] Skipping inferred summary email for ${callSession.callId}; no matched lawyer email for ${legalArea}`);
    return;
  }

  await prisma.callSession.update({
    where: { id: callSession.id },
    data: {
      callOutcome: 'summary_queued',
      summary: issue,
      legalArea,
      lawyerId: lawyer.id,
    },
  });

  console.log(`[vapi] Recovering missed summary email for ${callSession.callId} in ${legalArea} using end-of-call-report fallback`);
  await deliverQueuedSummaryEmail(callSession.id, {
    transcriptText: options.transcriptText,
    recordingUrl: options.recordingUrl,
  });
}

function validateSummaryReadiness(params: {
  flow?: {
    id?: string;
    nodes: Array<{ id: string; type: string; label: string; config?: any }>;
    edges: Array<{ id?: string; sourceNodeId: string; targetNodeId: string; label?: string | null; sortOrder?: number }>;
  } | null;
  legalArea: ReturnType<typeof identifyLegalArea>;
  issue: string;
  notes: string;
  petitionType?: string;
  matterCategory?: string;
  partyRole?: string;
  urgencyFlag?: string;
}) {
  if (params.flow) {
    const flowResult = validateFlowSummaryReadiness(params.flow, {
      issue: params.issue,
      notes: params.notes,
      petitionType: params.petitionType,
      matterCategory: params.matterCategory,
      partyRole: params.partyRole,
      urgencyFlag: params.urgencyFlag,
    });

    if (!flowResult.ready && flowResult.confidence === 'matched') {
      return {
        ready: false,
        missingRequirements: flowResult.missingRequirements,
        message: flowResult.message,
      };
    }
  }

  const combinedText = `${params.issue}\n${params.notes}`.toLowerCase();
  const hasAny = (patterns: RegExp[]) => patterns.some((pattern) => pattern.test(combinedText));

  if (params.legalArea === 'personal_injury') {
    const hasIncidentType = hasAny([
      /\bcar\b/, /\btruck\b/, /\bmotorcycle\b/, /\bvehicle\b/, /\baccident\b/, /\bcollision\b/, /\bcrash\b/,
      /\bslip\b/, /\bfall\b/, /\bdog bite\b/, /\bmalpractice\b/, /\bworkers?\s*comp\b/, /\bworkplace injury\b/,
      /\bdefective product\b/, /\bwrongful death\b/,
    ]);
    const hasTreatmentStatus = hasAny([
      /\btreatment\b/, /\btreated\b/, /\bdoctor\b/, /\bhospital\b/, /\ber\b/, /\burgent care\b/,
      /\bphysical therapy\b/, /\btherapy\b/, /\bactive treatment\b/, /\btreatment completed\b/,
      /\bno medical treatment\b/, /\bbroken\b/, /\binjur(?:y|ies)\b/, /\bhurt\b/,
    ]);
    const hasInsuranceOrRepresentation = hasAny([
      /\binsurance\b/, /\bclaim\b/, /\badjuster\b/, /\brepresentation\b/, /\battorney\b/, /\blawyer\b/,
      /\bno claim filed\b/, /\bclaim in progress\b/, /\bclaim was denied\b/, /\bhad an attorney\b/,
    ]);

    const missingRequirements = [
      ...(!hasIncidentType ? ['injury or accident type'] : []),
      ...(!hasTreatmentStatus ? ['medical treatment status or injury details'] : []),
      ...(!hasInsuranceOrRepresentation ? ['insurance claim or existing representation status'] : []),
    ];

    if (missingRequirements.length > 0) {
      return {
        ready: false,
        missingRequirements,
        message: `Continue the personal injury intake first. You still need to confirm ${missingRequirements.join(', ')} before generating the summary.`,
      };
    }
  }

  return {
    ready: true,
    missingRequirements: [] as string[],
    message: '',
  };
}

// ─── Main POST handler ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // Verify secret - warn only (matching ClientFlow pattern)
    const secret = req.headers.get('x-vapi-secret');
    if (!verifyVapiSecret(secret)) {
      console.warn('[vapi] secret mismatch - expected:', process.env.VAPI_WEBHOOK_SECRET ? 'SET' : 'NOT SET', 'received:', secret ? 'present' : 'missing');
    }

    const rawBody = await req.text();
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      console.error('VAPI webhook: invalid JSON body');
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const messageType = body?.message?.type;

    // Log EVERYTHING for debugging
    console.log(`[vapi] msgType=${messageType}`);
    console.log(`[vapi] body=${rawBody.slice(0, 400)}`);

    // Handle assistant-request: return assistant config
    if (messageType === 'assistant-request') {
      const t0 = Date.now();
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
      const serverUrl = `${appUrl}/api/webhooks/vapi`;
      // Identify which firm this call belongs to via VAPI phone number ID
      const reqPhoneNumberId = body?.message?.call?.phoneNumberId || body?.message?.call?.phoneNumber?.id;
      const firmUserId = await resolveUserId(reqPhoneNumberId);

      const firmUser = firmUserId ? await prisma.user.findUnique({
        where: { id: firmUserId },
        select: { transferPhoneNumber: true, assistantName: true, firmName: true },
      }) : null;

      const transferPhone  = firmUser?.transferPhoneNumber  || process.env.TRANSFER_PHONE_NUMBER || null;
      const assistantName  = firmUser?.assistantName  || '';
      const firmName       = firmUser?.firmName       || '';

      let systemPrompt: string;
      let flowFirstMessage: string | undefined;
      let activeFlowId: string | undefined;
      try {
        const result = await buildSystemPrompt(assistantName || undefined, firmName || undefined);
        systemPrompt = result.prompt;
        flowFirstMessage = result.firstMessage;
        activeFlowId = result.flowId;
      } catch (err) {
        console.error('[vapi] buildSystemPrompt failed:', err);
        systemPrompt = `You are a warm, professional AI paralegal receptionist for a law firm. Listen empathetically, ask for the caller's name and phone number, and help them schedule a consultation or take notes on their situation. Never give legal advice.`;
      }
      console.log(`[vapi] assistant-request prompt built in ${Date.now() - t0}ms`);

      const assistantCallId = body?.message?.call?.id;
      const assistantCallerPhone = body?.message?.call?.customer?.number;
      if (assistantCallId && activeFlowId) {
        await prisma.callSession.upsert({
          where: { callId: assistantCallId },
          create: {
            callId: assistantCallId,
            callerPhone: assistantCallerPhone ? normalizePhoneNumber(assistantCallerPhone) : null,
            intakeFlowId: activeFlowId,
          },
          update: {
            intakeFlowId: activeFlowId,
            ...(assistantCallerPhone ? { callerPhone: normalizePhoneNumber(assistantCallerPhone) } : {}),
          },
        });
      }

      // Use the flow's greeting as firstMessage if available, otherwise use default
      const defaultFirstMessage = assistantName
        ? `Thank you for calling our law firm. My name is ${assistantName}, how can I help you today?`
        : 'Thank you for calling our law firm. How can I help you today?';

      const assistant: any = {
        name: assistantName ? `${assistantName} - Begintake` : 'Begintake Intake Assistant',
        firstMessage: flowFirstMessage || defaultFirstMessage,
        artifactPlan: {
          recordingEnabled: true,
          transcriptPlan: {
            enabled: true,
            assistantName: assistantName || 'Begintake',
            userName: 'Caller',
          },
        },
        backgroundSpeechDenoisingPlan: {
          smartDenoisingPlan: {
            enabled: true,
          },
        },
        model: {
          provider: 'openai',
          model: 'gpt-5.2',
          temperature: 0.4,
          messages: [{ role: 'system', content: systemPrompt }],
          tools: [
            ...getToolDefinitions(),
            { type: 'endCall' },
          ],
        },
        server: {
          url: serverUrl,
        },
        transcriber: {
          provider: 'deepgram',
          model: 'flux-general-en',
          language: 'en',
          smartFormat: true,
          eotThreshold: 0.7,
          eotTimeoutMs: 5000,
        },
        voice: {
          provider: '11labs',
          voiceId: 'NDjuUGBKZhdOwAYMSat7',
          stability: 0.45,
          similarityBoost: 0.75,
        },
        startSpeakingPlan: {
          waitSeconds: 0.4,
        },
        stopSpeakingPlan: {
          numWords: 0,
          voiceSeconds: 0.2,
          backoffSeconds: 1,
        },
        voicemailDetection: {
          provider: 'vapi',
        },
        voicemailMessage: "Hi, you've reached our law firm. We missed your call but we'll get back to you as soon as possible. Please leave a message or call back during business hours.",
        silenceTimeoutSeconds: 60,
      };

      if (transferPhone && process.env.ENABLE_LIVE_CALL_TRANSFERS === 'true') {
        assistant.forwardingPhoneNumber = transferPhone;
      }

      // Log full response (minus system prompt to save space)
      const logAssistant = { ...assistant, model: { ...assistant.model, messages: ['[system prompt]'] } };
      console.log(`[vapi] RETURNING in ${Date.now() - t0}ms: ${JSON.stringify(logAssistant)}`);
      return NextResponse.json({ assistant });
    }

    // Handle tool-calls
    if (messageType === 'tool-calls') {
      const toolCalls = body?.message?.toolCallList || body?.message?.toolCalls || [];
      const callCustomerPhone = body?.message?.call?.customer?.number || '';
      const activeCallId = body?.message?.call?.id || undefined;
      const controlUrl = getVapiControlUrl(body?.message?.call);
      const vapiPhoneNumberId = body?.message?.call?.phoneNumberId || body?.message?.call?.phoneNumber?.id || undefined;
      const userId = await resolveUserId(vapiPhoneNumberId) ?? '';
      const results = [];

      for (const toolCall of toolCalls) {
        const name = toolCall?.function?.name;
        const args = parseToolArguments(toolCall?.function?.arguments);
        // Inject caller phone from VAPI call if tool didn't provide one
        if (!args.callerPhone && !args.phone && callCustomerPhone) {
          args.callerPhone = callCustomerPhone;
          args.phone = callCustomerPhone;
        }
        const toolCallId = toolCall?.id;

        let result;
        switch (name) {
          case 'captureIntakeState':
            result = await handleCaptureIntakeState(args, activeCallId, callCustomerPhone);
            break;
          case 'advanceActiveFlow':
            result = await handleAdvanceActiveFlow(args, activeCallId, callCustomerPhone, controlUrl, userId);
            break;
          case 'checkClient':
            result = await handleCheckClient(args);
            break;
          case 'identifyLawyer':
            result = await handleIdentifyLawyer(args);
            break;
          case 'transferCall':
            result = await handleTransferCall(args);
            if (result?.type === 'transfer' && controlUrl && result.destination?.type === 'number' && typeof result.destination?.number === 'string') {
              try {
                await triggerVapiTransfer(controlUrl, { type: 'number', number: result.destination.number });
                result = {
                  success: true,
                  liveTransfer: true,
                  transferred: true,
                  destination: { type: 'number', number: result.destination.number },
                };
              } catch (error) {
                console.error('[vapi] Failed to trigger transferCall live transfer:', error);
                result = {
                  success: false,
                  liveTransfer: false,
                  message: 'Live transfer could not be completed. Let the caller know the team will follow up.',
                };
              }
            }
            break;
          case 'scheduleConsultation':
            result = await handleBookAppointment(args, userId);
            break;
          case 'checkAttorneyAvailability':
            result = await handleCheckAttorneyAvailability(args, userId);
            break;
          case 'generateTransferSummary':
            result = await handleGenerateTransferSummary(args, controlUrl, activeCallId);
            break;
          case 'generateSummary':
            result = await handleGenerateSummary(args, activeCallId);
            break;
          default:
            result = { error: `Unknown tool: ${name}` };
        }

        results.push({ toolCallId, result: JSON.stringify(result) });
      }

      return NextResponse.json({ results });
    }

    // Handle status-update - create or update call session
    if (messageType === 'status-update') {
      const status = body?.message?.status;
      const callId = body?.message?.call?.id;
      const callerPhone = body?.message?.call?.customer?.number;
      const endedReason = body?.message?.endedReason;

      if (callId) {
        const isForwarded = endedReason === 'assistant-forwarded-call';
        const forwardNumber = body?.message?.call?.forwardingPhoneNumber || null;

        await prisma.callSession.upsert({
          where: { callId },
          create: {
            callId,
            callerPhone: callerPhone ? normalizePhoneNumber(callerPhone) : null,
            status: status === 'ended' ? 'completed' : 'active',
            transferred: isForwarded,
            transferredTo: isForwarded ? forwardNumber : null,
            endedAt: status === 'ended' ? new Date() : null,
          },
          update: {
            ...(status === 'ended' && { status: 'completed', endedAt: new Date() }),
            ...(isForwarded && { transferred: true, transferredTo: forwardNumber }),
          },
        });
      }

      return NextResponse.json({ received: true });
    }

    // Handle end-of-call-report - always create/update
    if (messageType === 'end-of-call-report') {
      const callId = body?.message?.call?.id;
      const callerPhone = body?.message?.call?.customer?.number;
      const summary = body?.message?.summary;
      const transcript = body?.message?.artifact?.transcript ?? body?.message?.transcript;
      const recordingUrl = extractRecordingUrl(body?.message);

      if (callId) {
        const existingSession = await prisma.callSession.findUnique({
          where: { callId },
        });
        const intakeNotes = existingSession?.notes || undefined;
        const transcriptText = normalizeTranscriptText(transcript);

        // Infer labels from summary if not already set by tools
        const inferredLegalArea = summary ? identifyLegalArea(summary) : null;
        const inferredOutcome = summary
          ? summary.toLowerCase().includes('schedul') ? 'consultation_scheduled'
          : summary.toLowerCase().includes('summary') || summary.toLowerCase().includes('notes') ? 'summary_sent'
          : summary.toLowerCase().includes('transfer') ? 'transferred'
          : 'general_inquiry'
          : null;

        await prisma.callSession.upsert({
          where: { callId },
          create: {
            callId,
            callerPhone: callerPhone ? normalizePhoneNumber(callerPhone) : null,
            summary: summary || existingSession?.summary || null,
            notes: transcriptText || existingSession?.notes || null,
            clientType: 'prospective',
            callOutcome: existingSession?.callOutcome || inferredOutcome,
            legalArea: inferredLegalArea !== 'other' ? inferredLegalArea : null,
            status: 'completed',
            endedAt: new Date(),
          },
          update: {
            summary: summary || undefined,
            notes: transcriptText || undefined,
            status: 'completed',
            endedAt: new Date(),
          },
        });

        const finalSession = await prisma.callSession.findUnique({
          where: { callId },
        });

        if (finalSession?.callOutcome === 'summary_queued') {
          await deliverQueuedSummaryEmail(finalSession.id, {
            intakeNotes,
            transcriptText,
            recordingUrl,
          });
        } else if (finalSession) {
          await maybeDeliverInferredSummaryEmail(finalSession.id, {
            transcriptText,
            recordingUrl,
            summary,
          });
        }

        // Fill in missing labels from summary if tools didn't set them
        if (summary) {
          try {
            await prisma.$executeRaw`
              UPDATE "CallSession"
              SET "callOutcome" = COALESCE("callOutcome", ${inferredOutcome || 'general_inquiry'}),
                  "legalArea" = COALESCE("legalArea", ${inferredLegalArea !== 'other' ? inferredLegalArea : null}),
                  "clientType" = COALESCE("clientType", 'prospective')
              WHERE "callId" = ${callId}
            `;
          } catch { /* fields may not exist yet */ }
        }
      }

      return NextResponse.json({ received: true });
    }

    // Handle call start - create session
    if (messageType === 'call-start' || messageType === 'call_started') {
      const callId = body?.message?.call?.id || body?.call?.id;
      const callerPhone = body?.message?.call?.customer?.number || body?.call?.customer?.number;

      if (callId) {
        const activeFlow = await loadActiveFlow();
        await prisma.callSession.upsert({
          where: { callId },
          create: {
            callId,
            callerPhone: callerPhone ? normalizePhoneNumber(callerPhone) : null,
            status: 'active',
            intakeFlowId: activeFlow?.id || null,
          },
          update: {
            ...(activeFlow?.id ? { intakeFlowId: activeFlow.id } : {}),
          },
        });
      }

      return NextResponse.json({ received: true });
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('VAPI webhook error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
