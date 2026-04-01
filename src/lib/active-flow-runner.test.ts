import { describe, expect, it } from 'vitest';
import {
  FLOW_CURRENT_NODE_KEY,
  hydrateFlowRuntimeState,
  progressActiveFlow,
} from '@/lib/active-flow-runner';
import { createGeneralIntakeTemplate } from '@/lib/templates/general-intake';
import { createDefaultIntakeTemplate } from '@/lib/templates/default-intake';

describe('active flow runner', () => {
  it('skips pre-answered opening questions and lands on the correct practice-area question', () => {
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

    expect(result.kind).toBe('ask');
    if (result.kind !== 'ask') return;
    expect(result.node.label).toBe('Personal Injury - Incident Type');
    expect(result.assistantMessage).toBe('What type of accident or injury occurred?');
    expect(result.writes.some((write) => write.fieldName === FLOW_CURRENT_NODE_KEY && write.fieldValue === result.node.id)).toBe(true);
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
    expect(result.assistantMessage).toContain('Shall we get started?');
  });
});
