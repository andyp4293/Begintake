import { identifyLegalArea } from './lawyer-matcher';

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

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'best', 'both', 'by', 'can', 'could', 'do', 'for',
  'from', 'get', 'going', 'have', 'hello', 'help', 'how', 'i', 'if', 'in', 'is', 'it', 'its',
  'just', 'me', 'my', 'no', 'of', 'on', 'or', 'our', 'right', 'same', 'that', 'the', 'them',
  'there', 'they', 'this', 'to', 'today', 'us', 'we', 'what', 'with', 'you', 'your',
]);

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9@\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function keywordTokens(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function getQuestionPrompt(node: FlowNodeLike): string {
  const question = typeof node.config?.question === 'string'
    ? node.config.question.trim()
    : '';
  const note = typeof node.config?.note === 'string'
    ? node.config.note.trim()
    : '';
  return question || note || node.label;
}

function classifyQuestion(node: FlowNodeLike): QuestionKind {
  const prompt = normalizeText(`${node.label} ${getQuestionPrompt(node)}`);

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
    prompt.includes('describe their situation')
  ) {
    return 'issue_summary';
  }

  return 'generic';
}

function normalizeClientStatus(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (
    normalized.includes('existing') ||
    normalized.includes('current client') ||
    normalized.includes('worked with') ||
    normalized.includes('returning')
  ) {
    return 'existing';
  }
  if (
    normalized.includes('first time') ||
    normalized.includes('new client') ||
    normalized.includes('prospective') ||
    normalized === 'new'
  ) {
    return 'new';
  }
  return null;
}

function normalizeCallingFor(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (
    normalized.includes('someone else') ||
    normalized.includes('on behalf') ||
    normalized.includes('for my') ||
    normalized.includes('for a friend') ||
    normalized.includes('for my husband') ||
    normalized.includes('for my wife') ||
    normalized.includes('for my son') ||
    normalized.includes('for my daughter')
  ) {
    return 'other';
  }
  if (
    normalized.includes('for myself') ||
    normalized.includes('for me') ||
    normalized === 'self' ||
    normalized === 'myself'
  ) {
    return 'self';
  }
  return null;
}

function parseYesNo(value: string): 'yes' | 'no' | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (/^(yes|yeah|yep|yup|sure|correct|right|please do|lets begin|let s begin|ok|okay)\b/.test(normalized)) return 'yes';
  if (/^(no|nope|nah|not really)\b/.test(normalized)) return 'no';
  return null;
}

function parsePhoneNumberCandidate(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

function parseEmailCandidate(value: string): string | null {
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].trim() : null;
}

function parseNameCandidate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/(?:my name is|this is|i am|i'm)\s+([a-z][a-z.'-]*(?:\s+[a-z][a-z.'-]*){0,3})/i);
  const candidate = match?.[1] || trimmed;
  const cleaned = candidate.replace(/[.?!]+$/g, '').trim();
  if (!cleaned || keywordTokens(cleaned).length === 0) return null;
  return cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
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

function latestValue(state: HydratedFlowRuntimeState, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = state.fieldValues[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function buildQuestionAnswerWrites(node: FlowNodeLike, answer: string, context: FlowProgressContext): FlowRuntimeWrite[] {
  const writes: FlowRuntimeWrite[] = [{
    fieldName: `${FLOW_ANSWER_PREFIX}${node.id}`,
    fieldValue: answer.trim(),
    nodeId: node.id,
  }];

  const kind = classifyQuestion(node);
  const collectFields = Array.isArray(node.config?.collectFields) ? node.config.collectFields : [];

  const addField = (fieldName: string, fieldValue: string | null | undefined) => {
    if (!fieldValue || !fieldValue.trim()) return;
    writes.push({
      fieldName,
      fieldValue: fieldValue.trim(),
      nodeId: node.id,
    });
  };

  if (collectFields.length > 0) {
    if (collectFields.length === 1) {
      const fieldName = collectFields[0]?.name;
      if (typeof fieldName === 'string' && fieldName.trim()) {
        if (fieldName === 'preferred_date' || fieldName === 'preferred_time') {
          const extracted = extractPreferredDateTime(answer);
          addField(fieldName, extracted[fieldName] || answer.trim());
        } else {
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
      } else {
        for (const fieldName of fieldNames) {
          addField(fieldName, answer.trim());
        }
      }
    }
  }

  switch (kind) {
    case 'caller_name':
      addField('caller_name', parseNameCandidate(answer) || answer.trim());
      addField('callerName', parseNameCandidate(answer) || answer.trim());
      break;
    case 'callback_phone': {
      const parsedPhone = parsePhoneNumberCandidate(answer) || answer.trim();
      addField('callback_phone', parsedPhone);
      addField('callerPhone', parsedPhone);
      break;
    }
    case 'best_phone_confirm':
      if (parseYesNo(answer) === 'yes' && context.sessionCallerPhone) {
        addField('callback_phone', context.sessionCallerPhone);
        addField('callerPhone', context.sessionCallerPhone);
      }
      break;
    case 'email': {
      const email = parseEmailCandidate(answer) || answer.trim();
      addField('email', email);
      addField('callerEmail', email);
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
      addField('issue_summary', answer.trim());
      addField('issueSummary', answer.trim());
      break;
    default:
      break;
  }

  return writes;
}

function getNodeById(flow: FlowLike, nodeId: string | null): FlowNodeLike | undefined {
  return nodeId ? flow.nodes.find((node) => node.id === nodeId) : undefined;
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
    for (const segment of trimmed.split(/[/:(),-]/)) {
      const piece = segment.trim();
      if (piece.length >= 4) signals.add(piece);
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

function scoreSignal(answerText: string, signal: string): number {
  const normalizedAnswer = normalizeText(answerText);
  const normalizedSignal = normalizeText(signal);
  if (!normalizedAnswer || !normalizedSignal) return 0;

  if (
    (normalizedSignal.length >= 8 && normalizedAnswer.includes(normalizedSignal)) ||
    (normalizedAnswer.length >= 8 && normalizedSignal.includes(normalizedAnswer))
  ) {
    return 8 + Math.min(normalizedSignal.split(' ').length, 4);
  }

  const keywords = keywordTokens(signal);
  if (keywords.length === 0) return 0;
  const matched = keywords.filter((keyword) => normalizedAnswer.includes(keyword));
  return matched.length;
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

function matchIssueSummaryEdge(edges: FlowEdgeLike[], flow: FlowLike, response: string): FlowEdgeLike | null {
  const inferredArea = identifyLegalArea(response);
  let bestEdge: FlowEdgeLike | null = null;
  let bestScore = 0;

  for (const edge of edges) {
    const target = getNodeById(flow, edge.targetNodeId);
    const signals = deriveMatchSignals(target, edge);
    let score = signals.reduce((max, signal) => Math.max(max, scoreSignal(response, signal)), 0);
    const targetText = normalizeText(signals.join(' '));
    if (inferredArea !== 'other' && targetText.includes(inferredArea.replace('_', ' '))) {
      score += 5;
    }
    if (score > bestScore) {
      bestScore = score;
      bestEdge = edge;
    }
  }

  return bestScore > 0 ? bestEdge : null;
}

function matchGenericEdge(edges: FlowEdgeLike[], flow: FlowLike, response: string): FlowEdgeLike | null {
  let bestEdge: FlowEdgeLike | null = null;
  let bestScore = 0;

  for (const edge of edges) {
    const target = getNodeById(flow, edge.targetNodeId);
    const score = deriveMatchSignals(target, edge)
      .reduce((max, signal) => Math.max(max, scoreSignal(response, signal)), 0);

    if (score > bestScore) {
      bestScore = score;
      bestEdge = edge;
    }
  }

  return bestScore > 0 ? bestEdge : null;
}

function matchEdgeForAnswer(flow: FlowLike, node: FlowNodeLike, response: string): FlowEdgeLike | null {
  const edges = getSortedOutgoingEdges(flow, node.id);
  if (edges.length === 0) return null;
  if (edges.length === 1) return edges[0];

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
        return matchClientStatusEdge(edges, flow, response);
      case 'calling_for':
        return matchCallingForEdge(edges, flow, response);
      case 'best_phone_confirm':
        return matchYesNoEdge(edges, flow, response);
      case 'issue_summary':
        return matchIssueSummaryEdge(edges, flow, response);
      default:
        return null;
    }
  })();

  return specialized || matchGenericEdge(edges, flow, response);
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
      return latestValue(state, 'clientStatus') || normalizeClientStatus(context.sessionClientType) || null;
    case 'caller_name':
      return latestValue(state, 'caller_name', 'callerName');
    case 'best_phone_confirm':
      return latestValue(state, 'callback_phone', 'callerPhone') ? 'yes' : null;
    case 'callback_phone':
      return latestValue(state, 'callback_phone', 'callerPhone');
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

function buildClarificationMessage(node: FlowNodeLike, flow: FlowLike): string {
  const prompt = getQuestionPrompt(node);
  if (classifyQuestion(node) === 'issue_summary') {
    return 'Can you tell me a little more about what happened so I can route you correctly?';
  }

  const edges = getSortedOutgoingEdges(flow, node.id);
  const choices = edges
    .map((edge) => deriveChoiceLabel(getNodeById(flow, edge.targetNodeId), edge))
    .filter(Boolean)
    .slice(0, 4);

  if (choices.length >= 2 && choices.length <= 4) {
    return `${prompt} You can say ${choices.join(', ')}.`;
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
  let currentNode = getNodeById(flow, state.currentNodeId) || getFirstInteractiveNode(flow);

  if (!currentNode) {
    return { kind: 'complete', writes: [markCurrentNode(null)] };
  }

  if (callerResponse && currentNode.type === 'question') {
    const trimmedResponse = callerResponse.trim();
    const answerWrites = buildQuestionAnswerWrites(currentNode, trimmedResponse, context);
    writes.push(...answerWrites);

    const matchedEdge = matchEdgeForAnswer(flow, currentNode, trimmedResponse);
    if (!matchedEdge) {
      writes.push(markCurrentNode(currentNode.id));
      return {
        kind: 'clarify',
        node: currentNode,
        assistantMessage: buildClarificationMessage(currentNode, flow),
        writes,
      };
    }

    const targetNode = getNodeById(flow, matchedEdge.targetNodeId);
    writes.push(markSelectedBranch(currentNode.id, deriveChoiceLabel(targetNode, matchedEdge)));
    writes.push(markCurrentNode(matchedEdge.targetNodeId));
    currentNode = targetNode || null;
  }

  while (currentNode) {
    if (currentNode.type === 'response') {
      const nextEdge = getSortedOutgoingEdges(flow, currentNode.id)[0];
      if (!nextEdge) {
        writes.push(markCurrentNode(null));
        return { kind: 'complete', writes };
      }
      writes.push(markCurrentNode(nextEdge.targetNodeId));
      currentNode = getNodeById(flow, nextEdge.targetNodeId) || null;
      continue;
    }

    if (currentNode.type === 'action') {
      writes.push(markCurrentNode(currentNode.id));
      return {
        kind: 'action',
        node: currentNode,
        nextNodeId: getNextNodeIdAfterAction(flow, currentNode.id),
        writes,
      };
    }

    if (currentNode.type === 'transfer') {
      writes.push(markCurrentNode(currentNode.id));
      return { kind: 'transfer', node: currentNode, writes };
    }

    if (currentNode.type === 'end') {
      writes.push(markCurrentNode(null));
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
        writes.push(markCurrentNode(null));
        return { kind: 'complete', writes };
      }
      writes.push(markCurrentNode(nextEdge.targetNodeId));
      currentNode = getNodeById(flow, nextEdge.targetNodeId) || null;
      continue;
    }

    const preAnswered = resolvePreAnsweredAnswer(currentNode, state, context);
    if (preAnswered) {
      const answerWrites = buildQuestionAnswerWrites(currentNode, preAnswered, context);
      writes.push(...answerWrites);

      const matchedEdge = matchEdgeForAnswer(flow, currentNode, preAnswered);
      if (!matchedEdge) {
        writes.push(markCurrentNode(currentNode.id));
        return {
          kind: 'ask',
          node: currentNode,
          assistantMessage: getQuestionPrompt(currentNode),
          writes,
        };
      }

      const targetNode = getNodeById(flow, matchedEdge.targetNodeId);
      writes.push(markSelectedBranch(currentNode.id, deriveChoiceLabel(targetNode, matchedEdge)));
      writes.push(markCurrentNode(matchedEdge.targetNodeId));
      currentNode = targetNode || null;
      continue;
    }

    writes.push(markCurrentNode(currentNode.id));
    return {
      kind: 'ask',
      node: currentNode,
      assistantMessage: getQuestionPrompt(currentNode),
      writes,
    };
  }

  writes.push(markCurrentNode(null));
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
