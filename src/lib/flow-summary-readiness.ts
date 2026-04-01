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
  id?: string;
  name?: string;
  nodes: FlowNodeLike[];
  edges: FlowEdgeLike[];
}

interface SummaryFacts {
  issue: string;
  notes: string;
  petitionType?: string;
  matterCategory?: string;
  partyRole?: string;
  urgencyFlag?: string;
}

interface BranchStep {
  questionLabel: string;
  questionPrompt: string;
  answerLabel: string;
  matchSignals: string[];
}

interface BranchPath {
  terminalLabel: string;
  steps: BranchStep[];
}

interface StepMatch {
  step: BranchStep;
  score: number;
}

interface TranscriptTurn {
  role: 'caller' | 'assistant';
  content: string;
}

export interface FlowSummaryReadinessResult {
  ready: boolean;
  missingRequirements: string[];
  message: string;
  matchedPathAnswers: string[];
  confidence: 'none' | 'matched';
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'both', 'by', 'for', 'from', 'has', 'have',
  'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my', 'no', 'not', 'of', 'on', 'or', 'our',
  'the', 'their', 'them', 'there', 'they', 'this', 'to', 'we', 'with', 'yes', 'you',
  'your', 'only', 'type', 'matter', 'issue', 'issues', 'right', 'now', 'other', 'all',
]);

const CALLER_ROLE_NAMES = new Set([
  'user',
  'caller',
  'customer',
  'client',
  'human',
  'person',
]);

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function keywordTokens(value: string): string[] {
  return normalize(value)
    .split(' ')
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
}

function extractCallerOnlyFactsText(notes: string): string | null {
  if (!notes.includes(':')) return null;

  const callerLines = notes
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) return [];

      const role = normalize(line.slice(0, colonIndex)).replace(/\s+/g, '');
      const content = line.slice(colonIndex + 1).trim();
      if (!content) return [];

      return CALLER_ROLE_NAMES.has(role) ? [content] : [];
    });

  return callerLines.length > 0 ? callerLines.join('\n') : null;
}

function parseTranscriptTurns(notes: string): TranscriptTurn[] {
  return notes
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) return [];

      const role = normalize(line.slice(0, colonIndex)).replace(/\s+/g, '');
      const content = line.slice(colonIndex + 1).trim();
      if (!content) return [];

      return [{
        role: CALLER_ROLE_NAMES.has(role) ? 'caller' : 'assistant',
        content,
      }];
    });
}

function summarizeQuestion(questionNode: FlowNodeLike): string {
  const question = typeof questionNode.config?.question === 'string'
    ? questionNode.config.question.trim()
    : '';
  const note = typeof questionNode.config?.note === 'string'
    ? questionNode.config.note.trim()
    : '';
  return question || note || questionNode.label;
}

function deriveAnswerLabel(targetNode: FlowNodeLike | undefined, edge: FlowEdgeLike): string {
  if (!targetNode) return edge.label || 'selected branch';

  if (targetNode.type === 'response') {
    const response = typeof targetNode.config?.response === 'string'
      ? targetNode.config.response.trim()
      : '';
    return response || targetNode.label;
  }

  if (targetNode.type === 'action' && targetNode.config?.actionType === 'set_flag') {
    const values = [
      typeof targetNode.config?.flagValue === 'string' ? targetNode.config.flagValue : '',
      typeof targetNode.config?.petitionType === 'string' ? targetNode.config.petitionType : '',
      targetNode.label,
    ].filter(Boolean);
    return values[0] || edge.label || targetNode.label;
  }

  return edge.label || targetNode.label;
}

function deriveMatchSignals(targetNode: FlowNodeLike | undefined, edge: FlowEdgeLike): string[] {
  const signals = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    signals.add(trimmed);
    const yesNoStyleSignal = /^(yes|no|i am|i have|nothing)\b/i.test(trimmed);
    if (!yesNoStyleSignal) {
      for (const segment of trimmed.split(/[/:()-]/)) {
        const piece = segment.trim();
        if (piece.length >= 4) signals.add(piece);
      }
    }
  };

  add(edge.label);
  if (targetNode) {
    if (targetNode.type === 'action' && targetNode.config?.actionType === 'set_flag') {
      add(targetNode.config?.flagValue);
      add(targetNode.config?.petitionType);
    } else {
      add(targetNode.label);
      add(targetNode.config?.response);
      add(targetNode.config?.flagValue);
      add(targetNode.config?.petitionType);
      add(targetNode.config?.note);
    }
  }

  return [...signals];
}

function enumerateBranchPaths(flow: FlowLike): BranchPath[] {
  const nodeMap = new Map(flow.nodes.map((node) => [node.id, node]));
  const outEdges = new Map<string, FlowEdgeLike[]>();

  for (const edge of flow.edges) {
    const list = outEdges.get(edge.sourceNodeId) || [];
    list.push(edge);
    outEdges.set(edge.sourceNodeId, list);
  }

  for (const [, edges] of outEdges) {
    edges.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  const startNode = flow.nodes.find((node) => node.type === 'start');
  if (!startNode) return [];

  const paths: BranchPath[] = [];

  function walk(nodeId: string, steps: BranchStep[], stack: Set<string>) {
    if (stack.has(nodeId)) return;

    const node = nodeMap.get(nodeId);
    if (!node) return;

    if (node.type === 'transfer' || node.type === 'end') {
      if (steps.length > 0) {
        paths.push({ terminalLabel: node.label, steps });
      }
      return;
    }

    const edges = outEdges.get(nodeId) || [];
    if (edges.length === 0) return;

    const nextStack = new Set(stack);
    nextStack.add(nodeId);

    if (node.type === 'question' && edges.length > 1) {
      for (const edge of edges) {
        const targetNode = nodeMap.get(edge.targetNodeId);
        const step: BranchStep = {
          questionLabel: node.label,
          questionPrompt: summarizeQuestion(node),
          answerLabel: deriveAnswerLabel(targetNode, edge),
          matchSignals: deriveMatchSignals(targetNode, edge),
        };
        walk(edge.targetNodeId, [...steps, step], nextStack);
      }
      return;
    }

    for (const edge of edges) {
      walk(edge.targetNodeId, steps, nextStack);
    }
  }

  walk(startNode.id, [], new Set());
  return paths;
}

function scoreStep(step: BranchStep, factsText: string): number {
  let bestScore = 0;

  for (const signal of step.matchSignals) {
    const normalizedSignal = normalize(signal);
    if (!normalizedSignal) continue;

    if (normalizedSignal.length >= 8 && factsText.includes(normalizedSignal)) {
      bestScore = Math.max(bestScore, 8 + Math.min(normalizedSignal.split(' ').length, 4));
      continue;
    }

    const keywords = keywordTokens(signal);
    if (keywords.length === 0) continue;
    const matchedKeywords = keywords.filter((keyword) => factsText.includes(keyword));
    if (matchedKeywords.length > 0) {
      const yesNoStyleSignal = /^(yes|no|i am|i have|nothing)\b/i.test(normalizedSignal);
      if (matchedKeywords.length >= 2) {
        bestScore = Math.max(bestScore, matchedKeywords.length);
        continue;
      }
      if (!yesNoStyleSignal) {
        bestScore = Math.max(bestScore, matchedKeywords.length);
      }
    }
  }

  return bestScore;
}

function questionMatchesTurn(questionText: string, turnContent: string): boolean {
  const normalizedQuestion = normalize(questionText);
  const normalizedTurn = normalize(turnContent);
  if (!normalizedQuestion || !normalizedTurn) return false;

  if (
    (normalizedQuestion.length >= 12 && normalizedTurn.includes(normalizedQuestion)) ||
    (normalizedTurn.length >= 12 && normalizedQuestion.includes(normalizedTurn))
  ) {
    return true;
  }

  const segments = questionText
    .split(/[.?!]/)
    .map((segment) => normalize(segment))
    .filter((segment) => segment.length >= 12);

  if (segments.some((segment) => normalizedTurn.includes(segment) || segment.includes(normalizedTurn))) {
    return true;
  }

  const keywords = keywordTokens(questionText);
  if (keywords.length === 0) return false;
  const matchedKeywords = keywords.filter((keyword) => normalizedTurn.includes(keyword)).length;
  return matchedKeywords >= Math.min(3, keywords.length);
}

function transcriptCoversStep(step: BranchStep, turns: TranscriptTurn[]): boolean {
  const questionTexts = [step.questionPrompt, step.questionLabel].filter(Boolean);

  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i];
    if (turn.role !== 'assistant') continue;

    const matchesQuestion = questionTexts.some((questionText) => questionMatchesTurn(questionText, turn.content));
    if (!matchesQuestion) continue;

    for (let j = i + 1; j < turns.length; j += 1) {
      if (turns[j].role === 'caller') return true;
      if (turns[j].role === 'assistant') break;
    }
  }

  return false;
}

export function validateFlowSummaryReadiness(flow: FlowLike, facts: SummaryFacts): FlowSummaryReadinessResult {
  const callerOnlyFacts = facts.notes ? extractCallerOnlyFactsText(facts.notes) : null;
  const transcriptTurns = facts.notes ? parseTranscriptTurns(facts.notes) : [];
  const factsText = normalize([
    facts.issue,
    callerOnlyFacts || facts.notes,
    facts.petitionType,
    facts.matterCategory,
    facts.partyRole,
    facts.urgencyFlag,
  ].filter(Boolean).join('\n'));

  if (!factsText) {
    return {
      ready: true,
      missingRequirements: [],
      message: '',
      matchedPathAnswers: [],
      confidence: 'none',
    };
  }

  const paths = enumerateBranchPaths(flow);
  if (paths.length === 0) {
    return {
      ready: true,
      missingRequirements: [],
      message: '',
      matchedPathAnswers: [],
      confidence: 'none',
    };
  }

  let bestPath: BranchPath | null = null;
  let bestMatches: StepMatch[] = [];
  let bestMatchedCount = -1;
  let bestScore = -1;
  const transcriptCoverageCache = new Map<string, boolean>();

  for (const path of paths) {
    const matches = path.steps.map((step) => {
      const transcriptCoverageKey = `${step.questionLabel}::${step.questionPrompt}`;
      let transcriptCovered = false;
      if (transcriptTurns.length > 0) {
        if (transcriptCoverageCache.has(transcriptCoverageKey)) {
          transcriptCovered = transcriptCoverageCache.get(transcriptCoverageKey) || false;
        } else {
          transcriptCovered = transcriptCoversStep(step, transcriptTurns);
          transcriptCoverageCache.set(transcriptCoverageKey, transcriptCovered);
        }
      }
      return { step, score: transcriptCovered ? Math.max(scoreStep(step, factsText), 1) : scoreStep(step, factsText) };
    });
    const matchedCount = matches.filter((entry) => entry.score > 0).length;
    const totalScore = matches.reduce((sum, entry) => sum + entry.score, 0);

    if (
      matchedCount > bestMatchedCount ||
      (matchedCount === bestMatchedCount && totalScore > bestScore)
    ) {
      bestPath = path;
      bestMatches = matches;
      bestMatchedCount = matchedCount;
      bestScore = totalScore;
    }
  }

  if (!bestPath || bestMatchedCount <= 0) {
    return {
      ready: true,
      missingRequirements: [],
      message: '',
      matchedPathAnswers: [],
      confidence: 'none',
    };
  }

  const firstMatchedIndex = bestMatches.findIndex((entry) => entry.score > 0);
  const missingSteps = bestMatches
    .slice(firstMatchedIndex + 1)
    .filter((entry) => entry.score <= 0)
    .map((entry) => entry.step);

  if (missingSteps.length === 0) {
    return {
      ready: true,
      missingRequirements: [],
      message: '',
      matchedPathAnswers: bestMatches
        .filter((entry) => entry.score > 0)
        .map((entry) => entry.step.answerLabel),
      confidence: 'matched',
    };
  }

  const missingRequirements = missingSteps.map((step) => step.questionPrompt);
  return {
    ready: false,
    missingRequirements,
    message: `Continue the intake first. You still need to cover ${missingRequirements.join(', ')} before generating the summary.`,
    matchedPathAnswers: bestMatches
      .filter((entry) => entry.score > 0)
      .map((entry) => entry.step.answerLabel),
    confidence: 'matched',
  };
}
