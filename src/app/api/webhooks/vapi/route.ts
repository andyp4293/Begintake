import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizePhoneNumber, normalizeOptionalPhoneNumber } from '@/lib/phone';
import { verifyVapiSecret, parseToolArguments } from '@/lib/vapi';
import { identifyLegalArea, identifyLegalAreaMatch, findBestLawyer } from '@/lib/lawyer-matcher';
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
  type SemanticAnswerIntent,
  type SemanticConversationFit,
  type SemanticPostCallIntent,
  type SemanticQuestionState,
  type SemanticCallerFacts,
  type FlowRuntimeWrite,
} from '@/lib/active-flow-runner';
import {
  getDefaultTransferCallbackMessage,
  getLiveTransferAnnouncement,
  getTransferTarget,
  isLiveTransferEnabled,
  resolveTransferCallbackMessage,
} from '@/lib/transfer-handoff';
import { normalizeTranscriptTextWithSpeakerLabels } from '@/lib/transcript-speakers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ASSISTANT_REQUEST_CACHE_TTL_MS = 5 * 60 * 1000;
const ASSISTANT_REQUEST_FAST_TIMEOUT_MS = 1000;

type FirmRuntimeContext = {
  userId: string | null;
  transferPhone: string | null;
  assistantName: string;
  firmName: string;
};

type AssistantRequestRuntimeContext = {
  fetchedAt: number;
  flowId?: string;
  prompt: string;
  firstMessage?: string;
  firm: FirmRuntimeContext;
};

const globalForAssistantRequest = globalThis as unknown as {
  assistantRequestContextCache?: Map<string, AssistantRequestRuntimeContext>;
};

const assistantRequestContextCache =
  globalForAssistantRequest.assistantRequestContextCache ??
  new Map<string, AssistantRequestRuntimeContext>();

if (!globalForAssistantRequest.assistantRequestContextCache) {
  globalForAssistantRequest.assistantRequestContextCache = assistantRequestContextCache;
}

// ─── System prompt for the AI paralegal ──────────────────────────────────────

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const LEADING_FILLER_PATTERNS = [
  /^(?:okay[,.!\s]+)?(?:give me a moment|give me a second|give me a sec|one moment|just a sec|just a second|hold on(?: a sec| a second)?|hang on(?: a sec| a second)?|this(?:'ll| will)? just take a sec|let me check|let me see)\b[,:;.!-]*\s*/i,
];

function stripLeadingFillers(text: string): string {
  let current = text.trim();
  if (!current) return current;

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of LEADING_FILLER_PATTERNS) {
      const next = current.replace(pattern, '').trim();
      if (next !== current) {
        current = next;
        changed = true;
      }
    }
  }

  return current;
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
    return nextQuestion ? stripLeadingFillers(nextQuestion) : undefined;
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
    return stripLeadingFillers(trimmedGreeting);
  }

  const separator = /[.?!]\s*$/.test(trimmedGreeting) ? ' ' : '. ';
  return stripLeadingFillers(`${trimmedGreeting}${separator}${trimmedQuestion}`);
}

function getSortedEdgesFromNode(flow: any, nodeId: string) {
  return flow.edges
    .filter((edge: any) => edge.sourceNodeId === nodeId)
    .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

function getNodeQuestionText(node: any): string | null {
  return typeof node?.config?.question === 'string' && node.config.question.trim()
    ? node.config.question.trim()
    : null;
}

function findOpeningQuestion(flow: any, startNode: any): string | null {
  const firstEdge = getSortedEdgesFromNode(flow, startNode.id)[0];
  const firstNode = firstEdge
    ? flow.nodes.find((node: any) => node.id === firstEdge.targetNodeId)
    : null;
  return getNodeQuestionText(firstNode);
}

function buildExactToolCallMessage(content: string, options?: { endCallAfterSpokenEnabled?: boolean }) {
  return {
    type: 'request-complete',
    role: 'assistant',
    content,
    ...(options?.endCallAfterSpokenEnabled ? { endCallAfterSpokenEnabled: true } : {}),
  };
}

function getAssistantRequestCacheKey(vapiPhoneNumberId?: string): string {
  return vapiPhoneNumberId?.trim() || '__default__';
}

function getCachedAssistantRequestContext(vapiPhoneNumberId?: string): AssistantRequestRuntimeContext | null {
  const cacheKey = getAssistantRequestCacheKey(vapiPhoneNumberId);
  const cached = assistantRequestContextCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > ASSISTANT_REQUEST_CACHE_TTL_MS) {
    assistantRequestContextCache.delete(cacheKey);
    return null;
  }
  return cached;
}

function setCachedAssistantRequestContext(vapiPhoneNumberId: string | undefined, value: AssistantRequestRuntimeContext) {
  assistantRequestContextCache.set(getAssistantRequestCacheKey(vapiPhoneNumberId), value);
}

function buildFallbackFirmRuntimeContext(): FirmRuntimeContext {
  return {
    userId: null,
    transferPhone: process.env.TRANSFER_PHONE_NUMBER || null,
    assistantName: '',
    firmName: '',
  };
}

function buildGenericActiveFlowPrompt(assistantName?: string, firmName?: string): string {
  const resolvedName = assistantName?.trim() || 'Aria';
  const resolvedFirm = firmName?.trim() || 'our law firm';
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `You are ${resolvedName}, an AI intake receptionist for ${resolvedFirm}.
Today is ${today}.

FOLLOW THIS SCRIPT EXACTLY.
ABSOLUTE RULE: never say filler phrases like "hold on a sec", "give me a moment", "just a sec", "one moment", or "this will take a sec."
ACTIVE FLOW CONTROL: after EVERY caller answer, silently call advanceActiveFlow with the caller's exact latest response.
Do NOT choose the next scripted question, branch, transfer, or scheduling step yourself. The server-owned flow runner decides that for you.
When the caller answered the current question in natural language, include matchedChoiceLabel in advanceActiveFlow with a short semantic summary of the branch they most likely meant.
When the caller clearly reveals or corrects a core fact like new versus existing client, for themselves versus someone else, their name, callback number, email, issue summary, or post-summary intent, include those in semanticFacts even if they came out of order.
If the caller is correcting something they said earlier, set semanticFacts.answerIntent to "correction". If the same turn both answers the current question and corrects earlier info, set it to "both".
If the caller clearly sounds like they are not trying to reach a law firm at all, include semanticFacts.conversationFit as "wrong_number". If they clearly are describing a real legal problem, include semanticFacts.conversationFit as "legal_intake".
After the summary or handoff stage, if the caller clearly sounds done, is asking a follow-up timing question, or urgently wants a real person now, include semanticFacts.postCallIntent with the closest intent.
If advanceActiveFlow returns step="ask", step="clarify", or step="say", say the returned assistantMessage exactly and do not improvise a different scripted question.
If advanceActiveFlow returns speakExactly=true, your very next spoken output must be the returned assistantMessage verbatim, with no prefix, suffix, hesitation, or filler words.
If advanceActiveFlow returns step="live_transfer", stop speaking and let the live transfer happen.
If advanceActiveFlow returns endCallAfterSpeaking=true, say the returned assistantMessage and then immediately call endCall.
Ask each question one at a time. Wait for answers before proceeding.
Keep ALL responses under 2 sentences - this is a phone call.
NEVER give legal advice. You are an intake assistant, not an attorney.
Be empathetic and calm, but do not overdo apology language.
Assume many callers do not know legal procedure or legal labels. If they are unsure, ask a short plain-English follow-up that gets the same information instead of insisting on formal legal terminology.
Sound like a calm front-desk receptionist, not a form, script reader, or decision tree.
Call tools silently.
Before every tool call, say nothing at all. The correct spoken content before a tool call is silence.
Do NOT skip ahead to a summary, transfer, or goodbye unless the flow runner tells you to.`;
}

function buildGenericActiveFlowFirstMessage(assistantName?: string, firmName?: string): string {
  const resolvedName = assistantName?.trim() || 'Aria';
  const resolvedFirm = firmName?.trim() || 'our law firm';
  return `Thank you for calling ${resolvedFirm}. I am the AI assistant, ${resolvedName}, and I'll ask you a few questions to figure out how we can best help you. You may request to get transferred to a paralegal at any time. Shall we get started?`;
}

function getToolCallSpokenMessage(toolCallId: string | undefined, name: string | undefined, result: any) {
  if (!result || typeof result !== 'object') return undefined;
  if (!toolCallId || !name) return undefined;
  if (result.step === 'live_transfer') return undefined;
  if (result.speakExactly !== true) return undefined;
  if (typeof result.assistantMessage !== 'string' || !result.assistantMessage.trim()) return undefined;
  const spokenText = stripLeadingFillers(result.assistantMessage);
  if (!spokenText) return undefined;

  return buildExactToolCallMessage(spokenText, {
    endCallAfterSpokenEnabled: result.endCallAfterSpeaking === true,
  });
}

function sanitizeToolResultForModel(name: string | undefined, result: any, hasExactSpokenMessage: boolean) {
  if (!result || typeof result !== 'object') return result;
  if (!hasExactSpokenMessage) return result;

  if (name === 'advanceActiveFlow') {
    const {
      assistantMessage: _assistantMessage,
      speakExactly: _speakExactly,
      endCallAfterSpeaking: _endCallAfterSpeaking,
      ...rest
    } = result;

    return {
      ...rest,
      spokenByTool: true,
    };
  }

  return result;
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

async function resolveFirmRuntimeContext(vapiPhoneNumberId?: string): Promise<FirmRuntimeContext> {
  if (vapiPhoneNumberId) {
    const matchedUser = await prisma.user.findFirst({
      where: { vapiPhoneNumberId },
      select: { id: true, transferPhoneNumber: true, assistantName: true, firmName: true },
    });
    if (matchedUser) {
      return {
        userId: matchedUser.id,
        transferPhone: matchedUser.transferPhoneNumber || process.env.TRANSFER_PHONE_NUMBER || null,
        assistantName: matchedUser.assistantName?.trim() || '',
        firmName: matchedUser.firmName?.trim() || '',
      };
    }
  }

  const fallbackUser = await prisma.user.findFirst({
    select: { id: true, transferPhoneNumber: true, assistantName: true, firmName: true },
  });

  return {
    userId: fallbackUser?.id ?? null,
    transferPhone: fallbackUser?.transferPhoneNumber || process.env.TRANSFER_PHONE_NUMBER || null,
    assistantName: fallbackUser?.assistantName?.trim() || '',
    firmName: fallbackUser?.firmName?.trim() || '',
  };
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
      const nextQuestion = startNode ? findOpeningQuestion(activeFlow, startNode) : null;
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
- The live transfer itself will say exactly: "Of course. I'll transfer you to our team right away."
- Do not add any filler like "hold on", "hold on a sec", "just a sec", or "one moment" before the tool call.
- Do not say anything else unless the transfer fails.

IF PROSPECTIVE CLIENT (not in our system):
- Continue the normal intake flow. Do NOT transfer them to the paralegal just because they are new.

REQUESTS FOR A REAL PERSON:
- If the caller says "talk to a person", "real person", "human", "paralegal", "manager", "transfer", "connect me", or similar during the intake, immediately call generateTransferSummary with transferTarget="paralegal" and handoffMode="live_transfer".
- The live transfer itself will say exactly: "Of course. I'll transfer you to our team right away."
- If the live transfer fails, let the caller know our team will call them back at the best callback number you have for them, then end the call.
- After the summary stage, do NOT offer or attempt a live paralegal transfer. If they still want a person then, let them know their information has been flagged for team follow-up and end the call.

ENDING THE CALL:
- When the caller says "no", "nope", "nothing else", "that's all", "I'm good", "goodbye", "bye", or anything similar indicating they're done:
  1. Say: "Thank you for calling! Have a wonderful day. Goodbye!"
  2. Immediately call the endCall tool. Do NOT keep talking after saying goodbye.
- You MUST call endCall after saying goodbye. The call will NOT end unless you call endCall.
- Never combine the goodbye with other information - keep it as its own separate message.

IMPORTANT RULES:
- ABSOLUTE RULE: never say filler phrases like "hold on a sec", "give me a moment", "just a sec", "one moment", or "this will take a sec."
- NEVER give legal advice. You are a paralegal, not an attorney.
- Be empathetic. People calling a law firm are often stressed or scared.
- Be warm and empathetic, but do not overuse apology language. Do not keep repeating phrases like "I'm sorry" or "sorry to hear that" on every turn.
- If the caller shares something difficult, acknowledge it naturally once, then continue the intake without repeating the same sympathy phrase over and over.
- When the caller first explains the problem, sound like a calm human receptionist: briefly acknowledge it in a natural way, then move into the next question without becoming robotic.
- Assume many callers do not know legal procedure, legal labels, or what stage their matter is in. If they are unsure, ask a short plain-English follow-up that gets the same information instead of insisting on formal legal terminology.
- If the caller asks a short follow-up question about the exact term or concept you just asked about, answer it briefly in plain English and then return to that same question.
- Only answer follow-up questions when they clearly relate to the current intake step or the caller's legal situation. Do not drift into unrelated Q&A, small talk, or legal advice.
- Sound like a calm front-desk receptionist, not a form, script reader, or decision tree.
- Keep ALL responses under 2 sentences - this is a phone call, be brief.
- Call tools silently. Never say their tool names aloud.
- Whenever the caller clearly provides their name, callback number, email, whether they are new or existing, whether they are calling for themselves or someone else, or their core issue, silently call captureIntakeState with every slot you now know.
- Before every tool call, say nothing at all. The correct spoken content before a tool call is silence.
- Do NOT add filler like "one moment", "hold on", "hold on a sec", "just a sec", or "let me check" before calling a tool.
- Once the caller has already confirmed their callback number, name, email, or whether they are calling for themselves, do not ask that same question again unless they corrected you or you genuinely did not understand them.
- If the caller volunteers answers to later intake questions early, capture those facts immediately and skip the later duplicate questions instead of re-asking them.
- If one caller response answers multiple intake slots at once, treat every clearly answered slot as captured and move to the first still-unanswered question.
- If the caller gives a plausible direct answer to the current question - like a name, "first time", "for myself", or "yes, this number is fine" - treat it as sufficient and move on instead of repeating or confirming the same question.
- If the caller says "hello?" or asks if you are still there, briefly reassure them and resume the current unanswered question. Do not restart the intake or reconfirm earlier answers.
- If the caller is clearly trying to reach a non-legal business or service that does not fit a law firm at all, politely tell them they have reached a law firm and likely have the wrong number instead of forcing them through intake.
- If the caller clearly has no idea, needs a plain-English explanation, wants to skip or move on from the current question, or goes off-topic for the current question, treat that meaning as important context instead of repeating the same question forever.
- If the caller turns into an obvious prank, scam, wrong-number, or non-legal business call at any point, stop forcing the intake and treat it as a wrong-number situation.
- If the caller says they were scammed by, defrauded by, or harmed by a business or impersonator, that is still a legal intake, not a wrong-number call.
- If you need clarification, restate the question naturally and let the caller answer in their own words. Do not turn the call into a rigid multiple-choice quiz unless they remain confused.
- If the caller sounds confused about legal labels or choices, explain the difference in plain English and ask for whichever option is closest instead of repeating the same legal-language question word-for-word.
- If the caller gives a vague, noisy, or non-routable answer to the open-ended issue question, do not invent a legal category or subtype yet. Treat it as still unclear and ask for a plain-English explanation of what happened.
- Do not invent extra follow-up questions after you already have the scripted answer you need. Move to the next intake question.
- Never read IDs aloud; they are internal references only.
- If you don't know the answer, say "I'll make sure the right person on our team follows up with you."` };
}

async function prepareAssistantRequestRuntimeContext(vapiPhoneNumberId?: string): Promise<AssistantRequestRuntimeContext> {
  const firm = await resolveFirmRuntimeContext(vapiPhoneNumberId);
  const promptResult = await buildSystemPrompt(firm.assistantName || undefined, firm.firmName || undefined);

  const context: AssistantRequestRuntimeContext = {
    fetchedAt: Date.now(),
    flowId: promptResult.flowId,
    prompt: promptResult.prompt,
    firstMessage: promptResult.firstMessage,
    firm,
  };

  setCachedAssistantRequestContext(vapiPhoneNumberId, context);
  return context;
}

async function getAssistantRequestRuntimeContextFast(vapiPhoneNumberId?: string): Promise<{
  context: AssistantRequestRuntimeContext;
  source: 'cache' | 'full' | 'fast-fallback';
}> {
  const cached = getCachedAssistantRequestContext(vapiPhoneNumberId);
  if (cached) {
    return { context: cached, source: 'cache' };
  }

  const fallbackFirm = buildFallbackFirmRuntimeContext();
  const fallbackContext: AssistantRequestRuntimeContext = {
    fetchedAt: Date.now(),
    flowId: undefined,
    prompt: buildGenericActiveFlowPrompt(fallbackFirm.assistantName || undefined, fallbackFirm.firmName || undefined),
    firstMessage: buildGenericActiveFlowFirstMessage(fallbackFirm.assistantName || undefined, fallbackFirm.firmName || undefined),
    firm: fallbackFirm,
  };

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const fullPromise = prepareAssistantRequestRuntimeContext(vapiPhoneNumberId)
    .then((context) => ({ context, source: 'full' as const }))
    .catch((error) => {
      console.error('[vapi] assistant-request context load failed:', error);
      return null;
    });

  const timeoutPromise = new Promise<{
    context: AssistantRequestRuntimeContext;
    source: 'fast-fallback';
  }>((resolve) => {
    timeoutHandle = setTimeout(() => {
      resolve({
        context: fallbackContext,
        source: 'fast-fallback',
      });
    }, ASSISTANT_REQUEST_FAST_TIMEOUT_MS);
  });

  const result = await Promise.race([fullPromise, timeoutPromise]);
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }

  if (result && result.source === 'full') {
    return result;
  }

  return {
    context: fallbackContext,
    source: 'fast-fallback',
  };
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

function getToolDefinitions(options?: { activeFlow?: boolean }) {
  const includeCaptureIntakeState = !options?.activeFlow;
  const buildFunctionTool = (definition: Record<string, unknown>) => ({
    type: 'function',
    messages: [
      { type: 'request-start', content: '' },
      { type: 'request-response-delayed', content: '' },
    ] as unknown[],
    function: definition,
  });

  return [
    ...(includeCaptureIntakeState ? [buildFunctionTool({
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
      })] : []),
    buildFunctionTool({
        name: 'advanceActiveFlow',
        description: 'Server-owned intake flow runner. After each caller answer on an active flow, call this silently with the latest caller response so the server can decide the next step, skip already-answered questions, and complete handoff or scheduling actions. Do not say any filler before or after this tool call. If the caller answered the current question in natural language, include a short semantic summary of the branch they most likely meant. If the caller also revealed or corrected core facts like new versus existing client, self versus someone else, name, callback number, email, or issue summary, include those in semanticFacts. If the caller clearly has no idea, needs a plain-English explanation, wants to skip or move on from the current question, or has gone off-topic for the current question, include semanticFacts.questionState. If the caller clearly sounds like they are not trying to reach a law firm at all, include semanticFacts.conversationFit as wrong_number. After the summary or handoff stage, if the caller clearly sounds done, is asking a follow-up timing question, or urgently wants a real person now, include semanticFacts.postCallIntent.',
        parameters: {
          type: 'object',
          properties: {
            callerResponse: { type: 'string', description: 'The caller’s exact latest answer in plain language.' },
            matchedChoiceLabel: { type: 'string', description: 'Optional semantic summary of which branch or response the caller most likely meant for the current question, even if they did not say the exact option words.' },
            semanticFacts: {
              type: 'object',
              description: 'Optional structured understanding of any core facts the caller clearly revealed or corrected in this turn, even if they answered out of order.',
              properties: {
                answerIntent: { type: 'string', enum: ['current_question', 'correction', 'both', 'unclear'], description: 'Whether this caller response mainly answered the current question, corrected earlier info, did both, or was unclear.' },
                questionState: { type: 'string', enum: ['answered', 'uncertain', 'needs_explanation', 'wants_to_skip', 'off_topic', 'unclear'], description: 'Whether the caller clearly answered the current question, is unsure, needs a plain-English explanation, wants to skip or move on, has gone off-topic for the current question, or is still unclear.' },
                conversationFit: { type: 'string', enum: ['legal_intake', 'wrong_number', 'unclear'], description: 'Whether this sounds like a genuine legal intake call, a wrong-number or non-legal business call, or is still unclear.' },
                postCallIntent: { type: 'string', enum: ['done', 'follow_up_question', 'urgent_transfer', 'continue', 'unclear'], description: 'After the summary stage, whether the caller sounds done, is asking a follow-up question, urgently wants a real person now, wants to continue the conversation, or is still unclear.' },
                callerName: { type: 'string', description: 'Caller full name if clear from the latest response.' },
                callerPhone: { type: 'string', description: 'Best callback phone number if clear from the latest response.' },
                callerEmail: { type: 'string', description: 'Caller email if clear from the latest response.' },
                clientStatus: { type: 'string', enum: ['new', 'existing'], description: 'Whether the caller is a new or existing client, if clear from the latest response.' },
                callingFor: { type: 'string', enum: ['self', 'other'], description: 'Whether the caller is calling for themselves or someone else, if clear from the latest response.' },
                issueSummary: { type: 'string', description: 'The caller’s issue in plain language if they revealed or clarified it in this turn.' },
              },
              required: [],
            },
          },
          required: ['callerResponse'],
        },
      }),
    buildFunctionTool({
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
      }),
    buildFunctionTool({
        name: 'identifyLawyer',
        description: 'Identify the best lawyer for a legal issue based on description',
        parameters: {
          type: 'object',
          properties: {
            legalIssueDescription: { type: 'string', description: 'Description of the legal issue' },
          },
          required: ['legalIssueDescription'],
        },
      }),
    buildFunctionTool({
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
      }),
    buildFunctionTool({
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
      }),
    buildFunctionTool({
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
      }),
    buildFunctionTool({
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
      }),
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

async function resolveAssistantNameForCall(vapiPhoneNumberId?: string): Promise<string | undefined> {
  if (vapiPhoneNumberId) {
    const matchedUser = await prisma.user.findFirst({
      where: { vapiPhoneNumberId },
      select: { assistantName: true },
    });
    const matchedAssistantName = matchedUser?.assistantName?.trim();
    if (matchedAssistantName) {
      return matchedAssistantName;
    }
  }

  const fallbackUser = await prisma.user.findFirst({
    select: { assistantName: true },
  });

  return fallbackUser?.assistantName?.trim() || undefined;
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

async function loadCapturedIntakeState(activeCallId?: string, callerPhone?: string | null): Promise<{ sessionId: string | null; sessionCallerPhone: string | null; state: CapturedIntakeState }> {
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
    return { sessionId: null, sessionCallerPhone: null, state: {} };
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

  return { sessionId: session.id, sessionCallerPhone: session.callerPhone || null, state };
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
  let entries = COMMON_CAPTURED_FIELDS
    .map((fieldName) => {
      const value = normalizeCapturedFieldValue(fieldName, args[fieldName]);
      return value
        ? {
            fieldName,
            fieldValue: value,
          }
        : null;
    })
    .filter((entry): entry is { fieldName: CapturedFieldName; fieldValue: string } => Boolean(entry));

  entries = entries.filter((entry) => {
    if (entry.fieldName === 'callerPhone' && fallbackCallerPhone) {
      const normalizedFallback = normalizeOptionalPhoneNumber(fallbackCallerPhone) || fallbackCallerPhone;
      if (entry.fieldValue === normalizedFallback) {
        return false;
      }
    }

    if (entry.fieldName === 'issueSummary') {
      const text = entry.fieldValue.trim();
      const match = identifyLegalAreaMatch(text);
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      const hasIssueLeadIn = /\b(about|regarding|because|going through|dealing with|need help|help with|calling about|issue is|problem is|matter is)\b/i.test(text);
      if (match.area === 'other' || wordCount < 4 || (!hasIssueLeadIn && match.score < 2)) {
        return false;
      }
    }

    return true;
  });

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

function normalizeSemanticFactsArg(raw: unknown): SemanticCallerFacts | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;

  const answerIntent: SemanticAnswerIntent | null = typeof value.answerIntent === 'string'
    && ['current_question', 'correction', 'both', 'unclear'].includes(value.answerIntent)
      ? value.answerIntent as SemanticAnswerIntent
      : null;
  const questionState: SemanticQuestionState | null = typeof value.questionState === 'string'
    && ['answered', 'uncertain', 'needs_explanation', 'wants_to_skip', 'off_topic', 'unclear'].includes(value.questionState)
      ? value.questionState as SemanticQuestionState
      : null;
  const conversationFit: SemanticConversationFit | null = typeof value.conversationFit === 'string'
    && ['legal_intake', 'wrong_number', 'unclear'].includes(value.conversationFit)
      ? value.conversationFit as SemanticConversationFit
      : null;
  const postCallIntent: SemanticPostCallIntent | null = typeof value.postCallIntent === 'string'
    && ['done', 'follow_up_question', 'urgent_transfer', 'continue', 'unclear'].includes(value.postCallIntent)
      ? value.postCallIntent as SemanticPostCallIntent
      : null;
  const clientStatus: SemanticCallerFacts['clientStatus'] = value.clientStatus === 'new' || value.clientStatus === 'existing'
    ? value.clientStatus
    : null;
  const callingFor: SemanticCallerFacts['callingFor'] = value.callingFor === 'self' || value.callingFor === 'other'
    ? value.callingFor
    : null;
  const callerName = typeof value.callerName === 'string' && value.callerName.trim()
    ? value.callerName.trim()
    : null;
  const callerPhone = typeof value.callerPhone === 'string' && value.callerPhone.trim()
    ? value.callerPhone.trim()
    : null;
  const callerEmail = typeof value.callerEmail === 'string' && value.callerEmail.trim()
    ? value.callerEmail.trim()
    : null;
  const issueSummary = typeof value.issueSummary === 'string' && value.issueSummary.trim()
    ? value.issueSummary.trim()
    : null;

  if (!answerIntent && !questionState && !conversationFit && !postCallIntent && !clientStatus && !callingFor && !callerName && !callerPhone && !callerEmail && !issueSummary) {
    return null;
  }

  return {
    ...(answerIntent ? { answerIntent } : {}),
    ...(questionState ? { questionState } : {}),
    ...(conversationFit ? { conversationFit } : {}),
    ...(postCallIntent ? { postCallIntent } : {}),
    ...(clientStatus ? { clientStatus } : {}),
    ...(callingFor ? { callingFor } : {}),
    ...(callerName ? { callerName } : {}),
    ...(callerPhone ? { callerPhone } : {}),
    ...(callerEmail ? { callerEmail } : {}),
    ...(issueSummary ? { issueSummary } : {}),
  };
}

function normalizePostFlowResponse(value: string): string {
  return value
    .toLowerCase()
    .replace(/^(?:uh|um|erm|hmm|mm|ah|well|so|like)\b[\s,.-]*/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCallerDoneResponse(value: string): boolean {
  const normalized = normalizePostFlowResponse(value);
  if (!normalized) return false;
  return (
    /^(?:no|nope|nah|nothing else|thats all|that s all|goodbye|bye|all set|all good|no thank you)\b/.test(normalized)
    || /\b(?:i m good|im good|i am good|i think i m good|i think im good|i think i am good|i don t need any more help|i do not need any more help|no more help|nothing more|that is everything|that s everything|that is all)\b/.test(normalized)
  );
}

function isCallerAskingFollowUpQuestion(value: string): boolean {
  const normalized = normalizePostFlowResponse(value);
  if (!normalized) return false;

  return (
    value.includes('?')
    || /^(?:how|when|what|can|could|would|will|do|does|did|is|are|should)\b/.test(normalized)
    || /\b(?:how long|when will|when should|what happens next|what now|reach out|follow up|hear back|timeline)\b/.test(normalized)
  );
}

function isCallerRequestingImmediateParalegalTransfer(value: string): boolean {
  const normalized = normalizePostFlowResponse(value);
  if (!normalized) return false;

  return (
    /\b(?:real person|human|paralegal|manager)\b/.test(normalized)
    || /\b(?:transfer(?: me)?|connect me|connect us)\b/.test(normalized)
    || /\b(?:talk to (?:a |the )?(?:person|human|paralegal|someone))\b/.test(normalized)
  );
}

function isSemanticPostCallIntent(semanticFacts: SemanticCallerFacts | null | undefined, intent: SemanticPostCallIntent): boolean {
  return semanticFacts?.postCallIntent === intent;
}

function hasUsableControlUrl(controlUrl?: string | null): controlUrl is string {
  return typeof controlUrl === 'string' && /^https?:\/\//.test(controlUrl.trim());
}

async function resolveParalegalTransferPhoneNumber(): Promise<string | null> {
  const user = await prisma.user.findFirst({
    where: { transferPhoneNumber: { not: null } },
    select: { transferPhoneNumber: true },
  });

  return user?.transferPhoneNumber || process.env.TRANSFER_PHONE_NUMBER || null;
}

async function canOfferImmediateParalegalTransfer(controlUrl?: string | null): Promise<boolean> {
  if (!hasUsableControlUrl(controlUrl)) {
    return false;
  }

  const phoneNumber = await resolveParalegalTransferPhoneNumber();
  return Boolean(phoneNumber);
}

function buildPostFlowFollowUpMessage(value: string): string {
  const normalized = normalizePostFlowResponse(value);
  const baseMessage = 'Thank you. I wrote down everything you shared with me today so I can pass this to the right lawyer for your case. They will review it and call you back at the best callback number I have for you.';

  if (/\b(?:how long|when|timeline|hear back|reach out|follow up|call me|contact me)\b/.test(normalized)) {
    return `${baseMessage} I can't promise an exact timeline over the phone, but your information has been sent over. Is there anything else I can help you with today?`;
  }

  return `${baseMessage} Is there anything else I can help you with today?`;
}

function determineLegalAreaFromContext(...candidates: Array<string | null | undefined>) {
  let bestArea: ReturnType<typeof identifyLegalArea> = 'other';
  let bestScore = 0;

  for (const candidate of candidates) {
    if (!candidate || !candidate.trim()) continue;
    const match = identifyLegalAreaMatch(candidate);
    if (match.score > bestScore) {
      bestScore = match.score;
      bestArea = match.area;
    }
  }

  return bestArea;
}

function resolvePreferredCallbackPhone(options: {
  toolPhone?: string | null;
  capturedPhone?: string | null;
  sessionCallerPhone?: string | null;
}) {
  const toolPhone = normalizeOptionalPhoneNumber(options.toolPhone || '') || '';
  const capturedPhone = normalizeOptionalPhoneNumber(options.capturedPhone || '') || '';
  const sessionCallerPhone = normalizeOptionalPhoneNumber(options.sessionCallerPhone || '') || '';

  if (toolPhone && (!sessionCallerPhone || toolPhone !== sessionCallerPhone)) {
    return toolPhone;
  }

  return capturedPhone || toolPhone || sessionCallerPhone || '';
}

function normalizeComparableCallerName(value?: string | null) {
  return (value || '')
    .toLowerCase()
    .replace(/^(?:uh|um|my name is|this is|i am|i m|i'm)\s+/i, '')
    .replace(/[^a-z\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function areCallerNamesCompatible(existingName?: string | null, incomingName?: string | null) {
  const normalizedExisting = normalizeComparableCallerName(existingName);
  const normalizedIncoming = normalizeComparableCallerName(incomingName);

  if (!normalizedExisting || !normalizedIncoming || normalizedIncoming === 'unknown') {
    return true;
  }

  if (normalizedExisting === normalizedIncoming) {
    return true;
  }

  const existingTokens = normalizedExisting.split(' ').filter(Boolean);
  const incomingTokens = normalizedIncoming.split(' ').filter(Boolean);
  if (existingTokens.length === 0 || incomingTokens.length === 0) {
    return true;
  }

  const existingFirst = existingTokens[0] || '';
  const incomingFirst = incomingTokens[0] || '';
  const existingLast = existingTokens.at(-1) || '';
  const incomingLast = incomingTokens.at(-1) || '';
  if (
    existingLast
    && incomingLast
    && existingLast === incomingLast
    && existingFirst
    && incomingFirst
    && existingFirst[0] === incomingFirst[0]
  ) {
    return true;
  }

  const overlapCount = incomingTokens.filter((token) => existingTokens.includes(token)).length;
  return overlapCount > 0 && overlapCount >= Math.min(existingTokens.length, incomingTokens.length);
}

async function resolveProspectiveClientForContact(options: {
  callerName: string;
  callerPhone?: string | null;
  callerEmail?: string | null;
}) {
  const normalizedPhone = normalizeOptionalPhoneNumber(options.callerPhone || '') || '';
  if (!normalizedPhone) {
    return { client: null, linkClientId: null as string | null, shouldSetClientId: false, conflict: false };
  }

  const existingClient = await prisma.client.findUnique({
    where: { phone: normalizedPhone },
  });

  if (!existingClient) {
    const createdClient = await prisma.client.create({
      data: {
        name: options.callerName,
        phone: normalizedPhone,
        email: options.callerEmail || null,
        isCurrentClient: false,
      },
    });

    return { client: createdClient, linkClientId: createdClient.id, shouldSetClientId: true, conflict: false };
  }

  const namesCompatible = areCallerNamesCompatible(existingClient.name, options.callerName);
  const emailsCompatible = !options.callerEmail || !existingClient.email || existingClient.email.toLowerCase() === options.callerEmail.toLowerCase();

  if (namesCompatible && emailsCompatible) {
    return { client: existingClient, linkClientId: existingClient.id, shouldSetClientId: true, conflict: false };
  }

  console.warn(
    `[vapi] Callback number ${normalizedPhone} is already linked to client "${existingClient.name}", but this call captured "${options.callerName}". Leaving the call session unlinked to avoid attaching it to the wrong person.`
  );

  return { client: existingClient, linkClientId: null as string | null, shouldSetClientId: true, conflict: true };
}

function buildFlowClassificationContext(state: ReturnType<typeof hydrateFlowRuntimeState>) {
  const values = Array.from(new Set(
    Object.values(state.flagValues)
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  ));

  return values.length > 0 ? values.join('. ') : undefined;
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
        'callbackPhone',
        'callerPhone',
        'call_origin_phone',
        'callOriginPhone',
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
    flowGuaranteedComplete: true,
    transferTarget: config?.transferTarget,
    handoffMode: config?.handoffMode,
    callbackMessage: typeof config?.callbackMessage === 'string' ? config.callbackMessage : undefined,
    message: typeof config?.message === 'string' ? config.message : undefined,
    callerName: getFlowCollectedValue(state, 'caller_name', 'callerName') || 'Unknown',
    callerPhone: getFlowCollectedValue(state, 'callback_phone', 'callbackPhone', 'callerPhone') || session.callerPhone || '',
    callOriginPhone: getFlowCollectedValue(state, 'call_origin_phone', 'callOriginPhone') || session.callerPhone || '',
    callerEmail: getFlowCollectedValue(state, 'email', 'callerEmail') || undefined,
    issue: getFlowCollectedValue(state, 'issue_summary', 'issueSummary') || '',
    notes: buildIntakeNotesFromState(state),
    classificationContext: buildFlowClassificationContext(state),
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
    correctionContext: getFlowFlagValue(state, 'correctionContext') || undefined,
  };
}

function buildBookAppointmentArgs(
  state: ReturnType<typeof hydrateFlowRuntimeState>,
  session: { callerPhone?: string | null },
) {
  return {
    callerName: getFlowCollectedValue(state, 'caller_name', 'callerName') || 'Unknown',
    callerPhone: getFlowCollectedValue(state, 'callback_phone', 'callbackPhone', 'callerPhone') || session.callerPhone || '',
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

function findQuestionNodeByPrompt(flow: any, prompt: string) {
  const normalizedPrompt = prompt.trim().toLowerCase();
  if (!normalizedPrompt) return null;

  return flow.nodes.find((node: any) => {
    if (node.type !== 'question') return false;
    const question = typeof node.config?.question === 'string' ? node.config.question.trim().toLowerCase() : '';
    const note = typeof node.config?.note === 'string' ? node.config.note.trim().toLowerCase() : '';
    return question === normalizedPrompt || note === normalizedPrompt;
  }) || null;
}

async function handlePostFlowState(
  callerResponse: string,
  session: { id: string; callId: string; callerPhone: string | null; summary?: string | null; notes?: string | null },
  flowId: string | null | undefined,
  runtimeState: ReturnType<typeof hydrateFlowRuntimeState>,
  semanticFacts?: SemanticCallerFacts | null,
  controlUrl?: string | null,
) {
  const writes: FlowRuntimeWrite[] = [];

  if (isSemanticPostCallIntent(semanticFacts, 'done') || isCallerDoneResponse(callerResponse)) {
    writes.push(
      { fieldName: FLOW_POST_STATE_KEY, fieldValue: 'none' },
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: FLOW_COMPLETED_NODE_ID },
    );
    await persistFlowRuntimeWrites(session.id, flowId, writes);
    return {
      success: true,
      step: 'end',
      speakExactly: true,
      assistantMessage: 'Thank you for calling. Have a wonderful day. Goodbye!',
      endCallAfterSpeaking: true,
    };
  }

  if (isSemanticPostCallIntent(semanticFacts, 'urgent_transfer') || isCallerRequestingImmediateParalegalTransfer(callerResponse)) {
    const transferResult: any = await handleGenerateTransferSummary(
      {
        transferTarget: 'paralegal',
        handoffMode: 'summary_only',
        callerName: getFlowCollectedValue(runtimeState, 'caller_name', 'callerName') || undefined,
        callerPhone: getFlowCollectedValue(runtimeState, 'callback_phone', 'callbackPhone', 'callerPhone') || session.callerPhone || undefined,
        issue: getFlowCollectedValue(runtimeState, 'issue_summary', 'issueSummary') || session.summary || undefined,
        notes: session.notes || undefined,
        urgencyFlag: getFlowFlagValue(runtimeState, 'urgencyFlag') || getFlowCollectedValue(runtimeState, 'urgency_flag') || 'urgent',
      },
      undefined,
      session.callId,
    );

    writes.push(
      { fieldName: FLOW_POST_STATE_KEY, fieldValue: 'none' },
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: FLOW_COMPLETED_NODE_ID },
    );
    await persistFlowRuntimeWrites(session.id, flowId, writes);
    return {
      success: true,
      step: 'end',
      speakExactly: true,
      assistantMessage: typeof transferResult?.message === 'string' && transferResult.message
        ? transferResult.message
        : getDefaultTransferCallbackMessage('paralegal', { urgent: true }),
      endCallAfterSpeaking: true,
    };
  }

  if (isSemanticPostCallIntent(semanticFacts, 'follow_up_question') || isCallerAskingFollowUpQuestion(callerResponse)) {
    writes.push({ fieldName: FLOW_POST_STATE_KEY, fieldValue: FLOW_POST_STATE_AWAITING_ANYTHING_ELSE });
    await persistFlowRuntimeWrites(session.id, flowId, writes);
    return {
      success: true,
      step: 'say',
      speakExactly: true,
      assistantMessage: buildPostFlowFollowUpMessage(callerResponse),
    };
  }

  writes.push({ fieldName: FLOW_POST_STATE_KEY, fieldValue: FLOW_POST_STATE_AWAITING_ANYTHING_ELSE });
  await persistFlowRuntimeWrites(session.id, flowId, writes);
  return {
    success: true,
    step: 'ask',
    speakExactly: true,
    assistantMessage: 'Of course. What else can I help you with today?',
  };
}

async function handleImmediateParalegalTransferRequest(
  session: { id: string; callId: string; callerPhone: string | null },
  flowId: string | null | undefined,
  runtimeState: ReturnType<typeof hydrateFlowRuntimeState>,
  activeCallId?: string,
  controlUrl?: string | null,
) {
  const transferResult: any = await handleGenerateTransferSummary(
    buildTransferSummaryArgs(runtimeState, session, {
      transferTarget: 'paralegal',
      handoffMode: 'live_transfer',
      urgencyFlag: getFlowFlagValue(runtimeState, 'urgencyFlag') || getFlowCollectedValue(runtimeState, 'urgency_flag') || undefined,
    }),
    controlUrl,
    activeCallId,
  );

  await persistFlowRuntimeWrites(session.id, flowId, [
    { fieldName: FLOW_POST_STATE_KEY, fieldValue: 'none' },
    { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: FLOW_COMPLETED_NODE_ID },
  ]);

  if (transferResult?.liveTransfer && transferResult?.transferred) {
    return {
      success: true,
      step: 'live_transfer',
      transferred: true,
    };
  }

  return {
    success: true,
    step: 'end',
    speakExactly: true,
    assistantMessage: typeof transferResult?.message === 'string' && transferResult.message
      ? transferResult.message
      : getDefaultTransferCallbackMessage('paralegal'),
    endCallAfterSpeaking: true,
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

async function handleBookAppointment(args: Record<string, unknown>, userId: string, activeCallId?: string) {
  const rawPhone = typeof args.callerPhone === 'string' ? args.callerPhone : '';
  const normalizedToolPhone = normalizeOptionalPhoneNumber(rawPhone) || '';
  const { state: capturedState, sessionCallerPhone } = await loadCapturedIntakeState(activeCallId, normalizedToolPhone);
  const callerName = typeof args.callerName === 'string' ? args.callerName : capturedState.callerName || 'Unknown';
  const callerPhone = resolvePreferredCallbackPhone({
    toolPhone: normalizedToolPhone,
    capturedPhone: capturedState.callerPhone,
    sessionCallerPhone,
  });
  const callerEmail = typeof args.callerEmail === 'string' ? args.callerEmail : capturedState.callerEmail || undefined;
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

async function persistParalegalHandoff(args: Record<string, unknown>, callOutcome: string, activeCallId?: string) {
  const rawPhone = typeof args.callerPhone === 'string' ? args.callerPhone : (typeof args.phone === 'string' ? args.phone : '');
  const normalizedToolPhone = normalizeOptionalPhoneNumber(rawPhone) || '';
  const { state: capturedState, sessionCallerPhone } = await loadCapturedIntakeState(activeCallId, normalizedToolPhone);
  const callerName = typeof args.callerName === 'string' ? args.callerName : capturedState.callerName || 'Unknown';
  const callerPhone = resolvePreferredCallbackPhone({
    toolPhone: normalizedToolPhone,
    capturedPhone: capturedState.callerPhone,
    sessionCallerPhone,
  });
  const callerEmail = typeof args.callerEmail === 'string' ? args.callerEmail : capturedState.callerEmail || '';
  const issue = typeof args.issue === 'string' ? args.issue : capturedState.issueSummary || '';
  const notes = typeof args.notes === 'string' ? args.notes : '';

  const clientResolution = await resolveProspectiveClientForContact({
    callerName,
    callerPhone,
    callerEmail,
  });
  const client = clientResolution.linkClientId ? clientResolution.client : null;

  let existing = activeCallId
    ? await prisma.callSession.findUnique({ where: { callId: activeCallId } })
    : callerPhone
    ? await prisma.callSession.findFirst({
        where: { callerPhone },
        orderBy: { createdAt: 'desc' },
      })
    : null;

  if (!existing) {
    existing = await prisma.callSession.findFirst({
      where: { status: { in: ['active', 'completed'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  const sessionData = {
    ...(clientResolution.shouldSetClientId ? { clientId: clientResolution.linkClientId } : {}),
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
  const paralegalPhoneNumber = await resolveParalegalTransferPhoneNumber();
  const offerImmediateParalegalTransfer = Boolean(paralegalPhoneNumber && hasUsableControlUrl(controlUrl));
  const callbackMessage = resolveTransferCallbackMessage({
    transferTarget,
    callbackMessage: args.callbackMessage,
    message: args.message,
    urgencyFlag: args.urgencyFlag,
    offerImmediateParalegalTransfer,
  });
  const correctionContext = typeof args.correctionContext === 'string' ? args.correctionContext : null;
  const liveTransferRequested = isLiveTransferEnabled(args.handoffMode, transferTarget);

  if (transferTarget === 'paralegal') {
    const liveTransferNumber = typeof paralegalPhoneNumber === 'string' ? paralegalPhoneNumber : null;

    if (liveTransferRequested && liveTransferNumber) {
      if (hasUsableControlUrl(controlUrl)) {
        try {
          await triggerVapiTransfer(
            controlUrl,
            { type: 'number', number: liveTransferNumber },
            getLiveTransferAnnouncement('paralegal', { correctionContext }),
          );
          const handoffResult = await persistParalegalHandoff(args, 'transferred', activeCallId);
          return {
            ...handoffResult,
            liveTransfer: true,
            transferred: true,
            destination: { type: 'number', number: liveTransferNumber },
          };
        } catch (error) {
          console.error('[vapi] Failed to trigger paralegal live transfer:', error);
          const handoffResult = await persistParalegalHandoff(args, 'team_followup', activeCallId);
          return {
            ...handoffResult,
            liveTransfer: false,
            transferTarget,
            message: callbackMessage,
          };
        }
      }
      const handoffResult = await persistParalegalHandoff(args, 'transferred', activeCallId);
      return {
        ...handoffResult,
        liveTransfer: true,
        type: 'transfer',
        destination: {
          type: 'number',
          number: liveTransferNumber,
          message: getLiveTransferAnnouncement('paralegal', { correctionContext }),
        },
      };
    }

    const handoffResult = await persistParalegalHandoff(args, 'team_followup', activeCallId);

    return {
      ...handoffResult,
      liveTransfer: false,
      transferTarget,
      message: callbackMessage,
    };
  }

  // Delegate to the shared summary handler which saves data and emails the lawyer
  const summaryResult = await handleGenerateSummary({ ...args }, activeCallId);

  if (!liveTransferRequested) {
    const shouldUseCallbackMessage = summaryResult.success
      && (summaryResult.emailDelivered !== false || summaryResult.deliveryStatus === 'queued_until_call_end');
    return {
      ...summaryResult,
      liveTransfer: false,
      transferTarget,
      message: shouldUseCallbackMessage
        ? callbackMessage
        : summaryResult.message,
    };
  }

  // attorney path: find best matched attorney and transfer to their direct line
  const legalArea = summaryResult.legalArea || determineLegalAreaFromContext(
    typeof args.issue === 'string' ? args.issue : '',
    typeof args.notes === 'string' ? args.notes : '',
    typeof args.matterCategory === 'string' ? args.matterCategory : '',
    typeof args.petitionType === 'string' ? args.petitionType : '',
    typeof args.urgencyFlag === 'string' ? args.urgencyFlag : '',
    typeof args.classificationContext === 'string' ? args.classificationContext : '',
  );
  const lawyer = await findBestLawyer(legalArea);
  if (lawyer?.phone) {
    if (hasUsableControlUrl(controlUrl)) {
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
  options: { intakeNotes?: string; transcriptText?: string; recordingUrl?: string; assistantName?: string }
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

  const runtimeRows = await loadFlowRuntimeRows(callSession.id);
  const runtimeState = hydrateFlowRuntimeState(runtimeRows);
  const resolvedCallerName =
    getFlowCollectedValue(runtimeState, 'caller_name', 'callerName')
    || callSession.client?.name
    || 'Unknown caller';
  const resolvedCallerPhone =
    getFlowCollectedValue(runtimeState, 'callback_phone', 'callbackPhone', 'callerPhone')
    || callSession.client?.phone
    || callSession.callerPhone
    || '';
  const resolvedCallOriginPhone =
    getFlowCollectedValue(runtimeState, 'call_origin_phone', 'callOriginPhone')
    || callSession.callerPhone
    || '';
  const resolvedCallerEmail =
    getFlowCollectedValue(runtimeState, 'email', 'callerEmail')
    || callSession.client?.email
    || undefined;
  const backupSummaryEmail = await resolveBackupSummaryEmail(callSession.intakeFlowId);

  const emailResult = await sendCallSummaryEmail({
    callId: callSession.callId,
    lawyerEmail: callSession.lawyer.email,
    lawyerName: callSession.lawyer.name,
    backupEmail: backupSummaryEmail,
    assistantName: options.assistantName,
    callerName: resolvedCallerName,
    callerPhone: resolvedCallerPhone,
    callOriginPhone: resolvedCallOriginPhone,
    callerEmail: resolvedCallerEmail,
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

async function resolveBackupSummaryEmail(intakeFlowId?: string | null): Promise<string | undefined> {
  if (intakeFlowId) {
    const flow = await prisma.intakeFlow.findUnique({
      where: { id: intakeFlowId },
      select: {
        user: {
          select: {
            backupSummaryEmail: true,
          },
        },
      },
    });
    const flowEmail = flow?.user?.backupSummaryEmail?.trim();
    if (flowEmail) return flowEmail;
  }

  const fallbackUser = await prisma.user.findFirst({
    select: {
      backupSummaryEmail: true,
    },
  });
  return fallbackUser?.backupSummaryEmail?.trim() || undefined;
}

async function handleGenerateSummary(args: Record<string, unknown>, activeCallId?: string) {
  const rawPhone = typeof args.callerPhone === 'string' ? args.callerPhone : (typeof args.phone === 'string' ? args.phone : '');
  const normalizedToolPhone = normalizeOptionalPhoneNumber(rawPhone) || '';
  const { state: capturedState, sessionCallerPhone } = await loadCapturedIntakeState(activeCallId, normalizedToolPhone);
  const callerName = typeof args.callerName === 'string' ? args.callerName : capturedState.callerName || 'Unknown';
  const callerPhone = resolvePreferredCallbackPhone({
    toolPhone: normalizedToolPhone,
    capturedPhone: capturedState.callerPhone,
    sessionCallerPhone,
  });
  const callerEmail = typeof args.callerEmail === 'string' ? args.callerEmail : capturedState.callerEmail || '';
  const issue = typeof args.issue === 'string' ? args.issue : capturedState.issueSummary || '';
  const notes = typeof args.notes === 'string' ? args.notes : '';
  const classificationContext = typeof args.classificationContext === 'string' ? args.classificationContext : '';
  const petitionType = typeof args.petitionType === 'string' ? args.petitionType : undefined;
  const matterCategory = typeof args.matterCategory === 'string' ? args.matterCategory : undefined;
  const partyRole = typeof args.partyRole === 'string' ? args.partyRole : undefined;
  const urgencyFlag = typeof args.urgencyFlag === 'string' ? args.urgencyFlag : undefined;
  const flowGuaranteedComplete = args.flowGuaranteedComplete === true;

  // Identify the right lawyer
  const legalArea = determineLegalAreaFromContext(
    issue,
    notes,
    matterCategory,
    petitionType,
    urgencyFlag,
    classificationContext,
  );

  const clientResolution = await resolveProspectiveClientForContact({
    callerName,
    callerPhone,
    callerEmail,
  });
  const client = clientResolution.linkClientId ? clientResolution.client : null;

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

  const validationFlow = flowGuaranteedComplete
    ? existing?.intakeFlowId
      ? await loadFlowForSummaryValidation(existing.intakeFlowId)
      : null
    : await loadFlowForSummaryValidation(existing?.intakeFlowId || null);

  if (!flowGuaranteedComplete) {
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
  }

  const lawyer = await findBestLawyer(legalArea);
  console.log(`[vapi] generateSummary accepted for ${legalArea}; matched lawyer: ${lawyer?.name || 'none'}`);

  // Use the VAPI-captured phone if the tool didn't provide a valid one
  const effectivePhone = callerPhone || existing?.callerPhone || '';

  const callSession = existing
    ? await prisma.callSession.update({
        where: { id: existing.id },
        data: {
          ...(clientResolution.shouldSetClientId ? { clientId: clientResolution.linkClientId } : {}),
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
          ...(clientResolution.shouldSetClientId ? { clientId: clientResolution.linkClientId } : {}),
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
      message: getDefaultTransferCallbackMessage('attorney'),
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
      message: getDefaultTransferCallbackMessage('attorney'),
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
    message: getDefaultTransferCallbackMessage('attorney'),
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
  const matchedChoiceLabel = typeof args.matchedChoiceLabel === 'string' ? args.matchedChoiceLabel.trim() : '';
  const semanticFacts = normalizeSemanticFactsArg(args.semanticFacts);
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

  if (session.callerPhone && !getFlowCollectedValue(runtimeState, 'call_origin_phone', 'callOriginPhone')) {
    const originWrites: FlowRuntimeWrite[] = [
      { fieldName: 'call_origin_phone', fieldValue: session.callerPhone },
      { fieldName: 'callOriginPhone', fieldValue: session.callerPhone },
    ];
    await persistFlowRuntimeWrites(session.id, flow.id, originWrites);
    runtimeRows = mergeRuntimeRows(runtimeRows, originWrites);
    runtimeState = hydrateFlowRuntimeState(runtimeRows);
  }

  const postState = runtimeState.internalValues[FLOW_POST_STATE_KEY] || 'none';

  if (postState === FLOW_POST_STATE_AWAITING_ANYTHING_ELSE) {
    return handlePostFlowState(callerResponse, session, flow.id, runtimeState, semanticFacts, controlUrl);
  }

  if (isCallerRequestingImmediateParalegalTransfer(callerResponse)) {
    return handleImmediateParalegalTransferRequest(
      session,
      flow.id,
      runtimeState,
      activeCallId,
      controlUrl,
    );
  }

  let pendingResponse: string | null = callerResponse;
  for (let guard = 0; guard < 40; guard += 1) {
    const progress = progressActiveFlow(flow, runtimeState, pendingResponse, {
      sessionCallerPhone: session.callerPhone,
      sessionClientType: normalizeClientStatusForFlow(session.clientType),
      matchedChoiceLabel: pendingResponse ? matchedChoiceLabel : null,
      semanticFacts: pendingResponse ? semanticFacts : null,
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
        speakExactly: true,
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
        speakExactly: true,
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

      if (transferResult?.continueIntake && Array.isArray(transferResult.missingRequirements) && transferResult.missingRequirements.length > 0) {
        const retryQuestion = findQuestionNodeByPrompt(flow, transferResult.missingRequirements[0]);
        if (retryQuestion) {
          await persistFlowRuntimeWrites(session.id, flow.id, [
            { fieldName: FLOW_POST_STATE_KEY, fieldValue: 'none' },
            { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: retryQuestion.id },
          ]);
          return {
            success: true,
            step: 'ask',
            speakExactly: true,
            assistantMessage: typeof retryQuestion.config?.question === 'string' ? retryQuestion.config.question : transferResult.missingRequirements[0],
            currentNodeLabel: retryQuestion.label,
          };
        }
      }

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
        speakExactly: true,
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
            speakExactly: true,
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
            speakExactly: true,
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
          speakExactly: true,
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

  const legalArea = determineLegalAreaFromContext(
    issue,
    options.transcriptText || callSession.notes || '',
    callSession.matterCategory || undefined,
    callSession.petitionType || undefined,
    callSession.urgencyFlag || undefined,
  );
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
      const { context: assistantContext, source } = await getAssistantRequestRuntimeContextFast(reqPhoneNumberId);
      const transferPhone = assistantContext.firm.transferPhone;
      const assistantName = assistantContext.firm.assistantName || '';
      const firmName = assistantContext.firm.firmName || '';
      const systemPrompt = assistantContext.prompt;
      const flowFirstMessage = assistantContext.firstMessage;
      const activeFlowId = assistantContext.flowId;
      console.log(`[vapi] assistant-request prompt ready in ${Date.now() - t0}ms (${source})`);

      // Use the flow's greeting as firstMessage if available, otherwise use default
      const defaultFirstMessage = assistantName
        ? `Thank you for calling our law firm. I am the AI assistant, ${assistantName}, and I'll ask you a few questions to figure out how we can best help you. You may request to get transferred to a paralegal at any time.`
        : "Thank you for calling our law firm. I am the AI assistant, and I'll ask you a few questions to figure out how we can best help you. You may request to get transferred to a paralegal at any time.";

      const assistant: any = {
        name: assistantName ? `${assistantName} - Begintake` : 'Begintake Intake Assistant',
        firstMessage: flowFirstMessage || defaultFirstMessage,
        hooks: [
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
        ],
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
          temperature: 0,
          messages: [{ role: 'system', content: systemPrompt }],
          tools: [
            ...getToolDefinitions({ activeFlow: Boolean(activeFlowId) || source !== 'cache' }),
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
          stability: 0.62,
          similarityBoost: 0.68,
        },
        backgroundSound: 'office',
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
      console.log(`[vapi] RETURNING in ${Date.now() - t0}ms (${source}): ${JSON.stringify(logAssistant)}`);
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
            result = await handleBookAppointment(args, userId, activeCallId);
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

        const spokenMessage = getToolCallSpokenMessage(toolCallId, name, result);
        const serializedResult = sanitizeToolResultForModel(name, result, Boolean(spokenMessage));
        results.push({
          toolCallId,
          name,
          result: JSON.stringify(serializedResult),
          ...(spokenMessage ? { message: spokenMessage } : {}),
        });
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
      const vapiPhoneNumberId = body?.message?.call?.phoneNumberId || body?.message?.call?.phoneNumber?.id || undefined;
      const summary = body?.message?.summary;
      const transcript = body?.message?.artifact?.transcript ?? body?.message?.transcript;
      const recordingUrl = extractRecordingUrl(body?.message);

      if (callId) {
        const existingSession = await prisma.callSession.findUnique({
          where: { callId },
        });
        const assistantName = await resolveAssistantNameForCall(vapiPhoneNumberId);
        const intakeNotes = existingSession?.notes || undefined;
        const transcriptText = normalizeTranscriptTextWithSpeakerLabels(transcript, assistantName);

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
            assistantName,
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
