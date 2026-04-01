import { describe, expect, it } from 'vitest';
import { createGeneralIntakeTemplate } from './templates/general-intake';
import { validateFlowSummaryReadiness } from './flow-summary-readiness';

describe('validateFlowSummaryReadiness', () => {
  const flow = { id: 'general', ...createGeneralIntakeTemplate() };

  it('blocks a divorce summary until every divorce checkpoint on the chosen path is covered', () => {
    const result = validateFlowSummaryReadiness(flow, {
      issue: 'I need help with my divorce.',
      notes: 'Divorce or legal separation. Contested - we disagree on key issues. Child custody and support.',
    });

    expect(result.ready).toBe(false);
    expect(result.missingRequirements).toEqual([
      'Has anything already been filed, and is there any court date or deadline coming up?',
      'Are there minor children involved in this matter?',
      'Does your spouse or partner already have a lawyer?',
      'Is there anything urgent right now, like a safety issue, being locked out of finances or the home, or a deadline coming up?',
    ]);
  });

  it('allows a divorce summary after the full divorce path has been covered', () => {
    const result = validateFlowSummaryReadiness(flow, {
      issue: 'I need help with my divorce.',
      notes: [
        'Divorce or legal separation.',
        'Contested - we disagree on key issues.',
        'Child custody and support.',
        'Filed already - no court date yet.',
        'Yes - minor children are involved.',
        'No - the other side does not have a lawyer.',
        'No - no immediate urgency.',
      ].join(' '),
    });

    expect(result.ready).toBe(true);
    expect(result.missingRequirements).toEqual([]);
  });

  it('uses caller answers from a transcript-style note instead of matching the assistant prompts', () => {
    const result = validateFlowSummaryReadiness(flow, {
      issue: 'Andy Fam called a law firm for an intake session regarding a contested divorce, primarily focused on child custody for his two minor children aged 11 and 15.',
      notes: [
        "bobby: Good afternoon. Thank you for calling test.",
        'Caller: Yes, sir.',
        'bobby: Have you worked with our firm before, or is this your first time reaching out to us?',
        'Caller: First time.',
        'bobby: Is the number you\'re calling from the best number to reach you if we get disconnected?',
        'Caller: Yeah.',
        'bobby: Are you calling for yourself or on behalf of someone else?',
        'Caller: Myself.',
        'bobby: Is this an uncontested divorce, a contested divorce, or a legal separation?',
        "Caller: I don't know.",
        'bobby: Are there disagreements right now about things like property, support, or custody?',
        'Caller: Custody.',
        'bobby: What issues are involved in the divorce?',
        'Caller: Mostly child custody.',
        'bobby: Has anything already been filed, and is there any court date or deadline coming up?',
        "Caller: Nothing's filed yet.",
        'bobby: Are there minor children involved in this matter?',
        "Caller: So 2 children. One's 11 and one's 15.",
        'bobby: Does your spouse or partner already have a lawyer?',
        "Caller: I don't know.",
        'bobby: Is there anything urgent right now, like a safety issue, being locked out of finances, or the home, or a deadline coming up?',
        'Caller: No.',
      ].join('\n'),
    });

    expect(result.ready).toBe(true);
    expect(result.missingRequirements).toEqual([]);
  });

  it('still recognizes a complete divorce path when the transcript includes extra repeated confirmations later in the call', () => {
    const result = validateFlowSummaryReadiness(flow, {
      issue: 'Andy Pham contacted the firm for help with a contested divorce focused on child custody.',
      notes: [
        "bobby: Good afternoon. Thank you for calling test. Shall we get started?",
        'Caller: Yes.',
        'bobby: Have you worked with our firm before? Or is this your first time reaching out to us?',
        'Caller: First time.',
        "bobby: Could I start with your first and last name?",
        'Caller: Andy Pham.',
        "bobby: Is the number you're calling from the best number to reach you if we get disconnected?",
        'Caller: Yeah.',
        'bobby: Are you calling for yourself or on behalf of someone else?',
        'Caller: Myself.',
        'bobby: Can you tell me a little about what has been going on?',
        'Caller: I need help with my divorce.',
        'bobby: Is this an uncontested divorce, a contested divorce, or a legal separation?',
        'Caller: Contested.',
        'bobby: What issues are involved in the divorce? Select the most important.',
        'Caller: Child custody and support.',
        'bobby: Has anything already been filed, and is there any court date or deadline coming up?',
        "Caller: Nothing's filed yet.",
        'bobby: Are there minor children involved in this matter?',
        'Caller: Yes, two children.',
        'bobby: Does your spouse or partner already have a lawyer?',
        'Caller: No.',
        'bobby: Is there anything urgent right now, like a safety issue, being locked out of finances or the home, or a deadline coming up?',
        'Caller: Yes, there is an urgent divorce issue.',
        "bobby: Thank you for explaining that. Just to confirm, the number you're calling from is the best number to reach you. Correct?",
        'Caller: Yeah.',
        "bobby: And just to confirm, you're calling for yourself. Correct?",
        'Caller: Yes.',
      ].join('\n'),
    });

    expect(result.ready).toBe(true);
    expect(result.missingRequirements).toEqual([]);
  });

  it('still blocks an incomplete personal injury path before insurance status is covered', () => {
    const result = validateFlowSummaryReadiness(flow, {
      issue: 'I got in a car accident.',
      notes: 'Personal injury. Car, truck, or motorcycle accident. A week ago. I broke my arm. Yes - still in active treatment.',
    });

    expect(result.ready).toBe(false);
    expect(result.missingRequirements).toContain('Has an insurance claim been filed, or do you have existing legal representation?');
  });
});
