import { describe, expect, it } from 'vitest';
import {
  FLOW_CURRENT_NODE_KEY,
  getFlowActionWrites,
  hydrateFlowRuntimeState,
  progressActiveFlow,
} from '@/lib/active-flow-runner';
import { createFamilyIntakeTemplate } from '@/lib/templates/family-intake';
import { createGeneralIntakeTemplate } from '@/lib/templates/general-intake';
import { createDefaultIntakeTemplate } from '@/lib/templates/default-intake';

function appendRuntimeWrites(rows: Array<{ fieldName: string; fieldValue: string; nodeId?: string | null }>, writes: Array<{ fieldName: string; fieldValue: string; nodeId?: string | null }>) {
  rows.push(...writes.map((write) => ({
    fieldName: write.fieldName,
    fieldValue: write.fieldValue,
    nodeId: write.nodeId ?? null,
  })));
}

function advanceConversationTurn(
  flow: any,
  rows: Array<{ fieldName: string; fieldValue: string; nodeId?: string | null }>,
  callerResponse: string | null,
  context: Record<string, any> = {},
) {
  let state = hydrateFlowRuntimeState(rows);
  let result = progressActiveFlow(flow, state, callerResponse, context);
  let safety = 0;

  while (result.kind === 'action') {
    appendRuntimeWrites(rows, result.writes);
    appendRuntimeWrites(rows, [
      ...getFlowActionWrites(result.node),
      {
        fieldName: FLOW_CURRENT_NODE_KEY,
        fieldValue: result.nextNodeId || '__completed__',
        nodeId: result.node.id,
      },
    ]);
    state = hydrateFlowRuntimeState(rows);
    result = progressActiveFlow(flow, state, null, context);
    safety += 1;
    if (safety > 20) {
      throw new Error('Conversation simulator hit too many auto-action steps');
    }
  }

  appendRuntimeWrites(rows, result.writes);
  return {
    result,
    state: hydrateFlowRuntimeState(rows),
  };
}

function simulateConversation(flow: any, callerReplies: string[], context: Record<string, any> = {}) {
  const rows: Array<{ fieldName: string; fieldValue: string; nodeId?: string | null }> = [];
  const outputs: Array<{ kind: string; label?: string; assistantMessage?: string }> = [];

  let turn = advanceConversationTurn(flow, rows, null, context);
  outputs.push({
    kind: turn.result.kind,
    label: 'node' in turn.result ? turn.result.node.label : undefined,
    assistantMessage: 'assistantMessage' in turn.result ? turn.result.assistantMessage : undefined,
  });

  for (const reply of callerReplies) {
    turn = advanceConversationTurn(flow, rows, reply, context);
    outputs.push({
      kind: turn.result.kind,
      label: 'node' in turn.result ? turn.result.node.label : undefined,
      assistantMessage: 'assistantMessage' in turn.result ? turn.result.assistantMessage : undefined,
    });

    if (turn.result.kind === 'transfer' || turn.result.kind === 'end' || turn.result.kind === 'complete') {
      break;
    }
  }

  return {
    outputs,
    rows,
    state: hydrateFlowRuntimeState(rows),
  };
}

function simulateFromNode(flow: any, nodeLabel: string, callerReplies: string[], context: Record<string, any> = {}) {
  const startNode = flow.nodes.find((node: any) => node.label === nodeLabel);
  if (!startNode) {
    throw new Error(`Could not find node: ${nodeLabel}`);
  }

  const rows: Array<{ fieldName: string; fieldValue: string; nodeId?: string | null }> = [
    { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: startNode.id },
  ];
  const outputs: Array<{ kind: string; label?: string; assistantMessage?: string }> = [];

  let turn = advanceConversationTurn(flow, rows, null, context);
  outputs.push({
    kind: turn.result.kind,
    label: 'node' in turn.result ? turn.result.node.label : undefined,
    assistantMessage: 'assistantMessage' in turn.result ? turn.result.assistantMessage : undefined,
  });

  for (const reply of callerReplies) {
    turn = advanceConversationTurn(flow, rows, reply, context);
    outputs.push({
      kind: turn.result.kind,
      label: 'node' in turn.result ? turn.result.node.label : undefined,
      assistantMessage: 'assistantMessage' in turn.result ? turn.result.assistantMessage : undefined,
    });

    if (turn.result.kind === 'transfer' || turn.result.kind === 'end' || turn.result.kind === 'complete') {
      break;
    }
  }

  return {
    outputs,
    rows,
    state: hydrateFlowRuntimeState(rows),
  };
}

describe('active flow runner', () => {
  it('captures multiple caller facts from one natural sentence without forcing duplicate questions later', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q1b = flow.nodes.find((node: any) => node.label === 'Q1b. New or Existing Client?');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q1b.id },
    ]);

    const result = progressActiveFlow(flow, state, "It's my first time, and I'm calling for myself about a divorce.", {});

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('Q2. Caller Name');
    expect(result.writes.some((write) => write.fieldName === 'clientStatus' && write.fieldValue === 'new')).toBe(true);
    expect(result.writes.some((write) => write.fieldName === 'callingFor' && write.fieldValue === 'self')).toBe(true);
    expect(result.writes.some((write) => write.fieldName === 'issueSummary' && write.fieldValue.includes('divorce'))).toBe(true);
  });

  it('does not mistake non-name phrases like treatment updates for a caller name', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === 'PI D2. Medical Treatment Status');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ]);

    const result = progressActiveFlow(flow, state, 'Yes, I am still treating.', {});

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.writes.some((write) => write.fieldName === 'callerName' || write.fieldName === 'caller_name')).toBe(false);
    expect(result.node.label).toBe('PI D3. Insurance and Representation');
  });

  it('skips pre-answered opening questions and advances straight into the correct practice-area path', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const state = hydrateFlowRuntimeState([
      { fieldName: 'callerName', fieldValue: 'Andy Pham' },
      { fieldName: 'caller_name', fieldValue: 'Andy Pham' },
      { fieldName: 'clientStatus', fieldValue: 'new' },
      { fieldName: 'callerPhone', fieldValue: '+15559990001' },
      { fieldName: 'callback_phone', fieldValue: '+15559990001' },
      { fieldName: 'callingFor', fieldValue: 'self' },
      { fieldName: 'issueSummary', fieldValue: 'I got in a car accident and broke my arm last week.' },
    ]);

    const result = progressActiveFlow(flow, state, 'Yes', {
      sessionCallerPhone: '+15559990001',
      sessionClientType: 'new',
    });

    expect(result.kind).toBe('action');
    if (result.kind !== 'action') return;
    expect(result.node.label).toContain('Flag: PI');
    expect(result.nextNodeId).toBeTruthy();
  });

  it('treats natural spoken affirmatives like "uh, yeah" as yes for the opening question', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const state = hydrateFlowRuntimeState([]);

    const result = progressActiveFlow(flow, state, 'Uh, Yeah.', {
      sessionCallerPhone: '+15559990001',
      sessionClientType: null,
    });

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('Q1b. New or Existing Client?');
  });

  it('treats more natural returning-client phrasing as existing without needing the exact label', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q1b = flow.nodes.find((node: any) => node.label === 'Q1b. New or Existing Client?');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q1b.id },
    ]);

    const result = progressActiveFlow(flow, state, "I've used your firm before.", {});

    expect(result.kind).toBe('transfer');
    if (result.kind !== 'transfer') return;
    expect(result.node.label).toBe('Transfer to Paralegal');
    expect(result.writes.some((write) => write.fieldName === 'clientStatus' && write.fieldValue === 'existing')).toBe(true);
  });

  it('starts on the explicit get-started question before the client-status question', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const state = hydrateFlowRuntimeState([]);

    const result = progressActiveFlow(flow, state, null, {});

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('Q1. Shall we get started?');
    expect(result.assistantMessage).toBe('Shall we get started?');
  });

  it('does not treat client-status answers like "first time" as an issue summary', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q1b = flow.nodes.find((node: any) => node.label === 'Q1b. New or Existing Client?');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q1b.id },
    ]);

    const result = progressActiveFlow(flow, state, 'First time.', {});

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('Q2. Caller Name');
    expect(result.writes.some((write) => write.fieldName === 'issueSummary')).toBe(false);
  });

  it('does not mistake client-status language like "my first time" for a caller name', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q1b = flow.nodes.find((node: any) => node.label === 'Q1b. New or Existing Client?');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q1b.id },
      { fieldName: 'callerName', fieldValue: 'Maria Delgado' },
      { fieldName: 'caller_name', fieldValue: 'Maria Delgado' },
    ]);

    const result = progressActiveFlow(flow, state, 'This this is my first time.', {});

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.writes.some((write) => write.fieldName === 'callerName' && write.fieldValue === 'My First Time')).toBe(false);
    expect(result.writes.some((write) => write.fieldName === 'caller_name' && write.fieldValue === 'My First Time')).toBe(false);
  });

  it('does not treat a caller-name turn containing a client-status correction as a fake name', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q2 = flow.nodes.find((node: any) => node.label === 'Q2. Caller Name');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q2.id },
      { fieldName: 'clientStatus', fieldValue: 'new' },
    ]);

    const result = progressActiveFlow(flow, state, "Um, actually, never mind. I'm actually new.", {});

    expect(result.kind).toBe('clarify');
    if (result.kind !== 'clarify') return;
    expect(result.assistantMessage).toBe("I didn't catch the name. Could I start with your first and last name?");
    expect(result.writes.some((write) => write.fieldName === 'caller_name')).toBe(false);
    expect(result.writes.some((write) => write.fieldName === 'callerName')).toBe(false);
  });

  it('reroutes to the current-client path when the caller corrects themselves to existing client later in the intake', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q3 = flow.nodes.find((node: any) => node.label === 'Q3. Best Phone Number');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q3.id },
      { fieldName: 'clientStatus', fieldValue: 'new' },
    ]);

    const result = progressActiveFlow(flow, state, "I'm actually an old client. I'm an old client.", {});

    expect(result.kind).toBe('transfer');
    if (result.kind !== 'transfer') return;
    expect(result.node.label).toBe('Transfer to Paralegal');
    expect(result.writes.some((write) => write.fieldName === 'clientStatus' && write.fieldValue === 'existing')).toBe(true);
    expect(result.writes.some((write) => write.fieldName === '__flow_flag::correctionContext' && write.fieldValue === 'existing_client')).toBe(true);
  });

  it('uses semantic correction facts to reroute existing clients without depending on the exact phrase', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q2 = flow.nodes.find((node: any) => node.label === 'Q2. Caller Name');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q2.id },
      { fieldName: 'clientStatus', fieldValue: 'new' },
    ]);

    const result = progressActiveFlow(flow, state, 'You all helped me before.', {
      semanticFacts: {
        clientStatus: 'existing',
        answerIntent: 'correction',
      },
    });

    expect(result.kind).toBe('transfer');
    if (result.kind !== 'transfer') return;
    expect(result.node.label).toBe('Transfer to Paralegal');
    expect(result.writes.some((write) => write.fieldName === 'clientStatus' && write.fieldValue === 'existing')).toBe(true);
  });

  it('uses semantic current-question facts for client status even when the spoken wording is indirect', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q1b = flow.nodes.find((node: any) => node.label === 'Q1b. New or Existing Client?');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q1b.id },
    ]);

    const result = progressActiveFlow(flow, state, 'We already have a file with you.', {
      semanticFacts: {
        clientStatus: 'existing',
        answerIntent: 'current_question',
      },
    });

    expect(result.kind).toBe('transfer');
    if (result.kind !== 'transfer') return;
    expect(result.node.label).toBe('Transfer to Paralegal');
  });

  it('reroutes to the current-client path even when the caller gives an off-question existing-client answer without explicit correction wording', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q2 = flow.nodes.find((node: any) => node.label === 'Q2. Caller Name');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q2.id },
      { fieldName: 'clientStatus', fieldValue: 'new' },
    ]);

    const result = progressActiveFlow(flow, state, "I've worked with your firm before.", {});

    expect(result.kind).toBe('transfer');
    if (result.kind !== 'transfer') return;
    expect(result.node.label).toBe('Transfer to Paralegal');
    expect(result.writes.some((write) => write.fieldName === 'clientStatus' && write.fieldValue === 'existing')).toBe(true);
  });

  it('treats custom caller-name fields as structured questions and does not advance on a non-name answer', () => {
    const flow = {
      id: 'custom-name-flow',
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: {} },
        { id: 'q1', type: 'question', label: 'Who should I put this under?', config: { question: 'Who should I put this under?', collectFields: [{ name: 'caller_name', label: 'Caller name', type: 'text', required: true }] } },
        { id: 'q2', type: 'question', label: 'Next Question', config: { question: 'What happened?' } },
      ],
      edges: [
        { sourceNodeId: 'start', targetNodeId: 'q1', label: null, sortOrder: 0 },
        { sourceNodeId: 'q1', targetNodeId: 'q2', label: null, sortOrder: 0 },
      ],
    } as any;
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: 'q1' },
    ]);

    const result = progressActiveFlow(flow, state, 'It is my first time.', {});

    expect(result.kind).toBe('clarify');
    if (result.kind !== 'clarify') return;
    expect(result.assistantMessage).toBe("I didn't catch the name. Could I start with your first and last name?");
    expect(result.writes.some((write) => write.fieldName === 'caller_name')).toBe(false);
    expect(result.writes.some((write) => write.fieldName === 'callerName')).toBe(false);
  });

  it('treats custom callback-number fields as structured questions and can use the same inbound number naturally', () => {
    const flow = {
      id: 'custom-phone-flow',
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: {} },
        { id: 'q1', type: 'question', label: 'Best callback', config: { question: 'What number should I use if we disconnect?', collectFields: [{ name: 'callback_phone', label: 'Callback number', type: 'text', required: true }] } },
        { id: 'q2', type: 'question', label: 'Next Question', config: { question: 'Are you calling for yourself or someone else?' } },
      ],
      edges: [
        { sourceNodeId: 'start', targetNodeId: 'q1', label: null, sortOrder: 0 },
        { sourceNodeId: 'q1', targetNodeId: 'q2', label: null, sortOrder: 0 },
      ],
    } as any;
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: 'q1' },
    ]);

    const result = progressActiveFlow(flow, state, 'Same number.', {
      sessionCallerPhone: '+15559990001',
    });

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('Next Question');
    expect(result.writes.some((write) => write.fieldName === 'callback_phone' && write.fieldValue === '+15559990001')).toBe(true);
  });

  it('does not auto-skip the best-number question just because the inbound phone number is known', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q3 = flow.nodes.find((node: any) => node.label === 'Q3. Best Phone Number');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q3.id },
      { fieldName: 'caller_name', fieldValue: 'Andy Pham' },
      { fieldName: 'callerName', fieldValue: 'Andy Pham' },
    ]);

    const result = progressActiveFlow(flow, state, null, {
      sessionCallerPhone: '+15559990001',
      sessionClientType: 'new',
    });

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('Q3. Best Phone Number');
  });

  it('interprets a replacement callback number from a natural no-answer', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q3 = flow.nodes.find((node: any) => node.label === 'Q3. Best Phone Number');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q3.id },
      { fieldName: 'caller_name', fieldValue: 'Andy Pham' },
      { fieldName: 'callerName', fieldValue: 'Andy Pham' },
    ]);

    const result = progressActiveFlow(flow, state, 'No, call me at 415-555-1212 instead.', {
      sessionCallerPhone: '+15559990001',
      sessionClientType: 'new',
    });

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('Q4. Self or On Behalf Of');
    expect(result.writes.some((write) => write.fieldName === 'callback_phone' && write.fieldValue === '+14155551212')).toBe(true);
  });

  it('asks for the callback number when the caller says the current number is not best', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q3 = flow.nodes.find((node: any) => node.label === 'Q3. Best Phone Number');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q3.id },
      { fieldName: 'caller_name', fieldValue: 'Andy Pham' },
      { fieldName: 'callerName', fieldValue: 'Andy Pham' },
    ]);

    const result = progressActiveFlow(flow, state, "No. It's not.", {
      sessionCallerPhone: '+15559990001',
      sessionClientType: 'new',
    });

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('Q3A. Callback Number');
    expect(result.assistantMessage).toBe('What is the best callback number for you?');
  });

  it('captures off-question self-or-other information semantically and still asks the unanswered callback question', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q3a = flow.nodes.find((node: any) => node.label === 'Q3A. Callback Number');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q3a.id },
      { fieldName: 'caller_name', fieldValue: 'Andy Pham' },
      { fieldName: 'callerName', fieldValue: 'Andy Pham' },
    ]);

    const result = progressActiveFlow(flow, state, "It's for my daughter.", {
      sessionCallerPhone: '+15559990001',
      sessionClientType: 'new',
    });

    expect(result.kind).toBe('clarify');
    if (result.kind !== 'clarify') return;
    expect(result.assistantMessage).toBe("I didn't catch the callback number. What is the best callback number for you?");
    expect(result.writes.some((write) => write.fieldName === 'callingFor' && write.fieldValue === 'other')).toBe(true);
    expect(result.writes.some((write) => write.fieldName === 'callback_phone')).toBe(false);
  });

  it('captures a spoken-out callback number instead of falling back to the inbound number', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q3a = flow.nodes.find((node: any) => node.label === 'Q3A. Callback Number');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q3a.id },
      { fieldName: 'caller_name', fieldValue: 'Sammy Smith' },
      { fieldName: 'callerName', fieldValue: 'Sammy Smith' },
    ]);

    const result = progressActiveFlow(flow, state, 'One two three seven two seven two four three seven', {
      sessionCallerPhone: '+19087272437',
      sessionClientType: 'new',
    });

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('Q4. Self or On Behalf Of');
    expect(result.writes.some((write) => write.fieldName === 'callback_phone' && write.fieldValue === '+11237272437')).toBe(true);
    expect(result.writes.some((write) => write.fieldName === 'call_origin_phone' && write.fieldValue === '+19087272437')).toBe(true);
  });

  it('uses existing-client knowledge to skip directly to the transfer step', () => {
    const flow = { id: 'flow-default', ...createDefaultIntakeTemplate() } as any;
    const q4 = flow.nodes.find((node: any) => node.label === 'Q4. New or Existing Client');

    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q4.id },
      { fieldName: 'clientStatus', fieldValue: 'existing' },
    ]);

    const result = progressActiveFlow(flow, state, null, {
      sessionClientType: 'existing',
    });

    expect(result.kind).toBe('transfer');
    if (result.kind !== 'transfer') return;
    expect(result.node.label).toBe('Current Client Team Transfer');
  });

  it('re-asks a clarifying version when a branching answer does not match any response', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: flow.nodes.find((node: any) => node.label === 'Q1. Shall we get started?').id },
    ]);

    const result = progressActiveFlow(flow, state, 'Banana', {});

    expect(result.kind).toBe('clarify');
    if (result.kind !== 'clarify') return;
    expect(result.assistantMessage).toBe('Shall we get started?');
  });

  it('briefly explains the opener when the caller asks what the intake is for instead of repeating the same question', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q1 = flow.nodes.find((node: any) => node.label === 'Q1. Shall we get started?');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q1.id },
    ]);

    const result = progressActiveFlow(flow, state, 'What is this for?', {});

    expect(result.kind).toBe('clarify');
    if (result.kind !== 'clarify') return;
    expect(result.assistantMessage).toBe("Of course. I just ask a few quick questions so I can understand your situation and get it to the right lawyer. Would you like to get started?");
  });

  it('uses the same brief explanation on the first opener refusal instead of looping the opening question', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q1 = flow.nodes.find((node: any) => node.label === 'Q1. Shall we get started?');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q1.id },
    ]);

    const result = progressActiveFlow(flow, state, 'No.', {});

    expect(result.kind).toBe('clarify');
    if (result.kind !== 'clarify') return;
    expect(result.assistantMessage).toBe("Of course. I just ask a few quick questions so I can understand your situation and get it to the right lawyer. Would you like to get started?");
  });

  it('ends politely after a repeated opener refusal instead of looping forever', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q1 = flow.nodes.find((node: any) => node.label === 'Q1. Shall we get started?');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q1.id },
      { fieldName: `__flow_flag::clarify_count::${q1.id}`, fieldValue: '1', nodeId: q1.id },
    ]);

    const result = progressActiveFlow(flow, state, 'No.', {});

    expect(result.kind).toBe('end');
    if (result.kind !== 'end') return;
    expect(result.assistantMessage).toBe('No problem. If you need legal help later, feel free to call us back. Goodbye.');
  });

  it('still advances normally when the caller says yes after the opener explanation', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q1 = flow.nodes.find((node: any) => node.label === 'Q1. Shall we get started?');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q1.id },
      { fieldName: `__flow_flag::clarify_count::${q1.id}`, fieldValue: '1', nodeId: q1.id },
    ]);

    const result = progressActiveFlow(flow, state, 'Yes.', {});

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('Q1b. New or Existing Client?');
  });

  it('asks the open-ended issue summary in a natural voice instead of reading builder instructions', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q5 = flow.nodes.find((node: any) => node.label === "Q5. Tell Me What's Going On");
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q5.id },
    ]);

    const result = progressActiveFlow(flow, state, null, {});

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.assistantMessage).toBe("Thanks. Can you tell me a little about what's been going on?");
  });

  it('does not lock in a vague issue summary or route on gibberish before the legal problem is clear', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const simulation = simulateFromNode(flow, "Q5. Tell Me What's Going On", [
      "We're gonna do the boards.",
      'Divorce.',
    ]);

    expect(simulation.outputs[1]).toMatchObject({
      kind: 'clarify',
      label: "Q5. Tell Me What's Going On",
      assistantMessage: 'Can you tell me a little more about what happened so I can route you correctly?',
    });
    expect(simulation.outputs[2]).toMatchObject({
      kind: 'ask',
      label: 'FH - Divorce / Separation',
    });
    expect(simulation.state.fieldValues.issue_summary).toBe('Divorce.');
  });

  it('politely ends obvious wrong-number business calls instead of forcing them through legal intake', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q5 = flow.nodes.find((node: any) => node.label === "Q5. Tell Me What's Going On");
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q5.id },
    ]);

    const result = progressActiveFlow(flow, state, 'I need help changing my concert ticket reservation. Is this the ticketing agency?', {});

    expect(result.kind).toBe('end');
    if (result.kind !== 'end') return;
    expect(result.assistantMessage).toBe("You've reached a law firm, so I think you may have the wrong number. If you need legal help, you're welcome to call us back. Goodbye.");
  });

  it('can end a clear wrong-number call from the opener when semantic understanding says it is not a legal intake', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q1 = flow.nodes.find((node: any) => node.label === 'Q1. Shall we get started?');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q1.id },
    ]);

    const result = progressActiveFlow(flow, state, "Hey, I'm trying to buy concert tickets.", {
      semanticFacts: {
        answerIntent: 'unclear',
        conversationFit: 'wrong_number',
        issueSummary: 'Caller is trying to buy concert tickets and is not seeking legal help.',
      },
    });

    expect(result.kind).toBe('end');
    if (result.kind !== 'end') return;
    expect(result.assistantMessage).toContain('wrong number');
  });

  it('can end an obvious scam or wrong-number call even after the intake already moved deeper into a legal branch', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === 'FH3. Children Involved');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
      { fieldName: 'issue_summary', fieldValue: 'I need help with a divorce.' },
    ]);

    const result = progressActiveFlow(flow, state, "Actually, I'm a scam caller.", {});

    expect(result.kind).toBe('end');
    if (result.kind !== 'end') return;
    expect(result.assistantMessage).toContain('wrong number');
  });

  it('can end an obvious non-legal business call from a deeper follow-up question instead of trapping the caller on that node', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === 'FH3. Children Involved');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
      { fieldName: 'issue_summary', fieldValue: 'I need help with a divorce.' },
    ]);

    const result = progressActiveFlow(flow, state, 'I need to book a movie ticket for tonight.', {
      semanticFacts: {
        questionState: 'off_topic',
        conversationFit: 'wrong_number',
      },
    });

    expect(result.kind).toBe('end');
    if (result.kind !== 'end') return;
    expect(result.assistantMessage).toContain('wrong number');
  });

  it('applies the same wrong-number guard to custom flows that collect an issue summary', () => {
    const flow = {
      id: 'custom-issue-flow',
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: {} },
        { id: 'q1', type: 'question', label: 'How can we help today?', config: { question: 'How can we help today?', collectFields: [{ name: 'issue_summary', label: 'Issue summary', type: 'text', required: true }] } },
        { id: 'q2', type: 'question', label: 'Next Question', config: { question: 'What is your name?' } },
      ],
      edges: [
        { sourceNodeId: 'start', targetNodeId: 'q1', label: null, sortOrder: 0 },
        { sourceNodeId: 'q1', targetNodeId: 'q2', label: null, sortOrder: 0 },
      ],
    } as any;
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: 'q1' },
    ]);

    const result = progressActiveFlow(flow, state, 'I am calling about a hotel reservation refund and my booking confirmation.', {});

    expect(result.kind).toBe('end');
    if (result.kind !== 'end') return;
    expect(result.assistantMessage).toContain('wrong number');
  });

  it('does not treat legal ticket or citation matters as wrong-number calls', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q5 = flow.nodes.find((node: any) => node.label === "Q5. Tell Me What's Going On");
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q5.id },
    ]);

    const result = progressActiveFlow(flow, state, 'I need help with a speeding ticket and I have court next week.', {});

    expect(result.kind).not.toBe('end');
  });

  it('does not treat a fraud story as a wrong-number call just because the scam involved a ticketing business', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q5 = flow.nodes.find((node: any) => node.label === "Q5. Tell Me What's Going On");
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q5.id },
    ]);

    const result = progressActiveFlow(
      flow,
      state,
      'Someone pretending to be a ticketing agency scammed me out of money and I need legal help.',
      {},
    );

    expect(result.kind).not.toBe('end');
  });

  it('does not end a legal matter when semantic understanding says it is a real intake even if the wording is messy', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q1 = flow.nodes.find((node: any) => node.label === 'Q1. Shall we get started?');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q1.id },
    ]);

    const result = progressActiveFlow(flow, state, 'It is about a ticket, I have court next week.', {
      semanticFacts: {
        answerIntent: 'unclear',
        conversationFit: 'legal_intake',
        issueSummary: 'Caller needs help with a citation and upcoming court date.',
      },
    });

    expect(result.kind).not.toBe('end');
  });

  it('reassures the caller and repeats the active question when they say hello', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q1b = flow.nodes.find((node: any) => node.label === 'Q1b. New or Existing Client?');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q1b.id },
    ]);

    const result = progressActiveFlow(flow, state, 'Hello?', {});

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.assistantMessage).toBe("Yes, I'm here. Have you worked with our firm before, or is this your first time reaching out to us?");
  });

  it('does not let a greeting override a clear client-status answer in the same turn', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q1b = flow.nodes.find((node: any) => node.label === 'Q1b. New or Existing Client?');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q1b.id },
    ]);

    const result = progressActiveFlow(flow, state, "Hello. It's, uh, my first time.", {});

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('Q2. Caller Name');
    expect(result.writes.some((write) => write.fieldName === 'clientStatus' && write.fieldValue === 'new')).toBe(true);
  });

  it('routes substantive children answers without requiring a literal yes', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === 'FH3. Children Involved');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ]);

    const result = progressActiveFlow(flow, state, 'Yes, we have two kids together.', {});

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('FH4. Other Side Representation');
    expect(result.assistantMessage).toBe('Does your spouse or partner already have a lawyer?');
  });

  it('moves past a blocked non-core follow-up when the caller is unsure twice and wants to move on', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;

    const simulation = simulateFromNode(flow, 'FH3. Children Involved', [
      'I have no idea.',
      "I don't know. Can we move on?",
    ]);

    expect(simulation.outputs[1]).toMatchObject({
      kind: 'clarify',
      label: 'FH3. Children Involved',
    });
    expect(simulation.outputs[2]).toMatchObject({
      kind: 'ask',
      label: 'FH4. Other Side Representation',
      assistantMessage: 'Does your spouse or partner already have a lawyer?',
    });
  });

  it('can semantically skip a blocked non-core question on the first turn when the caller clearly wants to move on', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === 'FH3. Children Involved');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ]);

    const result = progressActiveFlow(flow, state, "I really don't know. Let's move on.", {
      semanticFacts: {
        questionState: 'wants_to_skip',
      },
    });

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('FH4. Other Side Representation');
    expect(result.assistantMessage).toBe('Does your spouse or partner already have a lawyer?');
  });

  it('answers a short related question in plain English when it directly relates to the current intake step', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === 'FH3. Children Involved');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ]);

    const result = progressActiveFlow(flow, state, 'What is a minor?', {});

    expect(result.kind).toBe('clarify');
    if (result.kind !== 'clarify') return;
    expect(result.assistantMessage).toBe('A minor means a child under 18. Are there any children under 18 involved in this matter?');
  });

  it('does not go off-topic when the caller asks an unrelated question during intake', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === 'FH3. Children Involved');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ]);

    const result = progressActiveFlow(flow, state, "What's your favorite color?", {});

    expect(result.kind).toBe('clarify');
    if (result.kind !== 'clarify') return;
    expect(result.assistantMessage).toBe('Are there any children under 18 involved in this matter?');
  });

  it('accepts a semantic branch hint for filing status instead of looping on natural no-answers', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === 'FH2. Filing Status / Court Dates');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ]);

    const result = progressActiveFlow(flow, state, 'No. None.', {
      matchedChoiceLabel: 'nothing filed yet',
    });

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('FH3. Children Involved');
    expect(result.assistantMessage).toBe('Are there minor children involved in this matter?');
  });

  it('accepts a semantic branch hint for divorce urgency instead of repeating the same question', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === 'FH5. Immediate Divorce Urgency');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ]);

    const result = progressActiveFlow(flow, state, "No. There's not.", {
      matchedChoiceLabel: 'no immediate urgency',
    });

    expect(result.kind).toBe('transfer');
    if (result.kind !== 'transfer') return;
    expect(result.node.label).toBe('Transfer to Attorney');
  });

  it('gives a plain-English clarification instead of repeating a category question word-for-word', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === 'Tax I1. IRS or State Level');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ]);

    const result = progressActiveFlow(flow, state, 'How do I tell the difference?', {});

    expect(result.kind).toBe('clarify');
    if (result.kind !== 'clarify') return;
    expect(result.assistantMessage).toBe("That's okay. You do not need the exact legal label. Which is closest here: Federal IRS only, State tax authority only, or Both federal and state? If you're not sure, just tell me what the notice, paperwork, or agency says.");
  });

  it('answers a short in-context divorce-type term question without drifting off-topic', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === 'FH - Divorce / Separation');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ]);

    const result = progressActiveFlow(flow, state, 'What does uncontested mean?', {});

    expect(result.kind).toBe('clarify');
    if (result.kind !== 'clarify') return;
    expect(result.assistantMessage).toBe("Uncontested usually means you mostly agree on the big issues. Contested means you disagree on major issues. Legal separation means living separately and handling things legally without ending the marriage. Are you mostly agreeing, mostly disagreeing, or asking about a legal separation?");
  });

  it('handles repeat requests on branching questions with a plain-English clarification', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === 'Tax I2. Urgency - Active Action');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ]);

    const result = progressActiveFlow(flow, state, 'What was that last part?', {});

    expect(result.kind).toBe('clarify');
    if (result.kind !== 'clarify') return;
    expect(result.assistantMessage).toBe("That's okay. You do not need the exact legal label. Which is closest here: active lien or levy on bank or wages, criminal investigation or summons, notices received but no enforcement yet, or proactive planning or early stage? If you're not sure, just tell me what the notice, paperwork, or agency says.");
  });

  it('does not accept a semantic guess when the caller says they do not know and there is no unsure branch', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === 'Tax I2. Urgency - Active Action');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ]);

    const result = progressActiveFlow(flow, state, "Honestly, I don't know.", {
      matchedChoiceLabel: 'Yes - notices received but no enforcement yet',
    });

    expect(result.kind).toBe('clarify');
    if (result.kind !== 'clarify') return;
    expect(result.writes.some((write) => write.fieldName.startsWith('__flow_selected::'))).toBe(false);
  });

  it('does not write confused branching answers into unrelated structured fields', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === 'Tax I1. IRS or State Level');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ]);

    const result = progressActiveFlow(flow, state, 'How do I tell the difference?', {});

    expect(result.kind).toBe('clarify');
    expect(result.writes.some((write) => write.fieldName === 'tax_years')).toBe(false);
    expect(result.writes.some((write) => write.fieldName === 'estimated_amount')).toBe(false);
  });

  it('uses an explicit not-sure branch after one clarification when the caller stays uncertain on a generic branching question', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const simulation = simulateFromNode(flow, 'Bankruptcy - Type', [
      "I'm not sure.",
      'Still not sure.',
    ]);

    expect(simulation.outputs[1]).toMatchObject({
      kind: 'clarify',
      label: 'Bankruptcy - Type',
    });
    expect(simulation.outputs[2]).toMatchObject({
      kind: 'ask',
      label: 'Bank H1. Primary Debt Type',
    });
  });

  it('routes natural incident timing like last Thursday into the recent personal injury bucket', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === 'PI D1. Date of Incident');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ]);

    const result = progressActiveFlow(flow, state, 'Last Thursday, and I broke my arm.', {});

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('PI D2. Medical Treatment Status');
    expect(result.assistantMessage).toBe('Are you currently receiving medical treatment for your injuries?');
  });

  it('does not skip from self/other directly into tax when no issue was described', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q4 = flow.nodes.find((node: any) => node.label === 'Q4. Self or On Behalf Of');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q4.id },
      { fieldName: 'clientStatus', fieldValue: 'new' },
      { fieldName: 'callerName', fieldValue: 'Andy Sam' },
      { fieldName: 'caller_name', fieldValue: 'Andy Sam' },
      { fieldName: 'callback_phone', fieldValue: '+19087272437' },
      { fieldName: 'callerPhone', fieldValue: '+19087272437' },
    ]);

    const result = progressActiveFlow(flow, state, 'Uh, myself.', {});

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe("Q5. Tell Me What's Going On");
    expect(result.assistantMessage).toBe("Thanks. Can you tell me a little about what's been going on?");
  });

  it('keeps generic clarifications natural instead of forcing canned option labels', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === 'FH1. Divorce Issues Involved');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ]);

    const result = progressActiveFlow(flow, state, 'Something complicated.', {});

    expect(result.kind).toBe('clarify');
    if (result.kind !== 'clarify') return;
    expect(result.assistantMessage).toBe("That's okay. What feels most important right now - children, support, money, property, or something else?");
    expect(result.assistantMessage.includes('You can say')).toBe(false);
  });

  it('skips redundant family triage when the issue summary already clearly indicates divorce', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === 'Family Law - Matter Triage');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
      { fieldName: 'issueSummary', fieldValue: "I've been lost with a divorce." },
      { fieldName: 'issue_summary', fieldValue: "I've been lost with a divorce." },
    ]);

    const result = progressActiveFlow(flow, state, null, {});

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('FH - Divorce / Separation');
    expect(result.assistantMessage).toBe('Is this an uncontested divorce, contested divorce, or legal separation?');
  });

  it('routes a direct divorce issue summary from Q5 straight into the divorce intake path', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === "Q5. Tell Me What's Going On");
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ]);

    const result = progressActiveFlow(flow, state, 'Divorce.', {});

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('FH - Divorce / Separation');
    expect(result.assistantMessage).toBe("That sounds really stressful. Let me ask a couple of quick questions so I can get this to the right lawyer. Is this an uncontested divorce, contested divorce, or legal separation?");
  });

  it('adds a one-time human acknowledgment before the first branch question after a difficult issue summary', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === "Q5. Tell Me What's Going On");
    const rows = [
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ];

    const { result } = advanceConversationTurn(flow, rows, 'I got hurt in a car accident.', {});

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('PI D1. Date of Incident');
    expect(result.assistantMessage).toBe('Approximately when did the incident occur?');
  });

  it.each([
    ['family', "I'm going through a divorce.", 'ask', 'FH - Divorce / Separation'],
    ['criminal', 'I was arrested for a DUI last night.', 'ask', 'Crim B1. Stage of Case'],
    ['criminal natural phrasing', 'I got into a bar fight and now I think he is pressing charges.', 'ask', 'Crim B1. Stage of Case'],
    ['immigration', 'I need help with my green card application.', 'ask', 'Imm C1. Current Immigration Status'],
    ['personal injury', 'I got hurt in a car accident.', 'ask', 'PI D1. Date of Incident'],
    ['corporate', 'I need help with a contract dispute for my business.', 'ask', 'Corp E1. Role and Business Type'],
    ['real estate', 'I need help with a real estate problem involving my property.', 'ask', 'RE F1. Property Type and Role'],
    ['employment', 'I need help with an employment issue at work.', 'ask', 'Emp G1. Employment Status'],
    ['bankruptcy', 'I am overwhelmed by debt and may need bankruptcy.', 'ask', 'Bank H1. Primary Debt Type'],
    ['tax', 'The IRS is auditing me over back taxes.', 'ask', 'Tax I1. IRS or State Level'],
    ['estate planning', 'I need a will and trust set up.', 'ask', 'Estate J1. Health and Urgency'],
    ['intellectual property', 'Someone copied my logo and trademark.', 'ask', 'IP K1. Registration Status'],
    ['civil rights', 'I was falsely arrested by the police.', 'ask', 'CR L1. Who Committed the Violation'],
    ['environmental', 'My property has contaminated water and the EPA contacted us.', 'ask', 'Env M1. Your Role in This Matter'],
  ])('routes %s summaries from Q5 to the right branch', (_name, callerIssue, expectedKind, expectedLabel) => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === "Q5. Tell Me What's Going On");
    const rows = [
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ];

    const { result } = advanceConversationTurn(flow, rows, callerIssue, {});

    expect(result.kind).toBe(expectedKind);
    if (!('node' in result)) return;
    expect(result.node.label).toBe(expectedLabel);
  });

  it('routes direct divorce issue summaries in the family template straight into the divorce branch', () => {
    const flow = { id: 'flow-family', ...createFamilyIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === "Q5. Tell Me What's Going On");
    const rows = [
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ];

    const { result } = advanceConversationTurn(flow, rows, 'I need help with a divorce.', {});

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('FH - Divorce / Separation');
  });

  it('routes clearly outside-family legal issues in the family template to a family-law-only follow-up instead of forcing a family branch', () => {
    const flow = { id: 'flow-family', ...createFamilyIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === "Q5. Tell Me What's Going On");
    const rows: Array<{ fieldName: string; fieldValue: string; nodeId?: string | null }> = [
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ];

    const { result } = advanceConversationTurn(flow, rows, 'I got arrested for a DUI last night.', {});

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('Family Line Only - Family-Law Follow-Up');
    expect(result.assistantMessage).toBe('This line is for family law only. Can I help you with anything family-law-related today?');
    expect(rows.some((row) => row.fieldName === 'practiceArea' && row.fieldValue === 'outside_family_scope')).toBe(true);
  });

  it('uses the same family-law-only follow-up when the caller reaches family triage but then describes a different practice area', () => {
    const flow = { id: 'flow-family', ...createFamilyIntakeTemplate() } as any;
    const famTriage = flow.nodes.find((node: any) => node.label === 'Family Law - Matter Triage');
    const rows: Array<{ fieldName: string; fieldValue: string; nodeId?: string | null }> = [
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: famTriage.id },
      { fieldName: 'issueSummary', fieldValue: 'I need legal help but I am not sure what kind yet.' },
    ];

    const { result } = advanceConversationTurn(flow, rows, 'Actually this is about my green card application.', {});

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('Family Line Only - Family-Law Follow-Up');
    expect(result.assistantMessage).toBe('This line is for family law only. Can I help you with anything family-law-related today?');
    expect(rows.some((row) => row.fieldName === 'practiceArea' && row.fieldValue === 'outside_family_scope')).toBe(true);
  });

  it('asks once about any family-law issue before ending when a caller clarifies a business tax issue mid-call', () => {
    const flow = { id: 'flow-family', ...createFamilyIntakeTemplate() } as any;

    const simulation = simulateConversation(flow, [
      'Yes.',
      'First time.',
      'John Smith.',
      'Yes, this number is fine.',
      'For myself.',
      'Tax issues.',
      'No, I have a business tax issue.',
    ]);

    const finalOutput = simulation.outputs.at(-1);

    expect(finalOutput?.kind).toBe('end');
    expect(finalOutput?.label).toBe('Family Line Only - Call Main Line');
    expect(finalOutput?.assistantMessage).toBe('Okay. Please call the main line for non-family-law matters. Goodbye.');
    expect(simulation.rows.some((row) => row.fieldName === 'practiceArea' && row.fieldValue === 'outside_family_scope')).toBe(true);
  });

  it('routes back into family intake when the caller says they do have a family-law issue after an outside-scope detour', () => {
    const flow = { id: 'flow-family', ...createFamilyIntakeTemplate() } as any;

    const simulation = simulateConversation(flow, [
      'Yes.',
      'First time.',
      'John Smith.',
      'Yes, this number is fine.',
      'For myself.',
      'Tax issues.',
      'Actually yes, I need help with custody.',
    ]);

    expect(simulation.outputs.some((output) => output.label === 'Family Line Only - Family-Law Follow-Up')).toBe(true);
    const finalOutput = simulation.outputs.at(-1);
    expect(finalOutput?.kind).toBe('ask');
    expect(finalOutput?.label).toBe('FA - Custody Order Status');
  });

  it('routes custody-order violation language directly to the custody branch', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === "Q5. Tell Me What's Going On");
    const rows = [
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ];

    const { result } = advanceConversationTurn(
      flow,
      rows,
      'My ex moved to Pennsylvania with the kids even though we already have a custody order.',
      {},
    );

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('FA - Custody Order Status');
  });

  it('uses generic semantic matching for custom branching flows outside the built-in legal templates', () => {
    const flow = {
      id: 'custom-routing-flow',
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: {} },
        { id: 'q1', type: 'question', label: 'What do you need help with?', config: { question: 'What do you need help with?' } },
        { id: 'r1', type: 'response', label: 'New consultation', config: { response: 'New consultation' } },
        { id: 'r2', type: 'response', label: 'Change existing appointment', config: { response: 'Change existing appointment' } },
        { id: 'r3', type: 'response', label: 'Billing question', config: { response: 'Billing question' } },
        { id: 'q-new', type: 'question', label: 'Consult Details', config: { question: 'What kind of consultation do you need?' } },
        { id: 'q-reschedule', type: 'question', label: 'Reschedule Details', config: { question: 'What day works better for you?' } },
        { id: 'q-billing', type: 'question', label: 'Billing Details', config: { question: 'What is the billing issue?' } },
      ],
      edges: [
        { sourceNodeId: 'start', targetNodeId: 'q1', label: null, sortOrder: 0 },
        { sourceNodeId: 'q1', targetNodeId: 'r1', label: 'New consultation', sortOrder: 0 },
        { sourceNodeId: 'q1', targetNodeId: 'r2', label: 'Change existing appointment', sortOrder: 1 },
        { sourceNodeId: 'q1', targetNodeId: 'r3', label: 'Billing question', sortOrder: 2 },
        { sourceNodeId: 'r1', targetNodeId: 'q-new', label: null, sortOrder: 0 },
        { sourceNodeId: 'r2', targetNodeId: 'q-reschedule', label: null, sortOrder: 0 },
        { sourceNodeId: 'r3', targetNodeId: 'q-billing', label: null, sortOrder: 0 },
      ],
    } as any;
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: 'q1' },
    ]);

    const result = progressActiveFlow(flow, state, 'I just need to move my current appointment.', {});

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('Reschedule Details');
    expect(result.assistantMessage).toBe('Thanks for walking me through that. What day works better for you?');
  });

  it('falls back to the catch-all branch when a weird mixed real-estate situation does not clearly fit one subtype', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const simulation = simulateFromNode(flow, 'Real Estate - Matter Type', [
      "I'm trying to sell one property, and I'm getting sued over another one.",
      'Residential property. I am the owner.',
      'No immediate deadline.',
    ], {});

    expect(simulation.outputs.map((output) => output.label)).toEqual([
      'Real Estate - Matter Type',
      'RE F1. Property Type and Role',
      'RE F2. Urgency - Deadlines or Court Date',
      'Transfer to Attorney',
    ]);
    expect(simulation.state.fieldValues.re_matter).toBe('Other real estate matter');
  });

  it('routes support-modification language directly to the support branch', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === "Q5. Tell Me What's Going On");
    const rows = [
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ];

    const { result } = advanceConversationTurn(
      flow,
      rows,
      "I got laid off and need to lower my child support because there's already an order.",
      {},
    );

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('FB - Support Filing Status');
  });

  it.each([
    [
      'criminal',
      'Criminal - Matter Type',
      [
        'DUI or drunk driving',
        'Charges filed - awaiting trial',
        'No - not in custody',
        'No prior record',
      ],
      ['Criminal - Matter Type', 'Crim B1. Stage of Case', 'Crim B2. Custody Status', 'Crim B3. Prior Record & Details', 'Transfer to Attorney'],
    ],
    [
      'immigration',
      'Immigration - Matter Type',
      [
        'Green card or permanent residence',
        'Visa holder or temporary status',
        'No active order or hearing',
        'First-time application',
      ],
      ['Immigration - Matter Type', 'Imm C1. Current Immigration Status', 'Imm C2. Removal / Hearing Urgency', 'Imm C3. Prior Application History', 'Transfer to Attorney'],
    ],
    [
      'personal injury',
      'Personal Injury - Incident Type',
      [
        'Car, truck, or motorcycle accident',
        'Last Thursday, and I broke my arm.',
        'Yes, still in active treatment',
        'No claim filed yet',
      ],
      ['Personal Injury - Incident Type', 'PI D1. Date of Incident', 'PI D2. Medical Treatment Status', 'PI D3. Insurance and Representation', 'Transfer to Attorney'],
    ],
    [
      'corporate',
      'Corporate - Matter Type',
      [
        'Contract dispute, review, or drafting',
        'I am the sole owner / sole member',
        'No - planning or advisory matter',
        'I need advice or document review',
      ],
      ['Corporate - Matter Type', 'Corp E1. Role and Business Type', 'Corp E2. Urgency - Active Litigation', 'Corp E3. Matter Description', 'Transfer to Attorney'],
    ],
    [
      'real estate',
      'Real Estate - Matter Type',
      [
        'Other real estate matter',
        'Buyer',
        'No immediate deadline',
      ],
      ['Real Estate - Matter Type', 'RE F1. Property Type and Role', 'RE F2. Urgency - Deadlines or Court Date', 'Transfer to Attorney'],
    ],
    [
      'employment',
      'Employment - Matter Type',
      [
        'Other employment or HR matter',
        'Currently employed there',
        'Other protected class or not applicable',
        'No known deadline',
      ],
      ['Employment - Matter Type', 'Emp G1. Employment Status', 'Emp G2. Protected Class / Basis', 'Emp G3. Urgency and Documentation', 'Transfer to Attorney'],
    ],
    [
      'bankruptcy',
      'Bankruptcy - Type',
      [
        'Chapter 7 / personal bankruptcy',
        'A mix of several types',
        'No - planning ahead or exploring options',
        'No prior bankruptcy',
      ],
      ['Bankruptcy - Type', 'Bank H1. Primary Debt Type', 'Bank H2. Urgency - Garnishment or Foreclosure', 'Bank H3. Prior Bankruptcy History', 'Transfer to Attorney'],
    ],
    [
      'tax',
      'Tax Law - Matter Type',
      [
        'Other tax law matter',
        'Federal IRS only',
        'No - proactive planning or early stage',
        'No prior contact or representation',
      ],
      ['Tax Law - Matter Type', 'Tax I1. IRS or State Level', 'Tax I2. Urgency - Active Action', 'Tax I3. Prior Contact and Representation', 'Transfer to Attorney'],
    ],
    [
      'estate planning',
      'Estate Planning - Matter Type',
      [
        'Other estate planning or elder law matter',
        'No urgency - general planning or updating documents',
        'Modest estate under 500K',
      ],
      ['Estate Planning - Matter Type', 'Estate J1. Health and Urgency', 'Estate J2. Estate Size and Assets', 'Transfer to Attorney'],
    ],
    [
      'intellectual property',
      'IP - Matter Type',
      [
        'Other intellectual property or innovation matter',
        'Not yet registered',
        'No infringement - registration or proactive protection',
      ],
      ['IP - Matter Type', 'IP K1. Registration Status', 'IP K2. Infringement Urgency', 'Transfer to Attorney'],
    ],
    [
      'civil rights',
      'Civil Rights - Matter Type',
      [
        'Other civil rights violation',
        'Other government or public entity',
        'No significant physical or financial harm - seeking injunctive relief',
      ],
      ['Civil Rights - Matter Type', 'CR L1. Who Committed the Violation', 'CR L2. Injuries and Documentation', 'Transfer to Attorney'],
    ],
    [
      'environmental',
      'Environmental - Matter Type',
      [
        'Other environmental or natural resources matter',
        'Property owner or developer affected by regulations or contamination',
        'No active enforcement - planning, permitting, or damages claim',
      ],
      ['Environmental - Matter Type', 'Env M1. Your Role in This Matter', 'Env M2. Regulatory Action or Enforcement', 'Transfer to Attorney'],
    ],
  ])('can simulate a representative %s branch from intake question to transfer', (_name, startNodeLabel, callerReplies, expectedLabels) => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const simulation = simulateFromNode(flow, startNodeLabel, callerReplies as string[], {});

    expect(simulation.outputs.map((output) => output.label)).toEqual(expectedLabels);
    expect(simulation.outputs.at(-1)?.kind).toBe('transfer');
  });

  it('handles a natural support modification caller without looping on payee-only arrears wording', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;

    const simulation = simulateConversation(flow, [
      'Yes',
      'First time.',
      'Deshawn Williams',
      'No. A better number is seven one eight five five five zero three four four.',
      'Myself.',
      "I got laid off and need to lower my child support because there's already an order.",
      'This is a modification. I want it reduced.',
      'Just child support.',
      "I'm the one paying.",
    ], {
      sessionCallerPhone: '+12179042984',
    });

    expect(simulation.outputs.map((output) => output.label)).toEqual([
      'Q1. Shall we get started?',
      'Q1b. New or Existing Client?',
      'Q2. Caller Name',
      'Q3. Best Phone Number',
      'Q4. Self or On Behalf Of',
      "Q5. Tell Me What's Going On",
      'FB - Support Filing Status',
      'FB1. Type of Support',
      'FB3. Party Role',
      'Transfer to Attorney',
    ]);
    expect(simulation.state.fieldValues.callerName).toBe('Deshawn Williams');
    expect(simulation.state.fieldValues.callback_phone).toBe('+17185550344');
  });

  it('gives one clarification on an uncertain criminal-charge answer, then uses the fallback path on repeated uncertainty', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const simulation = simulateFromNode(flow, 'Criminal - Matter Type', [
      "I don't know.",
      'Still not sure.',
    ]);

    expect(simulation.outputs[1]).toMatchObject({
      kind: 'clarify',
      label: 'Criminal - Matter Type',
      assistantMessage: "That's okay if you don't know the exact charge yet. What do you know so far about what happened or what the police told you?",
    });
    expect(simulation.outputs[2]).toMatchObject({
      kind: 'ask',
      label: 'Crim B1. Stage of Case',
    });
  });

  it('gives a more human clarification for divorce issues when the caller does not know the legal label', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === 'FH1. Divorce Issues Involved');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ]);

    const result = progressActiveFlow(flow, state, "I don't know.", {});

    expect(result.kind).toBe('clarify');
    if (result.kind !== 'clarify') return;
    expect(result.assistantMessage).toBe("That's okay. What feels most important right now - children, support, money, property, or something else?");
  });

  it('can move past a blocked subtype question when all answer paths converge to the same next follow-up', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;

    const simulation = simulateFromNode(flow, 'FH - Divorce / Separation', [
      "I don't know.",
      "Move on. Let's move on.",
    ]);

    expect(simulation.outputs[1]).toMatchObject({
      kind: 'clarify',
      label: 'FH - Divorce / Separation',
    });
    expect(simulation.outputs[2]).toMatchObject({
      kind: 'ask',
      label: 'FH1. Divorce Issues Involved',
      assistantMessage: 'What are the main issues in the divorce or separation right now?',
    });
  });

  it('can move past a blocked subtype question after repeated non-progress even without an explicit move-on phrase', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;

    const simulation = simulateFromNode(flow, 'FH - Divorce / Separation', [
      "I don't know.",
      "No. No. It's Levi.",
    ]);

    expect(simulation.outputs[1]).toMatchObject({
      kind: 'clarify',
      label: 'FH - Divorce / Separation',
    });
    expect(simulation.outputs[2]).toMatchObject({
      kind: 'ask',
      label: 'FH1. Divorce Issues Involved',
      assistantMessage: 'What are the main issues in the divorce or separation right now?',
    });
  });

  it('gives exactly one clarification on the open-ended issue question before falling back to the catch-all path', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;

    const simulation = simulateFromNode(flow, "Q5. Tell Me What's Going On", [
      "I don't know.",
      'Still not sure.',
    ]);

    expect(simulation.outputs[1]).toMatchObject({
      kind: 'clarify',
      label: "Q5. Tell Me What's Going On",
      assistantMessage: 'Can you tell me a little more about what happened so I can route you correctly?',
    });
    expect(simulation.outputs[2]).toMatchObject({
      kind: 'transfer',
      label: 'Transfer to Attorney',
    });
  });

  it('gives exactly one clarification before using an explicit unsure branch on a generic custom flow', () => {
    const flow = {
      id: 'custom-fallback-flow',
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: {} },
        { id: 'q1', type: 'question', label: 'Matter Type', config: { question: 'What kind of matter is this?' } },
        { id: 'resp-a', type: 'response', label: 'Contract dispute', config: { response: 'Contract dispute' } },
        { id: 'resp-b', type: 'response', label: 'Property dispute', config: { response: 'Property dispute' } },
        { id: 'resp-other', type: 'response', label: 'Other / not sure', config: { response: 'Other / not sure' } },
        { id: 'q2', type: 'question', label: 'Details', config: { question: 'What do you know so far about it?' } },
      ],
      edges: [
        { sourceNodeId: 'start', targetNodeId: 'q1', sortOrder: 0 },
        { sourceNodeId: 'q1', targetNodeId: 'resp-a', sortOrder: 0 },
        { sourceNodeId: 'q1', targetNodeId: 'resp-b', sortOrder: 1 },
        { sourceNodeId: 'q1', targetNodeId: 'resp-other', sortOrder: 2 },
        { sourceNodeId: 'resp-a', targetNodeId: 'q2', sortOrder: 0 },
        { sourceNodeId: 'resp-b', targetNodeId: 'q2', sortOrder: 0 },
        { sourceNodeId: 'resp-other', targetNodeId: 'q2', sortOrder: 0 },
      ],
    } as any;

    const simulation = simulateFromNode(flow, 'Matter Type', [
      "I don't know.",
      'Still not sure.',
    ]);

    expect(simulation.outputs[1]).toMatchObject({
      kind: 'clarify',
      label: 'Matter Type',
    });
    expect(simulation.outputs[2]).toMatchObject({
      kind: 'ask',
      label: 'Details',
      assistantMessage: 'What do you know so far about it?',
    });
  });

  it('clarifies divorce type questions instead of accepting a semantic guess when the caller says they do not know the difference', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === 'FH - Divorce / Separation');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ]);

    const result = progressActiveFlow(flow, state, 'I have no idea what the difference is.', {
      matchedChoiceLabel: 'Uncontested - we agree on everything',
    });

    expect(result.kind).toBe('clarify');
    if (result.kind !== 'clarify') return;
    expect(result.assistantMessage).toBe("That's okay. If you're not sure of the legal term, tell me whether you mostly agree, mostly disagree, or whether you're asking about a legal separation instead of ending the marriage.");
  });

  it('treats locked-out-of-finances divorce answers as urgent without repeating the question', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === 'FH5. Immediate Divorce Urgency');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
    ]);

    const result = progressActiveFlow(flow, state, "I'm scared of being locked out of finances.", {});

    expect(result.kind).toBe('action');
    if (result.kind !== 'action') return;
    expect(result.writes.some((write) => write.fieldName.includes('__flow_selected::') && write.fieldValue === 'Yes - there is an urgent divorce issue')).toBe(true);
  });

  it('does not auto-answer later divorce follow-up questions from the original issue summary alone', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;
    const q = flow.nodes.find((node: any) => node.label === 'FH5. Immediate Divorce Urgency');
    const state = hydrateFlowRuntimeState([
      { fieldName: FLOW_CURRENT_NODE_KEY, fieldValue: q.id },
      { fieldName: 'issueSummary', fieldValue: "I'm going through a divorce." },
      { fieldName: 'issue_summary', fieldValue: "I'm going through a divorce." },
    ]);

    const result = progressActiveFlow(flow, state, null, {});

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('FH5. Immediate Divorce Urgency');
    expect(result.assistantMessage).toBe('Is there anything urgent right now, like a safety issue, being locked out of finances or the home, or a deadline coming up?');
  });

  it('can simulate a full divorce intake conversation without falling back to generic family triage', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;

    const simulation = simulateConversation(flow, [
      'Yes',
      'First time.',
      'Andy Pham',
      'Yes',
      'For myself.',
      'I am going through a divorce.',
      'Contested divorce.',
      'Child custody and support.',
      'Nothing filed yet.',
      'Yes, we have two kids together.',
      'No, the other side does not have a lawyer.',
      'No immediate urgency.',
    ], {
      sessionCallerPhone: '+15559990001',
    });

    expect(simulation.outputs.map((output) => output.label)).toEqual([
      'Q1. Shall we get started?',
      'Q1b. New or Existing Client?',
      'Q2. Caller Name',
      'Q3. Best Phone Number',
      'Q4. Self or On Behalf Of',
      "Q5. Tell Me What's Going On",
      'FH - Divorce / Separation',
      'FH1. Divorce Issues Involved',
      'FH2. Filing Status / Court Dates',
      'FH3. Children Involved',
      'FH4. Other Side Representation',
      'FH5. Immediate Divorce Urgency',
      'Transfer to Attorney',
    ]);
    expect(simulation.outputs.some((output) => output.label === 'Family Law - Matter Triage')).toBe(false);
    expect(simulation.outputs.at(-1)?.kind).toBe('transfer');
  });

  it('can simulate a natural conversation where volunteered facts skip redundant intake questions', () => {
    const flow = { id: 'flow-general', ...createGeneralIntakeTemplate() } as any;

    const simulation = simulateConversation(flow, [
      'Yes',
      "It's my first time. My name is Andy Pham. I'm calling for myself about a car accident.",
      'Yes',
      'Last Thursday, and I broke my arm.',
      'Yes, I am still treating.',
      'No claim filed yet.',
    ], {
      sessionCallerPhone: '+15559990001',
    });

    expect(simulation.outputs.map((output) => output.label)).toEqual([
      'Q1. Shall we get started?',
      'Q1b. New or Existing Client?',
      'Q3. Best Phone Number',
      'PI D1. Date of Incident',
      'PI D2. Medical Treatment Status',
      'PI D3. Insurance and Representation',
      'Transfer to Attorney',
    ]);
    expect(simulation.outputs.some((output) => output.label === 'Q2. Caller Name')).toBe(false);
    expect(simulation.outputs.some((output) => output.label === 'Q4. Self or On Behalf Of')).toBe(false);
    expect(simulation.outputs.some((output) => output.label === "Q5. Tell Me What's Going On")).toBe(false);
    expect(simulation.state.fieldValues.callerName).toBe('Andy Pham');
    expect(simulation.state.fieldValues.callingFor).toBe('self');
    expect(simulation.state.fieldValues.issueSummary).toContain('car accident');
  });
});
