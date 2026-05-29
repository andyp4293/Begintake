import { identifyLegalArea, identifyLegalAreaMatch } from './lawyer-matcher';
import { normalizeOptionalPhoneNumber } from './phone';

interface FlowNodeLike {
  id: string;
  type: string;
  label: string;
  config?: any;
}

interface FlowEdgeLike {
  id?: string;
  sourceNodeId: string;
  targetNodeId: string;
  label?: string | null;
  sortOrder?: number;
}

interface FlowLike {
  id?: string | null;
  nodes: FlowNodeLike[];
  edges: FlowEdgeLike[];
}

interface IntakeDataRowLike {
  fieldName: string;
  fieldValue: string;
  nodeId?: string | null;
}

export interface FlowRuntimeWrite {
  fieldName: string;
  fieldValue: string;
  nodeId?: string | null;
  branchPath?: string | null;
}

export interface HydratedFlowRuntimeState {
  currentNodeId: string | null;
  fieldValues: Record<string, string>;
  questionAnswers: Record<string, string>;
  flagValues: Record<string, string>;
  selectedBranchByQuestion: Record<string, string>;
  internalValues: Record<string, string>;
}

interface FlowProgressContext {
  sessionCallerPhone?: string | null;
  sessionClientType?: string | null;
  matchedChoiceLabel?: string | null;
  semanticFacts?: SemanticCallerFacts | null;
  assumeNewClients?: boolean;
}

interface InferredCallerFacts {
  callerName?: string | null;
  callerPhone?: string | null;
  callerEmail?: string | null;
  clientStatus?: 'new' | 'existing' | null;
  callingFor?: 'self' | 'other' | null;
  issueSummary?: string | null;
}

export type SemanticAnswerIntent = 'current_question' | 'correction' | 'both' | 'unclear';
export type SemanticConversationFit = 'legal_intake' | 'wrong_number' | 'unclear';
export type SemanticPostCallIntent = 'done' | 'follow_up_question' | 'urgent_transfer' | 'continue' | 'unclear';
export type SemanticQuestionState = 'answered' | 'uncertain' | 'needs_explanation' | 'wants_to_skip' | 'off_topic' | 'unclear';

export interface SemanticCallerFacts extends InferredCallerFacts {
  answerIntent?: SemanticAnswerIntent | null;
  conversationFit?: SemanticConversationFit | null;
  postCallIntent?: SemanticPostCallIntent | null;
  questionState?: SemanticQuestionState | null;
  requestHuman?: boolean | null;
}

type QuestionKind =
  | 'get_started'
  | 'client_status'
  | 'caller_name'
  | 'best_phone_confirm'
  | 'callback_phone'
  | 'email'
  | 'calling_for'
  | 'issue_summary'
  | 'generic';

interface BaseProgressResult {
  writes: FlowRuntimeWrite[];
}

export interface FlowAskResult extends BaseProgressResult {
  kind: 'ask' | 'clarify';
  node: FlowNodeLike;
  assistantMessage: string;
}

export interface FlowActionResult extends BaseProgressResult {
  kind: 'action';
  node: FlowNodeLike;
  nextNodeId: string | null;
}

export interface FlowTransferResult extends BaseProgressResult {
  kind: 'transfer';
  node: FlowNodeLike;
}

export interface FlowEndResult extends BaseProgressResult {
  kind: 'end';
  node: FlowNodeLike;
  assistantMessage: string;
}

export interface FlowCompleteResult extends BaseProgressResult {
  kind: 'complete';
}

export type FlowProgressResult =
  | FlowAskResult
  | FlowActionResult
  | FlowTransferResult
  | FlowEndResult
  | FlowCompleteResult;

export const INTERNAL_FLOW_PREFIX = '__flow_';
export const FLOW_CURRENT_NODE_KEY = '__flow_current_node_id';
export const FLOW_POST_STATE_KEY = '__flow_post_state';
export const FLOW_COMPLETED_NODE_ID = '__completed__';

const FLOW_ANSWER_PREFIX = '__flow_answer::';
const FLOW_FLAG_PREFIX = '__flow_flag::';
const FLOW_SELECTION_PREFIX = '__flow_selected::';
const FLOW_CLARIFY_COUNT_PREFIX = 'clarify_count::';
const MAX_NON_PROGRESS_RETRIES = 1;

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'best', 'both', 'by', 'can', 'could', 'do', 'for',
  'from', 'get', 'going', 'have', 'hello', 'help', 'how', 'i', 'if', 'in', 'is', 'it', 'its',
  'just', 'me', 'my', 'no', 'of', 'on', 'or', 'our', 'right', 'same', 'that', 'the', 'them',
  'there', 'they', 'this', 'to', 'today', 'us', 'we', 'what', 'with', 'you', 'your', 'someone',
  'something',
]);

const SEMANTIC_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\battorney\b/g, 'lawyer'],
  [/\bcounsel\b/g, 'lawyer'],
  [/\bretained counsel\b/g, 'has a lawyer'],
  [/\bkids?\b/g, 'children'],
  [/\bminor kid(s)?\b/g, 'minor children'],
  [/\bhusband\b|\bwife\b/g, 'spouse'],
  [/\bboyfriend\b|\bgirlfriend\b/g, 'partner'],
  [/\bwreck\b|\bcollision\b|\bcrash(ed|es|ing)?\b/g, 'accident'],
  [/\bauto\b|\bautomobile\b|\bvehicle\b/g, 'car'],
  [/\bdui\b/g, 'drunk driving'],
  [/\balimony\b/g, 'spousal support'],
  [/\bhearing\b/g, 'court date'],
  [/\basap\b|\bemergency\b/g, 'urgent'],
  [/\bnot filed\b|\bhaven t filed\b|\bhave not filed\b/g, 'nothing filed yet'],
];

const SEMANTIC_TOKEN_GROUPS: Array<[string, string[]]> = [
  ['new', ['new', 'first', 'initial', 'starting', 'beginning', 'fresh']],
  ['existing', ['existing', 'current', 'returning', 'already']],
  ['modify', ['modify', 'modification', 'change', 'adjust', 'update', 'lower', 'reduce', 'raise', 'increase', 'move', 'shift', 'reschedule', 'rescheduling']],
  ['enforce', ['enforce', 'enforcement', 'violation', 'violating', 'ignored', 'ignoring', 'behind', 'arrears', 'overdue', 'unpaid']],
  ['urgent', ['urgent', 'emergency', 'immediate', 'asap', 'deadline', 'unsafe', 'danger']],
  ['receive', ['receive', 'receiving', 'recipient', 'waiting']],
  ['pay', ['pay', 'paying', 'payer', 'payor', 'owe']],
  ['agree', ['agree', 'agreed', 'agreement', 'amicable', 'uncontested']],
  ['disagree', ['disagree', 'dispute', 'disputed', 'fight', 'fighting', 'contested']],
  ['federal', ['federal', 'irs']],
  ['state', ['state', 'revenue']],
  ['reschedule', ['reschedule', 'rescheduling', 'move', 'shift']],
  ['appointment', ['appointment', 'consultation', 'consult', 'meeting', 'booking']],
  ['billing', ['billing', 'invoice', 'payment', 'charge', 'charged']],
  ['child', ['child', 'children', 'kid', 'kids']],
];

const TOKEN_ALIAS_LOOKUP = new Map<string, string>();
for (const [canonical, variants] of SEMANTIC_TOKEN_GROUPS) {
  TOKEN_ALIAS_LOOKUP.set(canonical, canonical);
  for (const variant of variants) {
    TOKEN_ALIAS_LOOKUP.set(variant, canonical);
  }
}

const NON_NAME_PATTERNS = [
  /\bfirst time\b/,
  /\bnew client\b/,
  /\bexisting client\b/,
  /\bold client\b/,
  /\bcurrent client\b/,
  /\bworked with\b/,
  /\bused your firm\b/,
  /\breaching out\b/,
  /\bactually new\b/,
  /\bactually old\b/,
  /\bactually existing\b/,
  /\bmodification\b/,
  /\bmodify\b/,
  /\benforcement\b/,
  /\bchild support\b/,
  /\bspousal support\b/,
  /\bspousal maintenance\b/,
  /\bdivorce\b/,
  /\bcustody\b/,
  /\bvisitation\b/,
  /\bissue\b/,
  /\bmatter\b/,
  /\border\b/,
  /\bfor myself\b/,
  /\bmyself\b/,
  /\bfor a family member\b/,
];

const EXISTING_CLIENT_PATTERNS = [
  /\bexisting\b/,
  /\bold client\b/,
  /\bcurrent client\b/,
  /\breturning\b/,
  /\bcalled before\b/,
  /\bworked with (?:you|your firm|the firm|your office) before\b/,
  /\bused (?:your firm|you|the office) before\b/,
  /\bbeen a client before\b/,
  /\bnot (?:my )?first time\b/,
  /\bagain\b/,
];

const NEW_CLIENT_PATTERNS = [
  /\bfirst time\b/,
  /\bnew client\b/,
  /\bbrand new\b/,
  /\bnever worked with\b/,
  /\bhave not worked with\b/,
  /\bhaven t worked with\b/,
  /\bnot an existing client\b/,
  /\bnew here\b/,
];

const SELF_PATTERNS = [
  /\bfor myself\b/,
  /\bfor me\b/,
  /\bit s for me\b/,
  /\bthis is for me\b/,
  /\bmy issue\b/,
  /\bmy case\b/,
  /\bit s me\b/,
  /\bmyself\b/,
];

const OTHER_PATTERNS = [
  /\bsomeone else\b/,
  /\bon behalf\b/,
  /\bfor my\b/,
  /\bfor our\b/,
  /\bfor a\b/,
  /\bit s for my\b/,
  /\bit s for our\b/,
  /\bit s for a\b/,
];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9@\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function semanticNormalizeText(value: string): string {
  let normalized = normalizeText(value);
  for (const [pattern, replacement] of SEMANTIC_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.replace(/\s+/g, ' ').trim();
}

function scoreRegexMatches(normalized: string, patterns: RegExp[]): number {
  return patterns.reduce((score, pattern) => score + (pattern.test(normalized) ? 1 : 0), 0);
}

function stripLeadingDisfluencies(value: string): string {
  return value
    .replace(/^(?:uh|um|erm|hmm|mm|ah|well|so|like)\b[\s,.-]*/gi, '')
    .trim();
}

function normalizeSemanticToken(token: string): string {
  let normalized = token.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normalized) return '';
  const directMatch = TOKEN_ALIAS_LOOKUP.get(normalized);
  if (directMatch) return directMatch;
  if (normalized.endsWith('ies') && normalized.length > 4) {
    normalized = `${normalized.slice(0, -3)}y`;
  } else if (normalized.endsWith('ing') && normalized.length > 5) {
    normalized = normalized.slice(0, -3);
  } else if (normalized.endsWith('ed') && normalized.length > 4) {
    normalized = normalized.slice(0, -2);
  } else if (normalized.endsWith('es') && normalized.length > 4) {
    normalized = normalized.slice(0, -2);
  } else if (normalized.endsWith('s') && normalized.length > 4) {
    normalized = normalized.slice(0, -1);
  }
  return TOKEN_ALIAS_LOOKUP.get(normalized) || normalized;
}

function keywordTokens(value: string): string[] {
  return semanticNormalizeText(value)
    .split(' ')
    .map((token) => normalizeSemanticToken(token))
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function getQuestionPrompt(node: FlowNodeLike): string {
  const question = typeof node.config?.question === 'string'
    ? node.config.question.trim()
    : '';
  const note = typeof node.config?.note === 'string'
    ? node.config.note.trim()
    : '';
  if (question) return question;
  if (note) {
    const quotedPrompt = note.match(/(?:say something like|ask|briefly explain)\s*:\s*"([^"]+)"/i)
      || note.match(/say something like\s*"([^"]+)"/i);
    if (quotedPrompt?.[1]) {
      return quotedPrompt[1].trim();
    }
    if (/[?]$/.test(note) || note.toLowerCase().startsWith('what ') || note.toLowerCase().startsWith('is ') || note.toLowerCase().startsWith('are ')) {
      return note;
    }
  }
  return node.label;
}

function classifyQuestion(node: FlowNodeLike): QuestionKind {
  const prompt = normalizeText(`${node.label} ${getQuestionPrompt(node)}`);
  const collectFieldNames = Array.isArray(node.config?.collectFields)
    ? node.config.collectFields
      .map((field: any) => typeof field?.name === 'string' ? field.name.trim() : '')
      .filter(Boolean)
    : [];

  if (prompt.includes('shall we get started')) return 'get_started';
  if (prompt.includes('worked with our firm before') || prompt.includes('first time reaching out') || prompt.includes('new or existing client')) {
    return 'client_status';
  }
  if (prompt.includes('first and last name') || /\bcaller name\b/.test(prompt) || /\byour name\b/.test(prompt)) {
    return 'caller_name';
  }
  if (prompt.includes('best number') || prompt.includes('reach you if we get disconnected')) {
    return 'best_phone_confirm';
  }
  if (prompt.includes('callback number')) {
    return 'callback_phone';
  }
  if (prompt.includes('email')) {
    return 'email';
  }
  if (prompt.includes('for yourself') || prompt.includes('on behalf of someone else')) {
    return 'calling_for';
  }
  if (
    prompt.includes("what's been going on") ||
    prompt.includes('what is going on') ||
    prompt.includes('tell me a little about') ||
    prompt.includes('describe their situation') ||
    prompt.includes('how can we help') ||
    prompt.includes('what do you need help with') ||
    prompt.includes('what can we help with') ||
    prompt.includes('what brings you in')
  ) {
    return 'issue_summary';
  }
  if (collectFieldNames.includes('caller_name')) return 'caller_name';
  if (collectFieldNames.includes('callback_phone')) return 'callback_phone';
  if (collectFieldNames.includes('email')) return 'email';
  if (collectFieldNames.includes('issue_summary')) return 'issue_summary';

  return 'generic';
}

function normalizeClientStatus(value: string | null | undefined): 'new' | 'existing' | null {
  if (!value) return null;
  const normalized = semanticNormalizeText(value);
  if (!normalized) return null;

  const tokens = keywordTokens(normalized);
  const existingScore = scoreRegexMatches(normalized, EXISTING_CLIENT_PATTERNS)
    + tokens.filter((token) => token === 'existing').length;
  const newScore = scoreRegexMatches(normalized, NEW_CLIENT_PATTERNS)
    + tokens.filter((token) => token === 'new').length;

  if (existingScore > newScore && existingScore > 0) {
    return 'existing';
  }

  if (newScore > existingScore && newScore > 0) {
    return 'new';
  }

  if (normalized === 'existing') return 'existing';
  if (normalized === 'new' || normalized.includes('prospective')) return 'new';

  return null;
}

function normalizeCallingFor(value: string | null | undefined): 'self' | 'other' | null {
  if (!value) return null;
  const normalized = semanticNormalizeText(value);
  if (!normalized) return null;

  const selfScore = scoreRegexMatches(normalized, SELF_PATTERNS)
    + (/\b(just me|me personally|my problem|my legal issue)\b/.test(normalized) ? 1 : 0);
  const otherScore = scoreRegexMatches(normalized, OTHER_PATTERNS)
    + (/\b(for|calling for|it s for)\s+(my|our|a)\s+(friend|mother|mom|father|dad|sister|brother|son|daughter|child|children|husband|wife|spouse|partner|boyfriend|girlfriend|grandmother|grandfather|grandma|grandpa|uncle|aunt|cousin|neighbor|roommate)\b/.test(normalized) ? 2 : 0);

  if (otherScore > selfScore && otherScore > 0) {
    return 'other';
  }

  if (selfScore > otherScore && selfScore > 0) {
    return 'self';
  }

  if (normalized === 'self' || normalized === 'myself') return 'self';

  return null;
}

function hasExplicitClientContext(value: string): boolean {
  return /\b(client|firm|office|reach(?:ing)? out|worked with|used your firm|called before|returning|old client|current client|existing client|new client)\b/.test(value);
}

function parseYesNo(value: string): 'yes' | 'no' | null {
  const normalized = semanticNormalizeText(stripLeadingDisfluencies(value));
  if (!normalized) return null;
  if (
    /^(yes|yeah|yep|yup|sure|correct|right|please do|ok|okay)\b/.test(normalized) ||
    /\b(let s|lets)\s+(go|begin|start)\b/.test(normalized) ||
    /\bbegin\b/.test(normalized) ||
    /\bthat works\b/.test(normalized) ||
    /\bthis (number|one) (is )?(fine|works|okay|ok|good)\b/.test(normalized) ||
    /\bsame number\b/.test(normalized) ||
    /\bstart\b/.test(normalized)
  ) {
    return 'yes';
  }
  if (/^(no|nope|nah|not really)\b/.test(normalized) || /\bdifferent number\b/.test(normalized) || /\bnot this number\b/.test(normalized)) return 'no';
  return null;
}

function isMixedSituationResponse(value: string): boolean {
  const normalized = semanticNormalizeText(stripLeadingDisfluencies(value));
  if (!normalized) return false;

  return /\banother\b|\bdifferent\b|\bon the other\b|\bat the same time\b|\balso\b|\bone\b.+\banother\b/.test(normalized);
}

function isUncertainResponse(value: string): boolean {
  const normalized = semanticNormalizeText(stripLeadingDisfluencies(value));
  if (!normalized) return false;

  return /\b(i don t know|i do not know|dont know|do not know|not sure|unsure|i m not sure|i am not sure|no idea|i have no idea|hard to say)\b/.test(normalized);
}

function isExplanationRequest(value: string): boolean {
  const normalized = semanticNormalizeText(stripLeadingDisfluencies(value));
  if (!normalized) return false;

  return /\b(how do i tell|how can i tell|how would i know|what s the difference|what is the difference|i don t know the difference|i do not know the difference|have no idea what the difference is|no idea what the difference is|what does that mean|what do you mean|not sure which|which one|how do i know|what was that last part|can you repeat that|say that again|repeat that)\b/.test(normalized)
    || extractDefinitionRequestTerm(normalized) !== null;
}

function isSkipRequestResponse(value: string): boolean {
  const normalized = semanticNormalizeText(stripLeadingDisfluencies(value));
  if (!normalized) return false;

  return /\b(move on|can we move on|could we move on|go ahead and move on|let s move on|lets move on|skip (it|this|that)|next question|go to the next|whatever you think|i don t know,? move on|i do not know,? move on)\b/.test(normalized);
}

function isGetStartedExplanationRequest(value: string): boolean {
  const normalized = semanticNormalizeText(stripLeadingDisfluencies(value));
  if (!normalized) return false;

  return /\bwhat\b.*\bfor\b|\bwhy\b.*\b(call|asking|ask|question|questions|need|doing)\b|\bwhat is this for\b|\bwhat s this for\b/.test(normalized);
}

function isGetStartedDeclineResponse(value: string): boolean {
  const normalized = semanticNormalizeText(stripLeadingDisfluencies(value));
  if (!normalized) return false;

  return parseYesNo(value) === 'no'
    || /\b(not now|maybe later|call back later|rather not|do not want to|don t want to|not interested|i m good|i am good|i m okay|i am okay)\b/.test(normalized);
}

function buildGetStartedExplanationMessage(): string {
  return "Of course. I just ask a few quick questions so I can understand your situation and get it to the right lawyer. Would you like to get started?";
}

function buildGetStartedDeclineGoodbye(): string {
  return 'No problem. If you need legal help later, feel free to call us back. Goodbye.';
}

function isHelloCheck(value: string): boolean {
  const normalized = normalizeText(stripLeadingDisfluencies(value));
  return /^(?:(?:hello|hello there|are you there|you there|can you hear me|still there)[\s?!.]*)+$/.test(normalized);
}

function hasCorrectionCue(value: string): boolean {
  const normalized = semanticNormalizeText(stripLeadingDisfluencies(value));
  if (!normalized) return false;

  return /\b(actually|sorry|correction|i mean|meant|never mind|wait|hold on|rather|instead)\b/.test(normalized);
}

function isClearlyWrongNumberMatter(value: string): boolean {
  const normalized = semanticNormalizeText(stripLeadingDisfluencies(value));
  if (!normalized) return false;

  const legalAreaMatch = identifyLegalAreaMatch(normalized);
  const hasExplicitLegalContext = /\b(lawyer|attorney|sued|lawsuit|court|judge|hearing|summons|charge|arrest|custody|divorce|support|visa|deport|audit|irs|probate|estate|bankruptcy|injur|accident|rights|citation|traffic ticket|speeding ticket|parking ticket|scam|scammed|fraud|fraudulent|stole my money|stolen money|identity theft|impersonat)\b/.test(normalized);
  if (hasExplicitLegalContext || (legalAreaMatch.area !== 'other' && legalAreaMatch.score > 0)) {
    return false;
  }

  return (
    /\b(ticketmaster|stubhub|eventbrite|concert ticket|event ticket|show ticket|ticketing agency|reservation number|booking reference|flight reservation|hotel reservation|travel agency|airline booking|airline ticket|hotel booking|customer service for my order|order status|track my package|delivery status)\b/.test(normalized)
    || /\b(is this|did i reach|are you)\b.*\b(ticket(ing)?|reservation|booking|airline|hotel|travel|customer service|support)\b/.test(normalized)
    || /\b(cancel|change|confirm|get a refund for|refund for|refund on)\b.*\b(ticket|reservation|booking|flight|hotel|order)\b/.test(normalized)
  );
}

function isExplicitScamOrWrongNumberConfession(value: string): boolean {
  const normalized = semanticNormalizeText(stripLeadingDisfluencies(value));
  if (!normalized) return false;

  return /\b(wrong number|not trying to reach a lawyer|not looking for legal help|i m a scam caller|i am a scam caller|this is a prank call|prank call|test call)\b/.test(normalized);
}

function extractDefinitionRequestTerm(value: string): string | null {
  const normalized = semanticNormalizeText(stripLeadingDisfluencies(value));
  if (!normalized) return null;

  const patterns = [
    /\bwhat (?:is|s)\s+(?:a |an |the )?([a-z][a-z\s-]{1,40})\b/,
    /\bwhat does\s+(?:a |an |the )?([a-z][a-z\s-]{1,40})\s+mean\b/,
    /\bwhat do you mean by\s+(?:a |an |the )?([a-z][a-z\s-]{1,40})\b/,
    /\bwho counts as\s+(?:a |an |the )?([a-z][a-z\s-]{1,40})\b/,
    /\bwhat counts as\s+(?:a |an |the )?([a-z][a-z\s-]{1,40})\b/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match?.[1]) continue;
    const term = match[1]
      .replace(/\b(?:here|there|exactly|again|please)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (term) return term;
  }

  return null;
}

function getWrongNumberMessage(): string {
  return "You've reached a law firm, so I think you may have the wrong number. If you need legal help, you're welcome to call us back. Goodbye.";
}

function hasStrongLegalContext(value: string | null | undefined): boolean {
  const normalized = semanticNormalizeText(value || '');
  if (!normalized) return false;

  const legalAreaMatch = identifyLegalAreaMatch(normalized);
  if (legalAreaMatch.area !== 'other' && legalAreaMatch.score > 0) {
    return true;
  }

  return /\b(lawyer|attorney|sued|lawsuit|court|judge|hearing|summons|charge|arrest|custody|divorce|support|visa|deport|audit|irs|probate|estate|bankruptcy|injur|accident|rights|citation|traffic ticket|speeding ticket|parking ticket|crime|criminal|dui|immigration|employment|eviction|foreclosure|scam|scammed|fraud|fraudulent|identity theft|impersonat)\b/.test(normalized);
}

function shouldTreatAsWrongNumber(
  answer: string,
  currentQuestionKind: QuestionKind,
  state: HydratedFlowRuntimeState,
  context: FlowProgressContext,
): boolean {
  const semanticFit = context.semanticFacts?.conversationFit || null;
  const questionState = resolveQuestionState(answer, context.semanticFacts);
  const latestIssueSummary = latestValue(state, 'issue_summary', 'issueSummary');
  const semanticIssueSummary = context.semanticFacts?.issueSummary || null;
  const combinedLegalContext = [answer, latestIssueSummary, semanticIssueSummary]
    .filter(Boolean)
    .join(' ');
  const explicitWrongNumber = isExplicitScamOrWrongNumberConfession(answer);

  if (explicitWrongNumber) {
    return true;
  }

  if (semanticFit === 'wrong_number') {
    if (questionState === 'off_topic') {
      return !hasStrongLegalContext(answer);
    }
    return !hasStrongLegalContext(combinedLegalContext);
  }

  if (semanticFit === 'legal_intake') {
    return false;
  }

  if (currentQuestionKind === 'issue_summary') {
    return isClearlyWrongNumberMatter(answer);
  }

  if ((questionState === 'off_topic' || questionState === 'wants_to_skip') && isClearlyWrongNumberMatter(answer)) {
    return true;
  }

  return false;
}

function resolveQuestionState(
  answer: string,
  semanticFacts?: SemanticCallerFacts | null,
): SemanticQuestionState {
  if (semanticFacts?.questionState) {
    return semanticFacts.questionState;
  }
  if (isSkipRequestResponse(answer)) return 'wants_to_skip';
  if (isExplanationRequest(answer)) return 'needs_explanation';
  if (isUncertainResponse(answer)) return 'uncertain';
  return 'unclear';
}

function parsePhoneNumberCandidate(value: string): string | null {
  return normalizeOptionalPhoneNumber(value);
}

function parseEmailCandidate(value: string): string | null {
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].trim() : null;
}

function mergeCallerFacts(
  inferred: InferredCallerFacts,
  semanticFacts: SemanticCallerFacts | null | undefined,
): InferredCallerFacts {
  if (!semanticFacts) return inferred;

  const merged: InferredCallerFacts = { ...inferred };

  if (semanticFacts.callerName) {
    const normalizedName = parseNameCandidate(semanticFacts.callerName);
    if (normalizedName) merged.callerName = normalizedName;
  }

  if (semanticFacts.callerPhone) {
    const normalizedPhone = normalizeOptionalPhoneNumber(semanticFacts.callerPhone);
    if (normalizedPhone) merged.callerPhone = normalizedPhone;
  }

  if (semanticFacts.callerEmail) {
    const normalizedEmail = parseEmailCandidate(semanticFacts.callerEmail);
    if (normalizedEmail) merged.callerEmail = normalizedEmail;
  }

  if (semanticFacts.clientStatus === 'new' || semanticFacts.clientStatus === 'existing') {
    merged.clientStatus = semanticFacts.clientStatus;
  }

  if (semanticFacts.callingFor === 'self' || semanticFacts.callingFor === 'other') {
    merged.callingFor = semanticFacts.callingFor;
  }

  if (semanticFacts.issueSummary && semanticFacts.issueSummary.trim()) {
    merged.issueSummary = semanticFacts.issueSummary.trim();
  }

  return merged;
}

function parseNameCandidate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/(?:my name is|this is|i am|i'm)\s+([a-z][a-z.'-]*(?:\s+[a-z][a-z.'-]*){0,3})/i);
  const candidate = (match?.[1] || trimmed)
    .split(/\b(?:and|about|calling|regarding|because|for|since|i am|i'm)\b/i)[0]
    .trim();
  const cleaned = candidate.replace(/[.?!]+$/g, '').trim();
  const normalized = semanticNormalizeText(cleaned);
  if (!cleaned || /\d/.test(cleaned) || keywordTokens(cleaned).length === 0) return null;
  if (NON_NAME_PATTERNS.some((pattern) => pattern.test(normalized))) return null;
  return cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function parseApproximateAgeInDays(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = semanticNormalizeText(trimmed);
  if (/\btoday\b/.test(normalized)) return 0;
  if (/\byesterday\b/.test(normalized)) return 1;
  if (/\blast week\b/.test(normalized)) return 7;
  if (/\bthis week\b/.test(normalized)) return 3;
  if (/\blast month\b/.test(normalized)) return 30;
  if (/\bthis month\b/.test(normalized)) return 15;
  if (/\blast year\b/.test(normalized)) return 365;
  if (/\bthis year\b/.test(normalized)) return 180;
  if (/\blast (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(normalized)) return 7;

  const relativeMatch = normalized.match(/\b(?:(a|an)|(\d+))\s+(day|week|month|year)s?\s+ago\b/);
  if (relativeMatch) {
    const count = relativeMatch[1] ? 1 : parseInt(relativeMatch[2] || '0', 10);
    const unit = relativeMatch[3];
    if (unit === 'day') return count;
    if (unit === 'week') return count * 7;
    if (unit === 'month') return count * 30;
    if (unit === 'year') return count * 365;
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    const now = Date.now();
    if (parsed <= now) {
      return Math.floor((now - parsed) / (1000 * 60 * 60 * 24));
    }
  }

  return null;
}

function matchDateRangeEdge(edges: FlowEdgeLike[], flow: FlowLike, response: string): FlowEdgeLike | null {
  const ageInDays = parseApproximateAgeInDays(response);
  if (ageInDays == null) return null;

  for (const edge of edges) {
    const target = getNodeById(flow, edge.targetNodeId);
    const signals = deriveMatchSignals(target, edge).map((signal) => semanticNormalizeText(signal)).join(' ');
    if (/(within the last 30 days|last 30 days)/.test(signals) && ageInDays <= 30) return edge;
    if (/(1 to 12 months|12 months|1 year)/.test(signals) && ageInDays > 30 && ageInDays <= 365) return edge;
    if (/(1 to 3 years|3 years)/.test(signals) && ageInDays > 365 && ageInDays <= 365 * 3) return edge;
    if (/(more than 3 years|over 3 years|older than 3 years)/.test(signals) && ageInDays > 365 * 3) return edge;
  }

  return null;
}

function extractPreferredDateTime(answer: string): Record<string, string> {
  const trimmed = answer.trim();
  if (!trimmed) return {};

  const atMatch = trimmed.match(/^(.*?)(?:\s+at\s+|\s*@\s*)(.+)$/i);
  if (atMatch) {
    return {
      preferred_date: atMatch[1].trim(),
      preferred_time: atMatch[2].trim(),
    };
  }

  const commaParts = trimmed.split(',');
  if (commaParts.length >= 2) {
    return {
      preferred_date: commaParts.slice(0, -1).join(',').trim(),
      preferred_time: commaParts[commaParts.length - 1].trim(),
    };
  }

  return { preferred_date: trimmed };
}

function extractChildrenDetails(answer: string): Record<string, string> {
  const trimmed = answer.trim();
  if (!trimmed) return {};
  const countMatch = trimmed.match(/\b(\d+)\b/);
  return {
    ...(countMatch ? { num_children: countMatch[1] } : {}),
    children_ages: trimmed,
  };
}

function extractIncidentDetails(answer: string): Record<string, string> {
  const trimmed = answer.trim();
  if (!trimmed) return {};

  const splitMatch = trimmed.match(/^(.+?)(?:,|\band\b)(.+)$/i);
  if (splitMatch) {
    const possibleDate = splitMatch[1].trim();
    const possibleInjury = splitMatch[2].trim();
    if (
      parseApproximateAgeInDays(possibleDate) != null ||
      /\b(today|yesterday|last|this|ago|month|year|week|day)\b/.test(semanticNormalizeText(possibleDate))
    ) {
      return {
        incident_date: possibleDate,
        injury_description: possibleInjury,
      };
    }
  }

  if (parseApproximateAgeInDays(trimmed) != null) {
    return { incident_date: trimmed };
  }

  if (/\b(broke|broken|injur|hurt|pain|fracture|bleeding|whiplash|concussion|arm|leg|back|neck|head)\b/.test(semanticNormalizeText(trimmed))) {
    return { injury_description: trimmed };
  }

  return {};
}

function latestValue(state: HydratedFlowRuntimeState, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = state.fieldValues[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function buildQuestionAnswerWrites(flow: FlowLike, node: FlowNodeLike, answer: string, context: FlowProgressContext): FlowRuntimeWrite[] {
  const writes: FlowRuntimeWrite[] = [{
    fieldName: `${FLOW_ANSWER_PREFIX}${node.id}`,
    fieldValue: answer.trim(),
    nodeId: node.id,
  }];

  const kind = classifyQuestion(node);
  const collectFields = Array.isArray(node.config?.collectFields) ? node.config.collectFields : [];
  const isBranchingQuestion = getSortedOutgoingEdges(flow, node.id).length > 1;

  const addField = (fieldName: string, fieldValue: string | null | undefined) => {
    if (!fieldValue || !fieldValue.trim()) return;
    writes.push({
      fieldName,
      fieldValue: fieldValue.trim(),
      nodeId: node.id,
    });
  };

  const inferredFacts = mergeCallerFacts(
    inferCallerFacts(answer, kind),
    context.semanticFacts,
  );
  const specialParsedFields = new Set(['caller_name', 'callback_phone', 'email', 'issue_summary']);

  if (context.sessionCallerPhone) {
    addField('call_origin_phone', context.sessionCallerPhone);
    addField('callOriginPhone', context.sessionCallerPhone);
  }

  if (collectFields.length > 0) {
    if (collectFields.length === 1) {
      const fieldName = collectFields[0]?.name;
      if (typeof fieldName === 'string' && fieldName.trim()) {
        if (fieldName === 'preferred_date' || fieldName === 'preferred_time') {
          const extracted = extractPreferredDateTime(answer);
          addField(fieldName, extracted[fieldName] || answer.trim());
        } else if (specialParsedFields.has(fieldName)) {
          // Handled by the question-kind switch below so we can normalize values first.
        } else if (!isBranchingQuestion || (!isUncertainResponse(answer) && !isExplanationRequest(answer))) {
          addField(fieldName, answer.trim());
        }
      }
    } else {
      const fieldNames = collectFields
        .map((field: any) => typeof field?.name === 'string' ? field.name : null)
        .filter((fieldName: string | null): fieldName is string => Boolean(fieldName));

      if (fieldNames.includes('preferred_date') || fieldNames.includes('preferred_time')) {
        const extracted = extractPreferredDateTime(answer);
        for (const fieldName of fieldNames) {
          addField(fieldName, extracted[fieldName] || null);
        }
      } else if (fieldNames.includes('num_children') || fieldNames.includes('children_ages')) {
        const extracted = extractChildrenDetails(answer);
        for (const fieldName of fieldNames) {
          addField(fieldName, extracted[fieldName] || null);
        }
      } else if (fieldNames.includes('incident_date') || fieldNames.includes('injury_description')) {
        const extracted = extractIncidentDetails(answer);
        for (const fieldName of fieldNames) {
          addField(fieldName, extracted[fieldName] || null);
        }
      } else if (!isBranchingQuestion && !isUncertainResponse(answer) && !isExplanationRequest(answer)) {
        for (const fieldName of fieldNames) {
          addField(fieldName, answer.trim());
        }
      }
    }
  }

  switch (kind) {
    case 'caller_name':
      {
        const parsedName = parseNameCandidate(answer);
        if (parsedName) {
          addField('caller_name', parsedName);
          addField('callerName', parsedName);
        }
      }
      break;
    case 'callback_phone': {
      const parsedPhone = inferredFacts.callerPhone
        || ((parseYesNo(answer) === 'yes' || /\b(same number|same one|the same one)\b/.test(semanticNormalizeText(answer)))
          ? context.sessionCallerPhone || null
          : null);
      if (parsedPhone) {
        addField('callback_phone', parsedPhone);
        addField('callbackPhone', parsedPhone);
        addField('callerPhone', parsedPhone);
      }
      break;
    }
    case 'best_phone_confirm':
      if (parseYesNo(answer) === 'yes' && context.sessionCallerPhone) {
        addField('callback_phone', context.sessionCallerPhone);
        addField('callbackPhone', context.sessionCallerPhone);
        addField('callerPhone', context.sessionCallerPhone);
      } else if (inferredFacts.callerPhone) {
        addField('callback_phone', inferredFacts.callerPhone);
        addField('callbackPhone', inferredFacts.callerPhone);
        addField('callerPhone', inferredFacts.callerPhone);
      }
      break;
    case 'email': {
      if (inferredFacts.callerEmail) {
        addField('email', inferredFacts.callerEmail);
        addField('callerEmail', inferredFacts.callerEmail);
      }
      break;
    }
    case 'client_status': {
      const status = normalizeClientStatus(answer);
      if (status) addField('clientStatus', status);
      break;
    }
    case 'calling_for': {
      const callingFor = normalizeCallingFor(answer);
      if (callingFor) addField('callingFor', callingFor);
      break;
    }
    case 'issue_summary':
      if (isPlausibleIssueSummaryResponse(answer, context.semanticFacts)) {
        addField('issue_summary', answer.trim());
        addField('issueSummary', answer.trim());
      }
      break;
    default:
      break;
  }

  if (inferredFacts.clientStatus) {
    addField('clientStatus', inferredFacts.clientStatus);
  }
  if (inferredFacts.callingFor) {
    addField('callingFor', inferredFacts.callingFor);
  }
  if (inferredFacts.callerEmail) {
    addField('email', inferredFacts.callerEmail);
    addField('callerEmail', inferredFacts.callerEmail);
  }
  if (inferredFacts.callerPhone) {
    addField('callback_phone', inferredFacts.callerPhone);
    addField('callbackPhone', inferredFacts.callerPhone);
    addField('callerPhone', inferredFacts.callerPhone);
  }
  if (inferredFacts.callerName) {
    addField('caller_name', inferredFacts.callerName);
    addField('callerName', inferredFacts.callerName);
  }
  if (inferredFacts.issueSummary && isPlausibleIssueSummaryResponse(inferredFacts.issueSummary, context.semanticFacts)) {
    addField('issue_summary', inferredFacts.issueSummary);
    addField('issueSummary', inferredFacts.issueSummary);
  }

  return writes;
}

function inferCallerFacts(answer: string, questionKind: QuestionKind): InferredCallerFacts {
  const inferred: InferredCallerFacts = {};
  const stripped = stripLeadingDisfluencies(answer).trim();
  if (!stripped) return inferred;

  const clientStatus = normalizeClientStatus(stripped);
  if (clientStatus && (questionKind === 'client_status' || hasExplicitClientContext(semanticNormalizeText(stripped)))) {
    inferred.clientStatus = clientStatus;
  }

  const callingFor = normalizeCallingFor(stripped);
  if (callingFor) {
    inferred.callingFor = callingFor;
  }

  const callerEmail = parseEmailCandidate(stripped);
  if (callerEmail) {
    inferred.callerEmail = callerEmail;
  }

  const callerPhone = parsePhoneNumberCandidate(stripped);
  if (callerPhone) {
    inferred.callerPhone = callerPhone;
  }

  if (questionKind === 'caller_name' || /\b(my name is|this is)\b/i.test(stripped)) {
    const callerName = parseNameCandidate(stripped);
    if (callerName) {
      inferred.callerName = callerName;
    }
  }

  const inferredAreaMatch = identifyLegalAreaMatch(stripped);
  const inferredArea = inferredAreaMatch.area;
  if (
    questionKind === 'issue_summary' ||
    (
      inferredArea !== 'other' &&
      keywordTokens(stripped).length >= 3 &&
      (hasIssueLeadIn(stripped) || inferredAreaMatch.score >= 2)
    )
  ) {
    if (isPlausibleIssueSummaryResponse(stripped, null)) {
      inferred.issueSummary = stripped;
    }
  }

  return inferred;
}

function hasUsableCurrentQuestionAnswer(
  flow: FlowLike,
  node: FlowNodeLike,
  answer: string,
  context: FlowProgressContext,
): boolean {
  const kind = classifyQuestion(node);
  const trimmed = answer.trim();
  const semanticFacts = context.semanticFacts;
  if (!trimmed) return false;

  switch (kind) {
    case 'get_started':
      return parseYesNo(trimmed) !== null;
    case 'client_status':
      return normalizeClientStatus(trimmed) !== null || Boolean(semanticFacts?.clientStatus);
    case 'caller_name':
      return parseNameCandidate(trimmed) !== null || Boolean(parseNameCandidate(semanticFacts?.callerName || ''));
    case 'best_phone_confirm':
      return matchBestPhoneConfirmEdge(getSortedOutgoingEdges(flow, node.id), flow, trimmed) !== null;
    case 'callback_phone':
      return validateStructuredQuestionAnswer(node, trimmed, context) === null;
    case 'email':
      return validateStructuredQuestionAnswer(node, trimmed, context) === null;
    case 'calling_for':
      return normalizeCallingFor(trimmed) !== null || Boolean(semanticFacts?.callingFor);
    case 'issue_summary':
      return Boolean(mergeCallerFacts(inferCallerFacts(trimmed, kind), semanticFacts).issueSummary);
    default:
      return false;
  }
}

function hasMeaningfulOffQuestionFact(
  currentKind: QuestionKind,
  inferredFacts: InferredCallerFacts,
  state: HydratedFlowRuntimeState,
  context: FlowProgressContext,
): boolean {
  const storedClientStatus = latestValue(state, 'clientStatus') || normalizeClientStatus(context.sessionClientType) || null;
  const storedCallingFor = latestValue(state, 'callingFor');
  const storedName = latestValue(state, 'caller_name', 'callerName');
  const storedPhone = latestValue(state, 'callback_phone', 'callbackPhone', 'callerPhone');
  const storedEmail = latestValue(state, 'email', 'callerEmail');

  return (
    (currentKind !== 'client_status' && Boolean(inferredFacts.clientStatus) && inferredFacts.clientStatus !== storedClientStatus)
    || (currentKind !== 'calling_for' && Boolean(inferredFacts.callingFor) && inferredFacts.callingFor !== storedCallingFor)
    || (currentKind !== 'caller_name' && Boolean(inferredFacts.callerName) && inferredFacts.callerName !== storedName)
    || (currentKind !== 'callback_phone' && currentKind !== 'best_phone_confirm' && Boolean(inferredFacts.callerPhone) && inferredFacts.callerPhone !== storedPhone)
    || (currentKind !== 'email' && Boolean(inferredFacts.callerEmail) && inferredFacts.callerEmail !== storedEmail)
  );
}

function getNodeById(flow: FlowLike, nodeId: string | null): FlowNodeLike | undefined {
  return nodeId ? flow.nodes.find((node) => node.id === nodeId) : undefined;
}

function findFirstQuestionByKind(flow: FlowLike, kind: QuestionKind): FlowNodeLike | null {
  return flow.nodes.find((node) => node.type === 'question' && classifyQuestion(node) === kind) || null;
}

function getSortedOutgoingEdges(flow: FlowLike, nodeId: string): FlowEdgeLike[] {
  return flow.edges
    .filter((edge) => edge.sourceNodeId === nodeId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

function getFirstInteractiveNode(flow: FlowLike): FlowNodeLike | null {
  const startNode = flow.nodes.find((node) => node.type === 'start');
  if (!startNode) return null;
  const firstEdge = getSortedOutgoingEdges(flow, startNode.id)[0];
  if (!firstEdge) return null;
  return getNodeById(flow, firstEdge.targetNodeId) || null;
}

function deriveChoiceLabel(targetNode: FlowNodeLike | undefined, edge: FlowEdgeLike): string {
  if (typeof edge.label === 'string' && edge.label.trim()) return edge.label.trim();
  if (!targetNode) return 'continue';

  const response = typeof targetNode.config?.response === 'string'
    ? targetNode.config.response.trim()
    : '';
  if (response) return response;

  const flagValue = typeof targetNode.config?.flagValue === 'string'
    ? targetNode.config.flagValue.trim()
    : '';
  if (flagValue) return flagValue;

  return targetNode.label;
}

function deriveMatchSignals(targetNode: FlowNodeLike | undefined, edge: FlowEdgeLike): string[] {
  const signals = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    signals.add(trimmed);
    const withParentheticals = trimmed.replace(/\(([^)]+)\)/g, ', $1,');
    for (const segment of withParentheticals.split(/[/:(),-]|\s+\bor\b\s+|\s+\band\b\s+/i)) {
      const piece = segment
        .replace(/^(?:yes|no|other)\s*-\s*/i, '')
        .trim();
      if (piece.length >= 3) signals.add(piece);
    }
  };

  add(edge.label);
  if (targetNode) {
    add(targetNode.label);
    add(targetNode.config?.response);
    add(targetNode.config?.instruction);
    add(targetNode.config?.note);
    add(targetNode.config?.flagValue);
    add(targetNode.config?.petitionType);
  }

  return [...signals];
}

function isGenericAreaBucketChoice(
  inferredArea: string,
  choiceLabel: string,
  targetText: string,
): boolean {
  const normalizedArea = inferredArea.replace('_', ' ');
  const normalizedChoice = normalizeText(choiceLabel);
  const normalizedTargetText = normalizeText(targetText);

  return normalizedChoice === normalizedArea
    || normalizedChoice === `${normalizedArea} law`
    || normalizedChoice === `${normalizedArea} issue`
    || normalizedChoice === `${normalizedArea} matter`
    || (normalizedChoice.includes(normalizedArea) && normalizedChoice.split(' ').length <= 3)
    || normalizedTargetText.includes(`caller s situation involves ${normalizedArea}`)
    || normalizedTargetText.includes(`involves ${normalizedArea}`);
}

function hasIssueLeadIn(value: string): boolean {
  return /\b(about|regarding|because|going through|dealing with|need help|help with|calling about|issue is|problem is|matter is)\b/i.test(value);
}

function isPlausibleIssueSummaryResponse(
  answer: string,
  semanticFacts?: SemanticCallerFacts | null,
): boolean {
  const stripped = stripLeadingDisfluencies(answer).trim();
  const normalized = semanticNormalizeText(stripped);
  if (!normalized) return false;

  if (semanticFacts?.questionState && semanticFacts.questionState !== 'answered' && semanticFacts.questionState !== 'unclear') {
    return false;
  }
  if (semanticFacts?.conversationFit === 'wrong_number') {
    return false;
  }
  if (semanticFacts?.issueSummary?.trim()) {
    return true;
  }
  if (isUncertainResponse(stripped) || isExplanationRequest(stripped) || isSkipRequestResponse(stripped) || isHelloCheck(stripped)) {
    return false;
  }

  const areaMatch = identifyLegalAreaMatch(stripped);
  const tokens = keywordTokens(stripped);

  if (semanticFacts?.conversationFit === 'legal_intake') {
    return true;
  }
  if (hasStrongLegalContext(stripped) || areaMatch.score >= 2) {
    return true;
  }
  if (hasIssueLeadIn(stripped) && tokens.length >= 3) {
    return true;
  }

  return false;
}

function scoreSignal(answerText: string, signal: string): number {
  const normalizedAnswer = semanticNormalizeText(answerText);
  const normalizedSignal = semanticNormalizeText(signal);
  if (!normalizedAnswer || !normalizedSignal) return 0;

  if (
    (normalizedSignal.length >= 8 && normalizedAnswer.includes(normalizedSignal)) ||
    (normalizedAnswer.length >= 8 && normalizedSignal.includes(normalizedAnswer))
  ) {
    return 8 + Math.min(normalizedSignal.split(' ').length, 4);
  }

  const keywords = keywordTokens(signal);
  if (keywords.length === 0) return 0;
  const answerKeywords = new Set(keywordTokens(answerText));
  const matched = keywords.filter((keyword) => answerKeywords.has(keyword) || normalizedAnswer.includes(keyword));
  return matched.length;
}

function getSingleCollectFieldName(node: FlowNodeLike): string | null {
  const collectFields = Array.isArray(node.config?.collectFields) ? node.config.collectFields : [];
  if (collectFields.length !== 1) return null;
  const fieldName = collectFields[0]?.name;
  return typeof fieldName === 'string' && fieldName.trim() ? fieldName.trim() : null;
}

function validateStructuredQuestionAnswer(
  node: FlowNodeLike,
  answer: string,
  context: FlowProgressContext,
): string | null {
  const kind = classifyQuestion(node);
  const singleFieldName = getSingleCollectFieldName(node);
  const normalizedAnswer = semanticNormalizeText(stripLeadingDisfluencies(answer));
  const semanticFacts = context.semanticFacts;

  if (kind === 'caller_name' || singleFieldName === 'caller_name') {
    if (parseNameCandidate(answer) || parseNameCandidate(semanticFacts?.callerName || '')) return null;
    return "I didn't catch the name. Could I start with your first and last name?";
  }

  if (kind === 'callback_phone' || singleFieldName === 'callback_phone') {
    if (parsePhoneNumberCandidate(answer) || normalizeOptionalPhoneNumber(semanticFacts?.callerPhone || '')) return null;
    if (context.sessionCallerPhone && (parseYesNo(answer) === 'yes' || /\b(same number|same one|the same one)\b/.test(normalizedAnswer))) {
      return null;
    }
    return "I didn't catch the callback number. What is the best callback number for you?";
  }

  if (kind === 'email' || singleFieldName === 'email') {
    if (parseEmailCandidate(answer) || parseEmailCandidate(semanticFacts?.callerEmail || '')) return null;
    return "I didn't catch the email address. What email should we use to follow up?";
  }

  return null;
}

function matchAssistantChoiceLabelEdge(
  edges: FlowEdgeLike[],
  flow: FlowLike,
  matchedChoiceLabel: string | null | undefined,
): FlowEdgeLike | null {
  const normalizedHint = semanticNormalizeText(matchedChoiceLabel || '');
  if (!normalizedHint) return null;

  let bestEdge: FlowEdgeLike | null = null;
  let bestScore = 0;

  for (const edge of edges) {
    const target = getNodeById(flow, edge.targetNodeId);
    const signals = [
      deriveChoiceLabel(target, edge),
      ...deriveMatchSignals(target, edge),
    ];

    for (const signal of signals) {
      const normalizedSignal = semanticNormalizeText(signal);
      if (!normalizedSignal) continue;

      let score = 0;
      if (normalizedSignal === normalizedHint) {
        score = 100;
      } else if (
        normalizedSignal.length >= 6 &&
        normalizedHint.length >= 6 &&
        (normalizedSignal.includes(normalizedHint) || normalizedHint.includes(normalizedSignal))
      ) {
        score = 90;
      } else {
        score = scoreSignal(normalizedHint, signal) * 10;
      }

      if (score > bestScore) {
        bestScore = score;
        bestEdge = edge;
      }
    }
  }

  return bestScore >= 20 ? bestEdge : null;
}

function matchClientStatusEdge(edges: FlowEdgeLike[], flow: FlowLike, value: string): FlowEdgeLike | null {
  const normalized = normalizeClientStatus(value);
  if (!normalized) return null;

  return edges.find((edge) => {
    const target = getNodeById(flow, edge.targetNodeId);
    const signals = deriveMatchSignals(target, edge).map((signal) => normalizeText(signal)).join(' ');
    return normalized === 'existing'
      ? /(existing|current|worked with)/.test(signals)
      : /(new|first time|prospective)/.test(signals);
  }) || null;
}

function matchCallingForEdge(edges: FlowEdgeLike[], flow: FlowLike, value: string): FlowEdgeLike | null {
  const normalized = normalizeCallingFor(value);
  if (!normalized) return null;

  return edges.find((edge) => {
    const target = getNodeById(flow, edge.targetNodeId);
    const signals = deriveMatchSignals(target, edge).map((signal) => normalizeText(signal)).join(' ');
    return normalized === 'self'
      ? /(for myself|self|myself)/.test(signals)
      : /(someone else|on behalf|other)/.test(signals);
  }) || null;
}

function matchYesNoEdge(edges: FlowEdgeLike[], flow: FlowLike, response: string): FlowEdgeLike | null {
  const yesNo = parseYesNo(response);
  if (!yesNo) return null;

  return edges.find((edge) => {
    const target = getNodeById(flow, edge.targetNodeId);
    const signals = deriveMatchSignals(target, edge).map((signal) => normalizeText(signal)).join(' ');
    return yesNo === 'yes'
      ? /\byes\b|\bfine\b|\bbegin\b|\bcorrect\b/.test(signals)
      : /\bno\b|\bdifferent\b/.test(signals);
  }) || null;
}

function matchBestPhoneConfirmEdge(edges: FlowEdgeLike[], flow: FlowLike, response: string): FlowEdgeLike | null {
  const explicit = matchYesNoEdge(edges, flow, response);
  if (explicit) return explicit;

  const inferredPhone = parsePhoneNumberCandidate(response);
  const normalized = semanticNormalizeText(response);
  if (inferredPhone || /\b(call|reach)\s+me\s+at\b|\bdifferent number\b|\bnot this number\b/.test(normalized)) {
    return edges.find((edge) => {
      const target = getNodeById(flow, edge.targetNodeId);
      const signals = deriveMatchSignals(target, edge).map((signal) => semanticNormalizeText(signal)).join(' ');
      return /\bno\b|\bdifferent\b|\buse a different number\b/.test(signals);
    }) || null;
  }

  return matchGenericEdge(edges, flow, response);
}

function matchIssueSummaryEdge(
  edges: FlowEdgeLike[],
  flow: FlowLike,
  response: string,
  semanticFacts?: SemanticCallerFacts | null,
): FlowEdgeLike | null {
  if (!isPlausibleIssueSummaryResponse(response, semanticFacts)) {
    return null;
  }

  const inferredAreaMatch = identifyLegalAreaMatch(response);
  const inferredArea = inferredAreaMatch.area;
  const candidates: Array<{ edge: FlowEdgeLike; score: number; isGenericAreaBucket: boolean }> = [];

  for (const edge of edges) {
    const target = getNodeById(flow, edge.targetNodeId);
    const signals = deriveMatchSignals(target, edge);
    let score = signals.reduce((max, signal) => Math.max(max, scoreSignal(response, signal)), 0);
    const targetText = normalizeText(signals.join(' '));
    const choiceLabel = deriveChoiceLabel(target, edge);
    const isGenericAreaBucket = isGenericAreaBucketChoice(inferredArea, choiceLabel, targetText);

    if (
      inferredArea !== 'other'
      && inferredAreaMatch.score > 0
      && targetText.includes(inferredArea.replace('_', ' '))
      && (score > 0 || isGenericAreaBucket)
    ) {
      score += isGenericAreaBucket ? 1 : 5;
    }

    candidates.push({ edge, score, isGenericAreaBucket });
  }

  const positiveCandidates = candidates.filter((candidate) => candidate.score > 0);
  if (positiveCandidates.length === 0) return null;

  positiveCandidates.sort((a, b) => b.score - a.score);
  const bestCandidate = positiveCandidates[0];
  const bestSpecificCandidate = positiveCandidates.find((candidate) => !candidate.isGenericAreaBucket);

  if (
    bestCandidate.isGenericAreaBucket
    && bestSpecificCandidate
    && bestSpecificCandidate.score >= Math.max(1, bestCandidate.score - 2)
  ) {
    return bestSpecificCandidate.edge;
  }

  return bestCandidate.edge;
}

function matchGenericEdge(edges: FlowEdgeLike[], flow: FlowLike, response: string): FlowEdgeLike | null {
  let bestEdge: FlowEdgeLike | null = null;
  let bestScore = 0;
  let secondBest = 0;

  for (const edge of edges) {
    const target = getNodeById(flow, edge.targetNodeId);
    const score = deriveMatchSignals(target, edge)
      .reduce((max, signal) => Math.max(max, scoreSignal(response, signal)), 0);

    if (score > bestScore) {
      secondBest = bestScore;
      bestScore = score;
      bestEdge = edge;
    } else if (score > secondBest) {
      secondBest = score;
    }
  }

  if (bestScore <= 0 || !bestEdge) return null;
  if (bestScore === secondBest && bestScore < 8) return null;
  if (findFallbackUncertaintyEdge(edges, flow) && isMixedSituationResponse(response) && bestScore <= 2) return null;
  if (findFallbackUncertaintyEdge(edges, flow) && bestScore === 1 && secondBest === 0) return null;
  return bestEdge;
}

function findConservativeSkipEdge(edges: FlowEdgeLike[], flow: FlowLike): FlowEdgeLike | null {
  if (edges.length !== 2) return null;

  const negativeCandidates = edges.filter((edge) => {
    const target = getNodeById(flow, edge.targetNodeId);
    const signals = deriveMatchSignals(target, edge).map((signal) => normalizeText(signal)).join(' ');
    return /\b(no|none|nope|not yet|not right now|no current|no order|no lawyer|no immediate urgency|no minor children|not involved|not represented|nothing filed|does not|don t|do not)\b/.test(signals);
  });

  return negativeCandidates.length === 1 ? negativeCandidates[0] : null;
}

function findConvergedFollowUpNodeId(flow: FlowLike, questionNodeId: string): string | null {
  const edges = getSortedOutgoingEdges(flow, questionNodeId);
  if (edges.length < 2) return null;

  const resolveNextInteractiveNodeId = (startNodeId: string): string | null => {
    let currentId: string | null = startNodeId;
    let safety = 0;

    while (currentId && safety < 12) {
      const currentNode = getNodeById(flow, currentId);
      if (!currentNode) return null;
      if (currentNode.type === 'question' || currentNode.type === 'transfer' || currentNode.type === 'end') {
        return currentNode.id;
      }
      const nextEdge = getSortedOutgoingEdges(flow, currentNode.id)[0];
      if (!nextEdge) return null;
      currentId = nextEdge.targetNodeId;
      safety += 1;
    }

    return null;
  };

  const candidateIds = edges
    .map((edge) => resolveNextInteractiveNodeId(edge.targetNodeId))
    .filter((value): value is string => Boolean(value));

  if (candidateIds.length !== edges.length) return null;
  const unique = [...new Set(candidateIds)];
  return unique.length === 1 ? unique[0] : null;
}

function matchSubstantiveFallbackEdge(
  node: FlowNodeLike,
  edges: FlowEdgeLike[],
  flow: FlowLike,
  response: string,
): FlowEdgeLike | null {
  const fallbackEdge = findFallbackUncertaintyEdge(edges, flow);
  if (!fallbackEdge) return null;

  const kind = classifyQuestion(node);
  if (kind === 'get_started' || kind === 'client_status' || kind === 'caller_name' || kind === 'best_phone_confirm' || kind === 'callback_phone' || kind === 'email' || kind === 'calling_for') {
    return null;
  }

  const normalized = semanticNormalizeText(stripLeadingDisfluencies(response));
  const tokens = keywordTokens(response);
  if (!normalized || tokens.length < 4) return null;

  return fallbackEdge;
}

function matchSkipIntentEdge(
  flow: FlowLike,
  node: FlowNodeLike,
  state: HydratedFlowRuntimeState,
  response: string,
  context: FlowProgressContext,
): FlowEdgeLike | null {
  const kind = classifyQuestion(node);
  if (isCoreQuestionKind(kind)) return null;

  const questionState = resolveQuestionState(response, context.semanticFacts);
  const clarifyCount = getClarifyCount(state, node.id);
  const shouldSkip =
    questionState === 'wants_to_skip'
    || questionState === 'off_topic'
    || ((questionState === 'uncertain' || questionState === 'needs_explanation') && clarifyCount >= MAX_NON_PROGRESS_RETRIES);

  if (!shouldSkip) return null;

  const edges = getSortedOutgoingEdges(flow, node.id);
  return findFallbackUncertaintyEdge(edges, flow)
    || findConservativeSkipEdge(edges, flow)
    || null;
}

function findLoopEscapeTarget(
  flow: FlowLike,
  node: FlowNodeLike,
  state: HydratedFlowRuntimeState,
  response: string,
  context: FlowProgressContext,
): { edge?: FlowEdgeLike | null; convergedNodeId?: string | null } | null {
  const kind = classifyQuestion(node);
  if (isCoreQuestionKind(kind)) return null;

  const clarifyCount = getClarifyCount(state, node.id);
  const questionState = resolveQuestionState(response, context.semanticFacts);
  const hasRepeatedNonProgress = clarifyCount >= MAX_NON_PROGRESS_RETRIES;
  const callerIsClearlyTryingToSkip =
    questionState === 'wants_to_skip'
    || questionState === 'off_topic'
    || (hasRepeatedNonProgress && (questionState === 'uncertain' || questionState === 'needs_explanation'));

  if (!hasRepeatedNonProgress && !callerIsClearlyTryingToSkip) {
    return null;
  }

  const edge = matchSkipIntentEdge(flow, node, state, response, context);
  if (edge) {
    return { edge };
  }

  const convergedNodeId = findConvergedFollowUpNodeId(flow, node.id);
  if (convergedNodeId) {
    return { convergedNodeId };
  }

  return null;
}

function matchEdgeForAnswer(
  flow: FlowLike,
  node: FlowNodeLike,
  response: string,
  matchedChoiceLabel?: string | null,
  semanticFacts?: SemanticCallerFacts | null,
): FlowEdgeLike | null {
  const edges = getSortedOutgoingEdges(flow, node.id);
  if (edges.length === 0) return null;
  if (edges.length === 1) return edges[0];

  const questionState = resolveQuestionState(response, semanticFacts);
  if (
    questionState === 'needs_explanation'
    || questionState === 'uncertain'
    || questionState === 'wants_to_skip'
    || questionState === 'off_topic'
  ) {
    return null;
  }

  const assistantChoiceMatch = matchAssistantChoiceLabelEdge(edges, flow, matchedChoiceLabel);
  if (assistantChoiceMatch) {
    return assistantChoiceMatch;
  }

  const contextualSemanticMatch = matchContextualSemanticEdge(node, edges, flow, response);
  if (contextualSemanticMatch) {
    return contextualSemanticMatch;
  }

  const kind = classifyQuestion(node);
  const specialized = (() => {
    switch (kind) {
      case 'get_started': {
        const whatIsThisFor = edges.find((edge) => {
          const target = getNodeById(flow, edge.targetNodeId);
          const signals = deriveMatchSignals(target, edge).map((signal) => normalizeText(signal)).join(' ');
          return signals.includes('what is this for');
        });
        if (/\bwhat\b.*\bfor\b|\bwhy\b/.test(normalizeText(response)) && whatIsThisFor) {
          return whatIsThisFor;
        }
        return matchYesNoEdge(edges, flow, response);
      }
      case 'client_status':
        return matchClientStatusEdge(edges, flow, semanticFacts?.clientStatus || response);
      case 'calling_for':
        return matchCallingForEdge(edges, flow, semanticFacts?.callingFor || response);
      case 'best_phone_confirm':
        return matchBestPhoneConfirmEdge(edges, flow, response);
      case 'issue_summary':
        return matchIssueSummaryEdge(edges, flow, response, semanticFacts);
      default:
        if (isFamilyLineOnlyFollowUpQuestion(node)) {
          return matchFamilyLineOnlyFollowUpEdge(edges, flow, response);
        }
        if (isDivorceUrgencyQuestion(node)) {
          return matchDivorceUrgencyEdge(edges, flow, response);
        }
        return null;
    }
  })();

  return specialized
    || matchDateRangeEdge(edges, flow, response)
    || matchGenericEdge(edges, flow, response)
    || matchSubstantiveFallbackEdge(node, edges, flow, response);
}

function resolvePreAnsweredAnswer(node: FlowNodeLike, state: HydratedFlowRuntimeState, context: FlowProgressContext): string | null {
  const kind = classifyQuestion(node);
  const collectFields = Array.isArray(node.config?.collectFields) ? node.config.collectFields : [];

  if (collectFields.length > 0) {
    const allCollected = collectFields.every((field: any) => {
      const fieldName = typeof field?.name === 'string' ? field.name : null;
      return fieldName ? Boolean(latestValue(state, fieldName)) : false;
    });
    if (allCollected) {
      return collectFields
        .map((field: any) => {
          const fieldName = typeof field?.name === 'string' ? field.name : '';
          return latestValue(state, fieldName) || '';
        })
        .filter(Boolean)
        .join(', ');
    }
  }

  switch (kind) {
    case 'client_status':
      if (context.assumeNewClients) return 'new';
      return latestValue(state, 'clientStatus') || normalizeClientStatus(context.sessionClientType) || null;
    case 'caller_name':
      return latestValue(state, 'caller_name', 'callerName');
    case 'best_phone_confirm':
      return latestValue(state, 'callback_phone', 'callbackPhone', 'callerPhone') ? 'yes' : null;
    case 'callback_phone':
      return latestValue(state, 'callback_phone', 'callbackPhone', 'callerPhone');
    case 'email':
      return latestValue(state, 'email', 'callerEmail');
    case 'calling_for':
      return latestValue(state, 'callingFor');
    case 'issue_summary':
      return latestValue(state, 'issue_summary', 'issueSummary');
    default:
      return null;
  }
}

function buildOffQuestionCorrectionWrites(
  flow: FlowLike,
  state: HydratedFlowRuntimeState,
  currentNode: FlowNodeLike,
  answer: string,
  context: FlowProgressContext,
): { writes: FlowRuntimeWrite[]; rerouteNodeId: string | null } {
  const currentKind = classifyQuestion(currentNode);
  const inferredFacts = mergeCallerFacts(
    inferCallerFacts(answer, currentKind),
    context.semanticFacts,
  );
  const semanticIntent = context.semanticFacts?.answerIntent || null;
  const hasExplicitCorrection = hasCorrectionCue(answer);
  const hasSemanticCorrection = semanticIntent === 'correction' || semanticIntent === 'both';
  const currentAnswerLooksUsable = hasUsableCurrentQuestionAnswer(flow, currentNode, answer, context);
  const hasSemanticOffQuestionFact = hasMeaningfulOffQuestionFact(currentKind, inferredFacts, state, context);

  if (!hasExplicitCorrection && !hasSemanticCorrection && (currentAnswerLooksUsable || !hasSemanticOffQuestionFact)) {
    return { writes: [], rerouteNodeId: null };
  }
  const writes: FlowRuntimeWrite[] = [];
  let rerouteNodeId: string | null = null;

  const addField = (fieldName: string, fieldValue: string | null | undefined) => {
    if (!fieldValue || !fieldValue.trim()) return;
    writes.push({
      fieldName,
      fieldValue: fieldValue.trim(),
      nodeId: currentNode.id,
    });
  };

  const addInternalFlag = (flagName: string, flagValue: string) => {
    writes.push({
      fieldName: `${FLOW_FLAG_PREFIX}${flagName}`,
      fieldValue: flagValue,
      nodeId: currentNode.id,
    });
  };

  const storedClientStatus = latestValue(state, 'clientStatus') || normalizeClientStatus(context.sessionClientType) || null;
  if (currentKind !== 'client_status' && inferredFacts.clientStatus && inferredFacts.clientStatus !== storedClientStatus) {
    addField('clientStatus', inferredFacts.clientStatus);
    const clientStatusQuestion = findFirstQuestionByKind(flow, 'client_status');
    if (clientStatusQuestion) {
      const matchedEdge = matchClientStatusEdge(getSortedOutgoingEdges(flow, clientStatusQuestion.id), flow, inferredFacts.clientStatus);
      if (matchedEdge) {
        const targetNode = getNodeById(flow, matchedEdge.targetNodeId);
        writes.push(markSelectedBranch(clientStatusQuestion.id, deriveChoiceLabel(targetNode, matchedEdge)));
        writes.push(markCurrentNode(matchedEdge.targetNodeId));
        if (inferredFacts.clientStatus === 'existing') {
          addInternalFlag('correctionContext', 'existing_client');
        }
        rerouteNodeId = matchedEdge.targetNodeId;
      }
    }
  }

  if (currentKind !== 'calling_for' && inferredFacts.callingFor) {
    const storedCallingFor = latestValue(state, 'callingFor');
    if (inferredFacts.callingFor !== storedCallingFor) {
      addField('callingFor', inferredFacts.callingFor);
    }
  }

  if (currentKind !== 'caller_name' && inferredFacts.callerName) {
    const storedName = latestValue(state, 'caller_name', 'callerName');
    if (inferredFacts.callerName !== storedName) {
      addField('caller_name', inferredFacts.callerName);
      addField('callerName', inferredFacts.callerName);
    }
  }

  if (currentKind !== 'callback_phone' && currentKind !== 'best_phone_confirm' && inferredFacts.callerPhone) {
    const storedPhone = latestValue(state, 'callback_phone', 'callbackPhone', 'callerPhone');
    if (inferredFacts.callerPhone !== storedPhone) {
      addField('callback_phone', inferredFacts.callerPhone);
      addField('callbackPhone', inferredFacts.callerPhone);
      addField('callerPhone', inferredFacts.callerPhone);
    }
  }

  if (currentKind !== 'email' && inferredFacts.callerEmail) {
    const storedEmail = latestValue(state, 'email', 'callerEmail');
    if (inferredFacts.callerEmail !== storedEmail) {
      addField('email', inferredFacts.callerEmail);
      addField('callerEmail', inferredFacts.callerEmail);
    }
  }

  return { writes, rerouteNodeId };
}

function isImplicitRoutingQuestion(node: FlowNodeLike): boolean {
  if (classifyQuestion(node) !== 'generic') return false;

  const text = normalizeText([
    node.label,
    getQuestionPrompt(node),
    typeof node.config?.note === 'string' ? node.config.note : '',
  ].join(' '));

  return (
    text.includes('matter triage') ||
    text.includes('matter type') ||
    text.includes('incident type') ||
    text.includes('what brings you to us') ||
    text.includes('what type of') ||
    text.includes('what kind of')
  );
}

function resolveImplicitRoutingAnswer(flow: FlowLike, node: FlowNodeLike, state: HydratedFlowRuntimeState): string | null {
  if (!isImplicitRoutingQuestion(node)) return null;
  const issueSummary = latestValue(state, 'issue_summary', 'issueSummary');
  if (!issueSummary) return null;

  const edges = getSortedOutgoingEdges(flow, node.id);
  if (edges.length < 2) return null;

  const matchedEdge =
    matchIssueSummaryEdge(edges, flow, issueSummary)
    || matchGenericEdge(edges, flow, issueSummary)
    || matchDateRangeEdge(edges, flow, issueSummary);
  if (!matchedEdge) return null;

  return issueSummary;
}

function buildIssueSummaryFollowUpMessage(issueSummary: string, node: FlowNodeLike): string {
  const prompt = getQuestionPrompt(node);
  const normalized = semanticNormalizeText(issueSummary);
  const soundsDifficult = /\b(divorce|separation|custody|support|abuse|violence|harassment|discrimination|fired|termination|injury|accident|hurt|arrest|charge|criminal|deportation|removal|asylum|foreclosure|eviction|bankruptcy|debt|audit|irs|probate|deceased|death|police|rights|contamination|toxic)\b/.test(normalized);

  if (soundsDifficult) {
    return `That sounds really stressful. Let me ask a couple of quick questions so I can get this to the right lawyer. ${prompt}`;
  }

  return `Thanks for walking me through that. ${prompt}`;
}

function isCriminalMatterQuestion(node: FlowNodeLike): boolean {
  const text = normalizeText(`${node.label} ${getQuestionPrompt(node)}`);
  return text.includes('criminal matter type') || text.includes('criminal charge this is');
}

function isCriminalStageQuestion(node: FlowNodeLike): boolean {
  const text = normalizeText(`${node.label} ${getQuestionPrompt(node)}`);
  return text.includes('stage of your case') || text.includes('stage is this at right now');
}

function isDivorceIssuesQuestion(node: FlowNodeLike): boolean {
  const text = normalizeText(`${node.label} ${getQuestionPrompt(node)}`);
  return text.includes('divorce issues involved') || text.includes('main issues in the divorce or separation');
}

function isDivorceTypeQuestion(node: FlowNodeLike): boolean {
  const text = normalizeText(`${node.label} ${getQuestionPrompt(node)}`);
  return text.includes('fh divorce separation') || text.includes('uncontested divorce') || text.includes('contested divorce') || text.includes('legal separation');
}

function isDivorceUrgencyQuestion(node: FlowNodeLike): boolean {
  const text = normalizeText(`${node.label} ${getQuestionPrompt(node)}`);
  return text.includes('immediate divorce urgency') || text.includes('urgent divorce issue') || text.includes('locked out of finances');
}

function isFamilyMatterTriageQuestion(node: FlowNodeLike): boolean {
  const text = normalizeText(`${node.label} ${getQuestionPrompt(node)}`);
  return text.includes('family law matter triage') || text.includes('family matter');
}

function isFamilyLineOnlyFollowUpQuestion(node: FlowNodeLike): boolean {
  const text = normalizeText(`${node.label} ${getQuestionPrompt(node)}`);
  return text.includes('family line only') || text.includes('family-law-related today');
}

function isSupportFilingStatusQuestion(node: FlowNodeLike): boolean {
  const text = normalizeText(`${node.label} ${getQuestionPrompt(node)}`);
  return text.includes('support filing status') || (text.includes('new support matter') && text.includes('modify'));
}

function isSupportPartyRoleQuestion(node: FlowNodeLike): boolean {
  const text = normalizeText(`${node.label} ${getQuestionPrompt(node)}`);
  return text.includes('party role') || text.includes('receiving support') || text.includes('asked to pay');
}

function findEdgeBySignalRegex(edges: FlowEdgeLike[], flow: FlowLike, pattern: RegExp): FlowEdgeLike | null {
  for (const edge of edges) {
    const target = getNodeById(flow, edge.targetNodeId);
    const signals = deriveMatchSignals(target, edge).map((signal) => normalizeText(signal)).join(' ');
    if (pattern.test(signals)) return edge;
  }
  return null;
}

function findFallbackUncertaintyEdge(edges: FlowEdgeLike[], flow: FlowLike): FlowEdgeLike | null {
  for (const edge of edges) {
    const target = getNodeById(flow, edge.targetNodeId);
    const choiceLabel = normalizeText(deriveChoiceLabel(target, edge));
    if (
      /^(other|something else)\b/.test(choiceLabel) ||
      /\bnot sure\b|\bunsure\b|\bdon t know\b|\bother .* matter\b|\bboth \/ unsure\b|\bguidance\b|\bhelp deciding\b/.test(choiceLabel)
    ) {
      return edge;
    }
  }
  return null;
}

function simplifyClarificationChoiceLabel(label: string): string {
  return label
    .trim()
    .replace(/^(?:yes|no|maybe|existing client|new client)\s*-\s*/i, '')
    .replace(/\s*\/\s*/g, ' or ')
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/g, '')
    .trim();
}

function getQuestionSemanticContext(node: FlowNodeLike, flow: FlowLike): string {
  const edgeSignals = getSortedOutgoingEdges(flow, node.id)
    .flatMap((edge) => deriveMatchSignals(getNodeById(flow, edge.targetNodeId), edge));

  return semanticNormalizeText([
    node.label,
    getQuestionPrompt(node),
    typeof node.config?.note === 'string' ? node.config.note : '',
    ...edgeSignals,
  ].join(' '));
}

function termRelatesToCurrentQuestion(term: string, node: FlowNodeLike, flow: FlowLike): boolean {
  const normalizedTerm = semanticNormalizeText(term);
  if (!normalizedTerm) return false;

  const contextText = getQuestionSemanticContext(node, flow);
  if (contextText.includes(normalizedTerm)) return true;

  const termTokens = keywordTokens(normalizedTerm);
  if (termTokens.length === 0) return false;
  const contextTokens = new Set(keywordTokens(contextText));
  return termTokens.some((token) => contextTokens.has(token));
}

function isLikelyUnrelatedFollowUpQuestion(
  response: string | undefined,
  node: FlowNodeLike,
  flow: FlowLike,
): boolean {
  const normalized = semanticNormalizeText(stripLeadingDisfluencies(response || ''));
  if (!normalized) return false;
  if (/\b(how do i tell|how can i tell|how would i know|what s the difference|what is the difference|i don t know the difference|i do not know the difference|have no idea what the difference is|no idea what the difference is|what does that mean|what do you mean|not sure which|which one|how do i know|what was that last part|can you repeat that|say that again|repeat that)\b/.test(normalized)) {
    return false;
  }
  const definitionTerm = extractDefinitionRequestTerm(normalized);
  if (definitionTerm && termRelatesToCurrentQuestion(definitionTerm, node, flow)) return false;
  if (!/\?$/.test((response || '').trim()) && !/^(what|who|when|where|why|how|can|could|should|would|do|does|did|is|are)\b/.test(normalized)) {
    return false;
  }

  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'so', 'just', 'really', 'very',
    'what', 'who', 'when', 'where', 'why', 'how', 'can', 'could', 'should', 'would', 'do',
    'does', 'did', 'is', 'are', 'am', 'i', 'you', 'your', 'my', 'me', 'we', 'they', 'it',
    'this', 'that', 'these', 'those', 'mean', 'means', 'about', 'for', 'of', 'to', 'in',
  ]);
  const responseTokens = keywordTokens(normalized).filter((token) => token.length > 2 && !stopWords.has(token));
  if (responseTokens.length === 0) return false;

  const contextTokens = new Set(
    keywordTokens(getQuestionSemanticContext(node, flow)).filter((token) => token.length > 2 && !stopWords.has(token)),
  );

  return !responseTokens.some((token) => contextTokens.has(token));
}

function buildPlainQuestionRestatement(node: FlowNodeLike): string {
  if (classifyQuestion(node) === 'generic') {
    if (normalizeText(`${node.label} ${getQuestionPrompt(node)}`).includes('minor children involved')) {
      return 'Are there any children under 18 involved in this matter?';
    }
  }

  return getQuestionPrompt(node);
}

function buildContextualDefinitionExplanation(
  node: FlowNodeLike,
  flow: FlowLike,
  callerResponse?: string,
): string | null {
  const term = extractDefinitionRequestTerm(callerResponse || '');
  if (!term || !termRelatesToCurrentQuestion(term, node, flow)) {
    return null;
  }

  const normalizedTerm = semanticNormalizeText(term);
  const simpleQuestion = buildPlainQuestionRestatement(node);

  if (/\bminor\b/.test(normalizedTerm) && /children/.test(getQuestionSemanticContext(node, flow))) {
    return `A minor means a child under 18. ${simpleQuestion}`;
  }

  if (/\buncontested\b/.test(normalizedTerm) || /\bcontested\b/.test(normalizedTerm) || /\blegal separation\b/.test(normalizedTerm)) {
    return "Uncontested usually means you mostly agree on the big issues. Contested means you disagree on major issues. Legal separation means living separately and handling things legally without ending the marriage. Are you mostly agreeing, mostly disagreeing, or asking about a legal separation?";
  }

  if (/\bfederal\b|\birs\b|\bstate\b/.test(normalizedTerm) && /tax/.test(getQuestionSemanticContext(node, flow))) {
    return "Federal means the IRS. State means your state tax agency. Which one is closest here?";
  }

  if (/\bgarnishment\b|\blevy\b/.test(normalizedTerm)) {
    return "That means money being taken directly from wages, a bank account, or property. Which option is closest here?";
  }

  if (/\bprobate\b/.test(normalizedTerm)) {
    return "Probate is the court process for handling someone's estate after they pass away. Which option is closest here?";
  }

  if (/\bpaternity\b/.test(normalizedTerm)) {
    return "Paternity means legally establishing who the child's father is. Which option is closest here?";
  }

  if (/\balimony\b|\bspousal support\b/.test(normalizedTerm)) {
    return "That means financial support one spouse may pay the other after separation or divorce. Which option is closest here?";
  }

  return null;
}

function matchDivorceUrgencyEdge(edges: FlowEdgeLike[], flow: FlowLike, response: string): FlowEdgeLike | null {
  const normalized = semanticNormalizeText(stripLeadingDisfluencies(response));
  if (!normalized) return null;

  if (/\b(no|none|nothing|not urgent|not right now|no emergency|no deadline|no safety issue)\b/.test(normalized)) {
    return findEdgeBySignalRegex(edges, flow, /\bno\b|\bno immediate urgency\b/);
  }

  if (/\b(lock|locked out|financ|money|bank|account|home|house|deadline|court date|safety|abuse|violence|threat|emergency|urgent|asap)\b/.test(normalized)) {
    return findEdgeBySignalRegex(edges, flow, /\byes\b|\burgent\b|\bsafety\b|\blocked out\b|\bdeadline\b/);
  }

  return null;
}

function matchContextualSemanticEdge(
  node: FlowNodeLike,
  edges: FlowEdgeLike[],
  flow: FlowLike,
  response: string,
): FlowEdgeLike | null {
  const normalized = semanticNormalizeText(stripLeadingDisfluencies(response));
  if (!normalized) return null;

  if (classifyQuestion(node) === 'issue_summary' || isFamilyMatterTriageQuestion(node)) {
    if (/\b(divorce|legal separation|separating|separation)\b/.test(normalized)) {
      return findEdgeBySignalRegex(edges, flow, /\bdivorce\b|\blegal separation\b/);
    }
    if (
      (/\b(custody|visitation|court order|violat|ignoring|moved to|took the children|took the kids)\b/.test(normalized)
        && /\b(child|children|kid|kids|parent|ex|co parent)\b/.test(normalized))
      || /\bcustody arrangement\b/.test(normalized)
    ) {
      return findEdgeBySignalRegex(edges, flow, /\bcustody\b|\bvisitation\b/);
    }
    if (
      /\b(child support|spousal support|support payments|spousal maintenance|alimony)\b/.test(normalized)
      || (
        /\b(laid off|lost my job|can t pay|cannot pay|struggling to pay|lower|reduce|modif|modify|modification|enforce|not being paid|owed)\b/.test(normalized)
        && /\bsupport\b/.test(normalized)
      )
    ) {
      return findEdgeBySignalRegex(edges, flow, /\bchild support\b|\bspousal support\b|\bsupport\b/);
    }
    if (/\b(acs|child welfare|cps|foster care|child safety|child protective)\b/.test(normalized)) {
      return findEdgeBySignalRegex(edges, flow, /\bchild s safety\b|\bwelfare\b|\bacs\b|\bfoster\b/);
    }
    if (/\b(order of protection|threatening|hurting me|harassing me|stalking me|abuse|violent)\b/.test(normalized)) {
      return findEdgeBySignalRegex(edges, flow, /\bthreatening\b|\bhurting me\b|\bprotection\b/);
    }
    if (/\b(paternity|father of my child|dna test)\b/.test(normalized)) {
      return findEdgeBySignalRegex(edges, flow, /\bpaternity\b/);
    }
    if (/\b(adoption|guardianship|guardian)\b/.test(normalized)) {
      return findEdgeBySignalRegex(edges, flow, /\badoption\b|\bguardianship\b/);
    }
    if (/\b(juvenile|delinquen|truancy|pins)\b/.test(normalized)) {
      return findEdgeBySignalRegex(edges, flow, /\bjuvenile\b/);
    }
  }

  if (isSupportFilingStatusQuestion(node)) {
    if (/\b(modify|modification|change|lower|reduce|adjust)\b/.test(normalized)) {
      return findEdgeBySignalRegex(edges, flow, /\bmodify\b|\bmodification\b/);
    }
    if (/\b(enforce|not being paid|not paid|behind|arrears|owed)\b/.test(normalized)) {
      return findEdgeBySignalRegex(edges, flow, /\benforce\b|\bnot being paid\b/);
    }
    if (/\b(new|first time|no order)\b/.test(normalized)) {
      return findEdgeBySignalRegex(edges, flow, /\bnew\b|\bfirst time\b/);
    }
  }

  if (isSupportPartyRoleQuestion(node)) {
    if (/\b(receiv|owed|they owe me|supposed to get paid|waiting on support)\b/.test(normalized)) {
      return findEdgeBySignalRegex(edges, flow, /\breceiving support\b|\bpetitioner\b/);
    }
    if (/\b(pay|paying|payer|asked to pay|i owe|my support obligation|i am the one paying|i have to pay)\b/.test(normalized)) {
      return findEdgeBySignalRegex(edges, flow, /\basked to pay\b|\brespondent\b/);
    }
  }

  if (isCriminalMatterQuestion(node)) {
    if (/\b(dui|drunk driving)\b/.test(normalized)) {
      return findEdgeBySignalRegex(edges, flow, /\bdui\b|\bdrunk driving\b/);
    }
    if (/\b(drug|possession|trafficking)\b/.test(normalized)) {
      return findEdgeBySignalRegex(edges, flow, /\bdrug offense\b/);
    }
    if (/\b(assault|violent|bar fight|fight|battery|hit someone)\b/.test(normalized)) {
      return findEdgeBySignalRegex(edges, flow, /\bassault\b|\bviolent crime\b/);
    }
    if (/\b(theft|stole|shoplift|robbery|burglary)\b/.test(normalized)) {
      return findEdgeBySignalRegex(edges, flow, /\btheft\b|\brobbery\b|\bproperty crime\b/);
    }
    if (/\b(domestic violence|restraining order|protective order)\b/.test(normalized)) {
      return findEdgeBySignalRegex(edges, flow, /\bdomestic violence charge\b/);
    }
    if (/\b(fraud|embezzlement|financial crime|white collar)\b/.test(normalized)) {
      return findEdgeBySignalRegex(edges, flow, /\bwhite collar\b|\bfinancial crime\b/);
    }
    if (isUncertainResponse(response)) {
      return findEdgeBySignalRegex(edges, flow, /\bother criminal charge\b/);
    }
  }

  if (isCriminalStageQuestion(node)) {
    if (/\b(beginning|just started|starting|early|investigating|under investigation|nothing filed|not filed|no charges yet|just arrested)\b/.test(normalized)) {
      return findEdgeBySignalRegex(edges, flow, /\bunder investigation\b|\bno charges filed\b|\bjust arrested\b/);
    }
    if (/\b(charged|charges filed|filed|arraign|court date|summons|awaiting trial)\b/.test(normalized)) {
      return findEdgeBySignalRegex(edges, flow, /\bcharges filed\b|\bawaiting trial\b/);
    }
    if (/\b(on trial|trial)\b/.test(normalized)) {
      return findEdgeBySignalRegex(edges, flow, /\bcurrently on trial\b/);
    }
    if (/\b(appeal|parole|expungement|post conviction|after conviction|convicted)\b/.test(normalized)) {
      return findEdgeBySignalRegex(edges, flow, /\bpost conviction\b|\bappeal\b|\bparole\b|\bexpungement\b/);
    }
  }

  return null;
}

function matchFamilyLineOnlyFollowUpEdge(
  edges: FlowEdgeLike[],
  flow: FlowLike,
  response: string,
): FlowEdgeLike | null {
  const yesNo = parseYesNo(response);
  const areaMatch = identifyLegalAreaMatch(response);

  if (yesNo === 'yes' || (areaMatch.area === 'family' && areaMatch.score > 0)) {
    return edges.find((edge) => {
      const target = getNodeById(flow, edge.targetNodeId);
      const signals = deriveMatchSignals(target, edge).map((signal) => normalizeText(signal)).join(' ');
      return /\byes\b/.test(signals);
    }) || null;
  }

  if (yesNo === 'no' || (areaMatch.area !== 'family' && areaMatch.score > 0)) {
    return edges.find((edge) => {
      const target = getNodeById(flow, edge.targetNodeId);
      const signals = deriveMatchSignals(target, edge).map((signal) => normalizeText(signal)).join(' ');
      return /\bno\b/.test(signals);
    }) || null;
  }

  return null;
}

function buildClarificationMessage(node: FlowNodeLike, flow: FlowLike, callerResponse?: string): string {
  const kind = classifyQuestion(node);
  const prompt = getQuestionPrompt(node);
  const explanationRequest = isExplanationRequest(callerResponse || '');
  const uncertain = isUncertainResponse(callerResponse || '');
  const contextualDefinitionExplanation = buildContextualDefinitionExplanation(node, flow, callerResponse);
  if (kind === 'get_started') {
    return 'Shall we get started?';
  }
  if (kind === 'client_status') {
    return 'Just so I route you correctly, have you worked with our firm before, or is this your first time reaching out to us?';
  }
  if (kind === 'best_phone_confirm') {
    return "Is the number you're calling from the best number to reach you if we get disconnected?";
  }
  if (kind === 'caller_name') {
    return "I didn't catch the name. Could I start with your first and last name?";
  }
  if (kind === 'callback_phone') {
    return "I didn't catch the callback number. What is the best callback number for you?";
  }
  if (kind === 'email') {
    return "I didn't catch the email address. What email should we use to follow up?";
  }
  if (kind === 'calling_for') {
    return 'Are you calling for yourself, or on behalf of someone else?';
  }
  if (classifyQuestion(node) === 'issue_summary') {
    return 'Can you tell me a little more about what happened so I can route you correctly?';
  }

  if (contextualDefinitionExplanation) {
    return contextualDefinitionExplanation;
  }

  if (isLikelyUnrelatedFollowUpQuestion(callerResponse, node, flow)) {
    return buildPlainQuestionRestatement(node);
  }

  if (isCriminalMatterQuestion(node)) {
    return isUncertainResponse(callerResponse || '')
      ? "That's okay if you don't know the exact charge yet. What do you know so far about what happened or what the police told you?"
      : 'Can you tell me what you know so far about the charge, or what police or the paperwork called it?';
  }

  if (isCriminalStageQuestion(node)) {
    return isUncertainResponse(callerResponse || '')
      ? "That's okay. Do you know whether police are still investigating, whether charges have already been filed, or whether you already have a court date?"
      : prompt;
  }

  if (isDivorceIssuesQuestion(node)) {
    return "That's okay. What feels most important right now - children, support, money, property, or something else?";
  }

  if (isDivorceTypeQuestion(node)) {
    return "That's okay. If you're not sure of the legal term, tell me whether you mostly agree, mostly disagree, or whether you're asking about a legal separation instead of ending the marriage.";
  }

  if (isSupportFilingStatusQuestion(node)) {
    return "That's okay. In plain English, is this a brand new support case, are you trying to change an existing order, or is someone not following the current order?";
  }

  if (isSupportPartyRoleQuestion(node)) {
    return "That's okay. Are you the person receiving support, or the person being asked to pay it?";
  }

  const edges = getSortedOutgoingEdges(flow, node.id);
  const choices = edges
    .map((edge) => simplifyClarificationChoiceLabel(deriveChoiceLabel(getNodeById(flow, edge.targetNodeId), edge)))
    .filter(Boolean)
    .slice(0, 4);

  if ((explanationRequest || uncertain) && choices.length >= 2 && choices.length <= 4) {
    const joinedChoices = choices.length === 2
      ? `${choices[0]} or ${choices[1]}`
      : `${choices.slice(0, -1).join(', ')}, or ${choices.at(-1)}`;

    if (explanationRequest) {
      return `That's okay. You do not need the exact legal label. Which is closest here: ${joinedChoices}? If you're not sure, just tell me what the notice, paperwork, or agency says.`;
    }

    return `That's okay. In your own words, which is closest here: ${joinedChoices}? If none of those fit, just tell me what you know so far.`;
  }

  if (choices.length >= 2 && choices.length <= 4) {
    return `That's okay if you're not sure yet. ${prompt} You can answer in your own words.`;
  }

  return prompt;
}

export function hydrateFlowRuntimeState(rows: IntakeDataRowLike[]): HydratedFlowRuntimeState {
  const state: HydratedFlowRuntimeState = {
    currentNodeId: null,
    fieldValues: {},
    questionAnswers: {},
    flagValues: {},
    selectedBranchByQuestion: {},
    internalValues: {},
  };

  for (const row of rows) {
    if (!row?.fieldName) continue;
    const fieldName = row.fieldName;
    const fieldValue = row.fieldValue;

    if (!isInternalFlowFieldName(fieldName)) {
      state.fieldValues[fieldName] = fieldValue;
      continue;
    }

    state.internalValues[fieldName] = fieldValue;

    if (fieldName === FLOW_CURRENT_NODE_KEY) {
      state.currentNodeId = fieldValue || null;
      continue;
    }

    if (fieldName.startsWith(FLOW_ANSWER_PREFIX)) {
      state.questionAnswers[fieldName.slice(FLOW_ANSWER_PREFIX.length)] = fieldValue;
      continue;
    }

    if (fieldName.startsWith(FLOW_FLAG_PREFIX)) {
      state.flagValues[fieldName.slice(FLOW_FLAG_PREFIX.length)] = fieldValue;
      continue;
    }

    if (fieldName.startsWith(FLOW_SELECTION_PREFIX)) {
      state.selectedBranchByQuestion[fieldName.slice(FLOW_SELECTION_PREFIX.length)] = fieldValue;
    }
  }

  return state;
}

export function isInternalFlowFieldName(fieldName: string): boolean {
  return fieldName.startsWith(INTERNAL_FLOW_PREFIX);
}

function applyRuntimeWritesToState(
  state: HydratedFlowRuntimeState,
  writes: FlowRuntimeWrite[],
): HydratedFlowRuntimeState {
  const next: HydratedFlowRuntimeState = {
    currentNodeId: state.currentNodeId,
    fieldValues: { ...state.fieldValues },
    questionAnswers: { ...state.questionAnswers },
    flagValues: { ...state.flagValues },
    selectedBranchByQuestion: { ...state.selectedBranchByQuestion },
    internalValues: { ...state.internalValues },
  };

  for (const write of writes) {
    if (!write?.fieldName) continue;
    const fieldName = write.fieldName;
    const fieldValue = write.fieldValue;

    if (!isInternalFlowFieldName(fieldName)) {
      next.fieldValues[fieldName] = fieldValue;
      continue;
    }

    next.internalValues[fieldName] = fieldValue;

    if (fieldName === FLOW_CURRENT_NODE_KEY) {
      next.currentNodeId = fieldValue || null;
      continue;
    }

    if (fieldName.startsWith(FLOW_ANSWER_PREFIX)) {
      next.questionAnswers[fieldName.slice(FLOW_ANSWER_PREFIX.length)] = fieldValue;
      continue;
    }

    if (fieldName.startsWith(FLOW_FLAG_PREFIX)) {
      next.flagValues[fieldName.slice(FLOW_FLAG_PREFIX.length)] = fieldValue;
      continue;
    }

    if (fieldName.startsWith(FLOW_SELECTION_PREFIX)) {
      next.selectedBranchByQuestion[fieldName.slice(FLOW_SELECTION_PREFIX.length)] = fieldValue;
    }
  }

  return next;
}

function markCurrentNode(nodeId: string | null): FlowRuntimeWrite {
  return {
    fieldName: FLOW_CURRENT_NODE_KEY,
    fieldValue: nodeId || FLOW_COMPLETED_NODE_ID,
  };
}

function markSelectedBranch(questionId: string, answerLabel: string): FlowRuntimeWrite {
  return {
    fieldName: `${FLOW_SELECTION_PREFIX}${questionId}`,
    fieldValue: answerLabel,
    nodeId: questionId,
  };
}

function getClarifyCountFlagName(nodeId: string): string {
  return `${FLOW_CLARIFY_COUNT_PREFIX}${nodeId}`;
}

function getClarifyCount(state: HydratedFlowRuntimeState, nodeId: string): number {
  const raw = state.flagValues[getClarifyCountFlagName(nodeId)] || latestValue(state, getClarifyCountFlagName(nodeId));
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function markClarifyCount(nodeId: string, count: number): FlowRuntimeWrite {
  return {
    fieldName: `${FLOW_FLAG_PREFIX}${getClarifyCountFlagName(nodeId)}`,
    fieldValue: String(count),
    nodeId,
  };
}

function isCoreQuestionKind(kind: QuestionKind): boolean {
  return (
    kind === 'get_started'
    || kind === 'client_status'
    || kind === 'caller_name'
    || kind === 'best_phone_confirm'
    || kind === 'callback_phone'
    || kind === 'email'
    || kind === 'calling_for'
  );
}

function markFlagValue(flagName: string, flagValue: string, nodeId: string): FlowRuntimeWrite[] {
  return [
    {
      fieldName: `${FLOW_FLAG_PREFIX}${flagName}`,
      fieldValue: flagValue,
      nodeId,
    },
    {
      fieldName: flagName,
      fieldValue: flagValue,
      nodeId,
    },
  ];
}

function getNextNodeIdAfterAction(flow: FlowLike, nodeId: string): string | null {
  const nextEdge = getSortedOutgoingEdges(flow, nodeId)[0];
  return nextEdge?.targetNodeId || null;
}

export function progressActiveFlow(
  flow: FlowLike,
  state: HydratedFlowRuntimeState,
  callerResponse: string | null | undefined,
  context: FlowProgressContext = {},
): FlowProgressResult {
  const writes: FlowRuntimeWrite[] = [];
  let workingState = state;
  let currentNode = getNodeById(flow, state.currentNodeId);
  let callerReply = callerResponse;
  let issueSummaryReplyForFollowUp: string | null = null;

  if (!currentNode) {
    currentNode = getFirstInteractiveNode(flow) || undefined;
  }

  if (!currentNode) {
    return { kind: 'complete', writes: [markCurrentNode(null)] };
  }

  if (callerReply && currentNode.type === 'question') {
    const trimmedResponse = callerReply.trim();
    const currentQuestionKind = classifyQuestion(currentNode);
    if (shouldTreatAsWrongNumber(trimmedResponse, currentQuestionKind, workingState, context)) {
      const completeWrite = markCurrentNode(null);
      writes.push(completeWrite);
      workingState = applyRuntimeWritesToState(workingState, [completeWrite]);
      return {
        kind: 'end',
        node: currentNode,
        assistantMessage: getWrongNumberMessage(),
        writes,
      };
    }
    if (isHelloCheck(trimmedResponse)) {
      writes.push(markCurrentNode(currentNode.id));
      return {
        kind: 'ask',
        node: currentNode,
        assistantMessage: `Yes, I'm here. ${getQuestionPrompt(currentNode)}`,
        writes,
      };
    }
    const offQuestionCorrection = buildOffQuestionCorrectionWrites(flow, workingState, currentNode, trimmedResponse, context);
    if (offQuestionCorrection.writes.length > 0) {
      writes.push(...offQuestionCorrection.writes);
      workingState = applyRuntimeWritesToState(workingState, offQuestionCorrection.writes);

      if (offQuestionCorrection.rerouteNodeId) {
        currentNode = getNodeById(flow, offQuestionCorrection.rerouteNodeId);
        callerReply = null;
      }
    }

    if (!callerReply) {
      // Caller corrected an earlier answer and the flow rerouted.
    } else {
      if (!currentNode) {
        return { kind: 'complete', writes: [...writes, markCurrentNode(null)] };
      }
      const answerWrites = buildQuestionAnswerWrites(flow, currentNode, trimmedResponse, context);
      writes.push(...answerWrites);
      workingState = applyRuntimeWritesToState(workingState, answerWrites);

      if (currentQuestionKind === 'get_started') {
        if (isGetStartedExplanationRequest(trimmedResponse)) {
          const clarifyCountWrite = markClarifyCount(currentNode.id, Math.max(getClarifyCount(workingState, currentNode.id), 1));
          const markCurrent = markCurrentNode(currentNode.id);
          writes.push(clarifyCountWrite);
          writes.push(markCurrent);
          workingState = applyRuntimeWritesToState(workingState, [clarifyCountWrite, markCurrent]);
          return {
            kind: 'clarify',
            node: currentNode,
            assistantMessage: buildGetStartedExplanationMessage(),
            writes,
          };
        }

        if (isGetStartedDeclineResponse(trimmedResponse)) {
          const priorClarifyCount = getClarifyCount(workingState, currentNode.id);
          if (priorClarifyCount < 1) {
            const clarifyCountWrite = markClarifyCount(currentNode.id, 1);
            const markCurrent = markCurrentNode(currentNode.id);
            writes.push(clarifyCountWrite);
            writes.push(markCurrent);
            workingState = applyRuntimeWritesToState(workingState, [clarifyCountWrite, markCurrent]);
            return {
              kind: 'clarify',
              node: currentNode,
              assistantMessage: buildGetStartedExplanationMessage(),
              writes,
            };
          }

          const completeWrite = markCurrentNode(null);
          writes.push(completeWrite);
          workingState = applyRuntimeWritesToState(workingState, [completeWrite]);
          return {
            kind: 'end',
            node: currentNode,
            assistantMessage: buildGetStartedDeclineGoodbye(),
            writes,
          };
        }
      }

      const validationFailure = validateStructuredQuestionAnswer(currentNode, trimmedResponse, context);
      if (validationFailure) {
        const markCurrent = markCurrentNode(currentNode.id);
        writes.push(markCurrent);
        workingState = applyRuntimeWritesToState(workingState, [markCurrent]);
        return {
          kind: 'clarify',
          node: currentNode,
          assistantMessage: validationFailure,
          writes,
        };
      }

      const matchedEdge = matchEdgeForAnswer(flow, currentNode, trimmedResponse, context.matchedChoiceLabel, context.semanticFacts);
      if (!matchedEdge) {
        const loopEscape = findLoopEscapeTarget(flow, currentNode, workingState, trimmedResponse, context);
        if (loopEscape?.edge) {
          const targetNode = getNodeById(flow, loopEscape.edge.targetNodeId);
          const branchWrite = markSelectedBranch(currentNode.id, deriveChoiceLabel(targetNode, loopEscape.edge));
          const currentWrite = markCurrentNode(loopEscape.edge.targetNodeId);
          writes.push(branchWrite);
          writes.push(currentWrite);
          workingState = applyRuntimeWritesToState(workingState, [branchWrite, currentWrite]);
          currentNode = targetNode;
        } else if (loopEscape?.convergedNodeId) {
          const currentWrite = markCurrentNode(loopEscape.convergedNodeId);
          writes.push(currentWrite);
          workingState = applyRuntimeWritesToState(workingState, [currentWrite]);
          currentNode = getNodeById(flow, loopEscape.convergedNodeId);
        } else {
          const clarifyCountWrite = markClarifyCount(currentNode.id, getClarifyCount(workingState, currentNode.id) + 1);
          const markCurrent = markCurrentNode(currentNode.id);
          writes.push(clarifyCountWrite);
          writes.push(markCurrent);
          workingState = applyRuntimeWritesToState(workingState, [clarifyCountWrite, markCurrent]);
          return {
            kind: 'clarify',
            node: currentNode,
            assistantMessage: buildClarificationMessage(currentNode, flow, trimmedResponse),
            writes,
          };
        }
      } else {
        const resetClarifyCountWrite = markClarifyCount(currentNode.id, 0);
        writes.push(resetClarifyCountWrite);
        workingState = applyRuntimeWritesToState(workingState, [resetClarifyCountWrite]);

        if (currentQuestionKind === 'issue_summary') {
          issueSummaryReplyForFollowUp = trimmedResponse;
        }

        const targetNode = getNodeById(flow, matchedEdge.targetNodeId);
        const branchWrite = markSelectedBranch(currentNode.id, deriveChoiceLabel(targetNode, matchedEdge));
        const currentWrite = markCurrentNode(matchedEdge.targetNodeId);
        writes.push(branchWrite);
        writes.push(currentWrite);
        workingState = applyRuntimeWritesToState(workingState, [branchWrite, currentWrite]);
        currentNode = targetNode;
      }
    }
  }

  while (currentNode) {
    if (currentNode.type === 'response') {
      const nextEdge = getSortedOutgoingEdges(flow, currentNode.id)[0];
      if (!nextEdge) {
        const completeWrite = markCurrentNode(null);
        writes.push(completeWrite);
        workingState = applyRuntimeWritesToState(workingState, [completeWrite]);
        return { kind: 'complete', writes };
      }
      const currentWrite = markCurrentNode(nextEdge.targetNodeId);
      writes.push(currentWrite);
      workingState = applyRuntimeWritesToState(workingState, [currentWrite]);
      currentNode = getNodeById(flow, nextEdge.targetNodeId);
      continue;
    }

    if (currentNode.type === 'action') {
      const currentWrite = markCurrentNode(currentNode.id);
      writes.push(currentWrite);
      workingState = applyRuntimeWritesToState(workingState, [currentWrite]);
      return {
        kind: 'action',
        node: currentNode,
        nextNodeId: getNextNodeIdAfterAction(flow, currentNode.id),
        writes,
      };
    }

    if (currentNode.type === 'transfer') {
      const currentWrite = markCurrentNode(currentNode.id);
      writes.push(currentWrite);
      workingState = applyRuntimeWritesToState(workingState, [currentWrite]);
      return { kind: 'transfer', node: currentNode, writes };
    }

    if (currentNode.type === 'end') {
      const completeWrite = markCurrentNode(null);
      writes.push(completeWrite);
      workingState = applyRuntimeWritesToState(workingState, [completeWrite]);
      return {
        kind: 'end',
        node: currentNode,
        assistantMessage: typeof currentNode.config?.closingMessage === 'string' && currentNode.config.closingMessage.trim()
          ? currentNode.config.closingMessage.trim()
          : 'Thank you for calling. Goodbye!',
        writes,
      };
    }

    if (currentNode.type !== 'question') {
      const nextEdge = getSortedOutgoingEdges(flow, currentNode.id)[0];
      if (!nextEdge) {
        const completeWrite = markCurrentNode(null);
        writes.push(completeWrite);
        workingState = applyRuntimeWritesToState(workingState, [completeWrite]);
        return { kind: 'complete', writes };
      }
      const currentWrite = markCurrentNode(nextEdge.targetNodeId);
      writes.push(currentWrite);
      workingState = applyRuntimeWritesToState(workingState, [currentWrite]);
      currentNode = getNodeById(flow, nextEdge.targetNodeId);
      continue;
    }

    const preAnswered = resolvePreAnsweredAnswer(currentNode, workingState, context);
    if (preAnswered) {
      const answerWrites = buildQuestionAnswerWrites(flow, currentNode, preAnswered, context);
      writes.push(...answerWrites);
      workingState = applyRuntimeWritesToState(workingState, answerWrites);

      const matchedEdge = matchEdgeForAnswer(flow, currentNode, preAnswered, context.matchedChoiceLabel, context.semanticFacts);
      if (!matchedEdge) {
        const currentWrite = markCurrentNode(currentNode.id);
        writes.push(currentWrite);
        workingState = applyRuntimeWritesToState(workingState, [currentWrite]);
        return {
          kind: 'ask',
          node: currentNode,
          assistantMessage: getQuestionPrompt(currentNode),
          writes,
        };
      }

      const targetNode = getNodeById(flow, matchedEdge.targetNodeId);
      const branchWrite = markSelectedBranch(currentNode.id, deriveChoiceLabel(targetNode, matchedEdge));
      const currentWrite = markCurrentNode(matchedEdge.targetNodeId);
      writes.push(branchWrite);
      writes.push(currentWrite);
      workingState = applyRuntimeWritesToState(workingState, [branchWrite, currentWrite]);
      currentNode = targetNode;
      continue;
    }

    const implicitRoutingAnswer = resolveImplicitRoutingAnswer(flow, currentNode, workingState);
    if (implicitRoutingAnswer) {
      const matchedEdge = matchEdgeForAnswer(flow, currentNode, implicitRoutingAnswer, context.matchedChoiceLabel, context.semanticFacts);
      if (matchedEdge) {
        const answerWrites = buildQuestionAnswerWrites(flow, currentNode, implicitRoutingAnswer, context);
        writes.push(...answerWrites);
        workingState = applyRuntimeWritesToState(workingState, answerWrites);

        const targetNode = getNodeById(flow, matchedEdge.targetNodeId);
        const branchWrite = markSelectedBranch(currentNode.id, deriveChoiceLabel(targetNode, matchedEdge));
        const currentWrite = markCurrentNode(matchedEdge.targetNodeId);
        writes.push(branchWrite);
        writes.push(currentWrite);
        workingState = applyRuntimeWritesToState(workingState, [branchWrite, currentWrite]);
        currentNode = targetNode;
        continue;
      }
    }

    const currentWrite = markCurrentNode(currentNode.id);
    writes.push(currentWrite);
    workingState = applyRuntimeWritesToState(workingState, [currentWrite]);
    return {
      kind: 'ask',
      node: currentNode,
      assistantMessage: issueSummaryReplyForFollowUp
        ? buildIssueSummaryFollowUpMessage(issueSummaryReplyForFollowUp, currentNode)
        : getQuestionPrompt(currentNode),
      writes,
    };
  }

  const completeWrite = markCurrentNode(null);
  writes.push(completeWrite);
  return { kind: 'complete', writes };
}

export function getFlowCollectedValue(
  state: HydratedFlowRuntimeState,
  ...fieldNames: string[]
): string | null {
  return latestValue(state, ...fieldNames);
}

export function getFlowFlagValue(state: HydratedFlowRuntimeState, flagName: string): string | null {
  return state.flagValues[flagName] || latestValue(state, flagName);
}

export function getFlowActionWrites(node: FlowNodeLike): FlowRuntimeWrite[] {
  if (node.config?.actionType === 'set_flag' && typeof node.config?.flagName === 'string' && typeof node.config?.flagValue === 'string') {
    return markFlagValue(node.config.flagName, node.config.flagValue, node.id);
  }
  return [];
}
