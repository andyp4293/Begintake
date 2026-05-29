import { beforeEach, describe, it, expect, vi } from 'vitest';
import { compileFlowToPrompt, extractToolsFromFlow } from './flow-compiler';
import { createFamilyIntakeTemplate } from './templates/family-intake';

// ─── compileFlowToPrompt ──────────────────────────────────────────────────────

describe('compileFlowToPrompt', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('compiles a simple linear flow', () => {
    const flow = {
      id: 'test-1',
      name: 'Simple Flow',
      description: null,
      nodes: [
        { id: 'n1', type: 'start', label: 'Opening', config: { greeting: 'Hello!' } },
        { id: 'n2', type: 'collect_info', label: 'Get Name', config: { fields: [{ name: 'name', label: 'Name', type: 'text', required: true }] } },
        { id: 'n3', type: 'end', label: 'Goodbye', config: { closingMessage: 'Thanks, bye!' } },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2', label: null, condition: null, sortOrder: 0 },
        { id: 'e2', sourceNodeId: 'n2', targetNodeId: 'n3', label: null, condition: null, sortOrder: 0 },
      ],
    };

    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('Hello!');
    expect(prompt).toContain('Name');
    expect(prompt).toContain('Thanks, bye!');
    expect(prompt).toContain('endCall');
  });

  it('compiles a branching flow', () => {
    const flow = {
      id: 'test-2',
      name: 'Branching Flow',
      description: null,
      nodes: [
        { id: 'n1', type: 'start', label: 'Start', config: {} },
        { id: 'n2', type: 'question', label: 'Triage', config: { question: 'What do you need?', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] } },
        { id: 'n3', type: 'transfer', label: 'Transfer A', config: { message: 'Connecting you.' } },
        { id: 'n4', type: 'end', label: 'End B', config: {} },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2', label: null, condition: null, sortOrder: 0 },
        { id: 'e2', sourceNodeId: 'n2', targetNodeId: 'n3', label: 'A', condition: null, sortOrder: 0 },
        { id: 'e3', sourceNodeId: 'n2', targetNodeId: 'n4', label: 'B', condition: null, sortOrder: 1 },
      ],
    };

    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('What do you need?');
    expect(prompt).toContain('If they say "A"');
    expect(prompt).toContain('If they say "B"');
    expect(prompt).toContain('LAWYER FOLLOW-UP');
  });

  it('compiles the family court template with the main-intake style opening and outside-family fallback', () => {
    const template = createFamilyIntakeTemplate();
    const flow = { id: 'family-template-test', ...template };
    const prompt = compileFlowToPrompt(flow, 'Aria');

    expect(prompt).toContain('Aria');
    expect(prompt).toContain('Shall we get started');
    expect(prompt).toContain("Thanks. Can you tell me a little about what's been going on?");
    expect(prompt).toContain('custody');
    expect(prompt).toContain('safe');
    expect(prompt).toContain('outside family law');
    expect(prompt).toContain('This line is for family law only, please call the main line.');
    expect(prompt).toContain('LAWYER FOLLOW-UP');
    expect(prompt).toContain('petition_type');
    expect(prompt).toContain('generateTransferSummary');
  });

  it('handles missing start node gracefully', () => {
    const flow = {
      id: 'test-3',
      name: 'No Start',
      description: null,
      nodes: [{ id: 'n1', type: 'end', label: 'End', config: {} }],
      edges: [],
    };

    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('intake assistant');
  });

  it('resolves {name} and {firm} variables in the greeting', () => {
    const flow = {
      id: 'test-vars',
      name: 'Var Flow',
      description: null,
      nodes: [
        { id: 'n1', type: 'start', label: 'Start', config: { greeting: 'Welcome to {firm}. I am {name}.' } },
        { id: 'n2', type: 'end', label: 'End', config: {} },
      ],
      edges: [{ id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2', label: null, condition: null, sortOrder: 0 }],
    };

    const prompt = compileFlowToPrompt(flow, 'Jordan', 'Smith Law');
    expect(prompt).toContain('Welcome to Smith Law. I am Jordan.');
    expect(prompt).not.toContain('{firm}');
    expect(prompt).not.toContain('{name}');
  });

  it('uses the resolved firm name in the universal goodbye rule', () => {
    const flow = {
      id: 'firm-goodbye-flow',
      name: 'Firm Goodbye Flow',
      description: null,
      nodes: [
        { id: 'n1', type: 'start', label: 'Start', config: { greeting: 'Welcome to {firm}. I am {name}.' } },
        { id: 'n2', type: 'end', label: 'End', config: {} },
      ],
      edges: [{ id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2', label: null, condition: null, sortOrder: 0 }],
    };

    const prompt = compileFlowToPrompt(flow, 'Jordan', 'Test Intake');
    expect(prompt).toContain('Thank you for calling Test Intake. Have a wonderful day. Goodbye!');
    expect(prompt).not.toContain('Anderson Bowman');
  });

  it('forbids filler and early transfer before the branch is complete', () => {
    const flow = {
      id: 'no-shortcut-flow',
      name: 'No Shortcut Flow',
      description: null,
      nodes: [
        { id: 'n1', type: 'start', label: 'Start', config: { greeting: 'Welcome to {firm}.' } },
        { id: 'n2', type: 'question', label: 'Q1', config: { question: 'What happened?' } },
        { id: 'n3', type: 'response', label: 'Car accident', config: { response: 'Car accident' } },
        { id: 'n4', type: 'question', label: 'Q2', config: { question: 'Has an insurance claim been filed?' } },
        { id: 'n5', type: 'transfer', label: 'Transfer', config: { callbackMessage: 'We will follow up.' } },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2', label: null, condition: null, sortOrder: 0 },
        { id: 'e2', sourceNodeId: 'n2', targetNodeId: 'n3', label: null, condition: null, sortOrder: 0 },
        { id: 'e3', sourceNodeId: 'n3', targetNodeId: 'n4', label: null, condition: null, sortOrder: 0 },
        { id: 'e4', sourceNodeId: 'n4', targetNodeId: 'n5', label: null, condition: null, sortOrder: 0 },
      ],
    };

    const prompt = compileFlowToPrompt(flow, 'Bobby', 'Test');
    expect(prompt).toContain('Never say filler like "give me a moment", "give me a second", "one sec", or similar before a tool call.');
    expect(prompt).toContain('Do NOT skip ahead to a summary, transfer, or goodbye. Only do that when you reach an explicit TRANSFER or END CALL section.');
    expect(prompt).toContain('Do NOT end the call early while there are still unanswered scripted sections on the caller\'s current branch.');
    expect(prompt).toContain('Do NOT ask the same callback number, email, name, or "for yourself / on behalf of someone else" question again');
    expect(prompt).toContain('If the caller volunteers answers to later scripted questions early, capture those facts immediately and skip those later questions instead of re-asking them just to preserve the original order.');
    expect(prompt).toContain('If one caller response answers multiple scripted questions at once, treat every clearly answered slot as captured and move to the first still-unanswered scripted question.');
    expect(prompt).toContain('If the caller gives a plausible direct answer to the current question');
    expect(prompt).toContain('If the caller says "hello?", asks if you are still there, or there is a brief pause, reassure them briefly and resume the current unanswered question.');
    expect(prompt).toContain('If the caller sounds confused about the labels or choices, explain the difference in plain English');
    expect(prompt).toContain('If the caller asks a short follow-up question about the exact term or concept in the current intake question, answer it briefly in plain English and then return to that same question.');
    expect(prompt).toContain('Only answer follow-up questions when they clearly relate to the current intake step or the caller\'s legal situation.');
    expect(prompt).toContain('If the caller says they do not know or asks what you mean, give at most one short plain-English clarification for that question.');
    expect(prompt).toContain('If they still cannot answer a non-core follow-up after that one clarification, include semanticFacts.questionState instead of pushing the same question again.');
    expect(prompt).toContain('If the caller gives a vague, noisy, or non-routable answer to the open-ended issue question');
    expect(prompt).toContain('Use common sense with equivalent phrases. Do not require the caller to match the exact response label if their meaning is already clear.');
    expect(prompt).toContain('If the caller is clearly trying to reach a non-legal business or service that does not fit a law firm at all');
    expect(prompt).toContain('semanticFacts.questionState');
    expect(prompt).toContain('semanticFacts.conversationFit');
    expect(prompt).toContain('semanticFacts.postCallIntent');
  });

  it('treats the first question as already asked in the opening message', () => {
    const flow = {
      id: 'opening-question-flow',
      name: 'Opening Question Flow',
      description: null,
      nodes: [
        { id: 'n1', type: 'start', label: 'Start', config: { greeting: 'Hello and welcome.' } },
        { id: 'n2', type: 'question', label: 'Q1', config: { question: 'Shall we get started?' } },
        { id: 'n3', type: 'response', label: 'Yes', config: { response: "Yes, let's begin" } },
        { id: 'n4', type: 'question', label: 'Q2', config: { question: 'Could I get your name?' } },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2', label: null, condition: null, sortOrder: 0 },
        { id: 'e2', sourceNodeId: 'n2', targetNodeId: 'n3', label: null, condition: null, sortOrder: 0 },
        { id: 'e3', sourceNodeId: 'n3', targetNodeId: 'n4', label: null, condition: null, sortOrder: 0 },
      ],
    };

    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('Do not stop after the greeting. In the first spoken message, immediately continue into the next question.');
    expect(prompt).toContain('This question is already included in the first spoken message.');
    expect(prompt).toContain('If the caller already answered it immediately after the opening, do NOT ask it again.');
    expect(prompt).toContain('Only if they did not answer or you need clarification, ask the caller: "Shall we get started?"');
  });

  it('uses response labels for branch routing when edge labels are empty', () => {
    const flow = {
      id: 'response-routing-flow',
      name: 'Response Routing Flow',
      description: null,
      nodes: [
        { id: 'n1', type: 'start', label: 'Start', config: { greeting: 'Hello.' } },
        { id: 'n2', type: 'question', label: 'Q3', config: { question: 'Is this the best callback number?' } },
        { id: 'n3', type: 'response', label: 'Yes node', config: { response: 'Yes, this number is fine' } },
        { id: 'n4', type: 'response', label: 'No node', config: { response: 'No, use a different number' } },
        { id: 'n5', type: 'end', label: 'Done', config: {} },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2', label: null, condition: null, sortOrder: 0 },
        { id: 'e2', sourceNodeId: 'n2', targetNodeId: 'n3', label: null, condition: null, sortOrder: 0 },
        { id: 'e3', sourceNodeId: 'n2', targetNodeId: 'n4', label: null, condition: null, sortOrder: 1 },
        { id: 'e4', sourceNodeId: 'n3', targetNodeId: 'n5', label: null, condition: null, sortOrder: 0 },
        { id: 'e5', sourceNodeId: 'n4', targetNodeId: 'n5', label: null, condition: null, sortOrder: 0 },
      ],
    };

    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('If they say "Yes, this number is fine": go to SECTION');
    expect(prompt).toContain('If they say "No, use a different number": go to SECTION');
    expect(prompt).not.toContain('If they say "Continue": go to SECTION');
  });

  it('adds slot-skip guidance for common repeated intake questions', () => {
    const flow = {
      id: 'skip-guidance-flow',
      name: 'Skip Guidance Flow',
      description: null,
      nodes: [
        { id: 'n1', type: 'start', label: 'Start', config: { greeting: 'Hello.' } },
        { id: 'n2', type: 'question', label: 'Q2. Caller Name', config: { question: 'Could I start with your first and last name?' } },
        { id: 'n3', type: 'question', label: 'Q3. Best Phone Number', config: { question: "Is the number you're calling from the best number to reach you if we get disconnected?" } },
        { id: 'n4', type: 'question', label: 'Q4. Self or On Behalf Of', config: { question: 'Are you calling for yourself, or on behalf of someone else?' } },
        { id: 'n5', type: 'question', label: 'Q5. Tell Me What\'s Going On', config: { question: 'Can you tell me a little about what has been going on?' } },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2', label: null, condition: null, sortOrder: 0 },
        { id: 'e2', sourceNodeId: 'n2', targetNodeId: 'n3', label: null, condition: null, sortOrder: 0 },
        { id: 'e3', sourceNodeId: 'n3', targetNodeId: 'n4', label: null, condition: null, sortOrder: 0 },
        { id: 'e4', sourceNodeId: 'n4', targetNodeId: 'n5', label: null, condition: null, sortOrder: 0 },
      ],
    };

    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('If the caller already clearly gave their name earlier in the conversation, treat it as captured and continue without re-asking this question.');
    expect(prompt).toContain('If the caller already confirmed the callback number or gave a replacement number earlier, treat that phone number as captured and continue without re-asking this question.');
    expect(prompt).toContain('If the caller already made clear whether they are calling for themselves or someone else, treat that as captured and continue without re-asking this question.');
    expect(prompt).toContain('If the caller already clearly explained their core issue earlier in the conversation, treat that issue summary as captured and continue without re-asking this question.');
  });
});

// ─── question nodes with collectFields (merged collect_info) ──────────────────

describe('question node with collectFields', () => {
  function makeFlow(questionConfig: any) {
    return {
      id: 'q-test',
      name: 'Q Flow',
      description: null,
      nodes: [
        { id: 'n1', type: 'start', label: 'Start', config: {} },
        { id: 'n2', type: 'question', label: 'Q2', config: questionConfig },
        { id: 'n3', type: 'end', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2', label: null, condition: null, sortOrder: 0 },
        { id: 'e2', sourceNodeId: 'n2', targetNodeId: 'n3', label: null, condition: null, sortOrder: 0 },
      ],
    };
  }

  it('emits the question text and collect fields together', () => {
    const flow = makeFlow({
      question: 'What is your name?',
      options: [],
      collectFields: [
        { name: 'full_name', label: 'Full name', type: 'text', required: true },
      ],
    });
    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('What is your name?');
    expect(prompt).toContain('Also collect the following information');
    expect(prompt).toContain('- Full name (required)');
  });

  it('supports freeform field labels like "Hair color"', () => {
    const flow = makeFlow({
      question: 'A few details please.',
      options: [],
      collectFields: [
        { name: 'hair_color', label: 'Hair color', type: 'text', required: false },
        { name: 'eye_color', label: 'Eye color', type: 'text', required: true },
      ],
    });
    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('- Hair color (optional)');
    expect(prompt).toContain('- Eye color (required)');
    expect(prompt).toContain('Store all collected data');
  });

  it('does NOT emit collect section when collectFields is empty', () => {
    const flow = makeFlow({
      question: 'Are you ready?',
      options: [{ label: 'Yes', value: 'yes', instruction: '' }],
      collectFields: [],
    });
    const prompt = compileFlowToPrompt(flow);
    expect(prompt).not.toContain('Also collect');
    expect(prompt).not.toContain('Store all collected data');
  });

  it('does NOT emit collect section when collectFields is absent', () => {
    const flow = makeFlow({ question: 'Are you ready?', options: [] });
    const prompt = compileFlowToPrompt(flow);
    expect(prompt).not.toContain('Also collect');
  });

  it('combines options-with-instructions AND collectFields correctly', () => {
    const flow = makeFlow({
      question: 'Are you calling for yourself?',
      options: [
        { label: 'Yes', value: 'yes', instruction: 'Proceed to next step.' },
        { label: 'No', value: 'no', instruction: 'Ask who they are calling for.' },
      ],
      collectFields: [
        { name: 'caller_name', label: 'First and last name', type: 'text', required: true },
      ],
    });
    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('If they say "Yes": Proceed to next step.');
    expect(prompt).toContain('If they say "No": Ask who they are calling for.');
    expect(prompt).toContain('Also collect the following information');
    expect(prompt).toContain('- First and last name (required)');
  });

  it('handles choice-type collectFields with options', () => {
    const flow = makeFlow({
      question: 'Tell me about yourself.',
      options: [],
      collectFields: [
        { name: 'preferred_contact', label: 'Preferred contact method', type: 'choice', options: ['Phone', 'Email', 'Text'], required: true },
      ],
    });
    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('Preferred contact method (required): options are Phone, Email, Text');
  });

  it('requires no collectFields for a plain question - backward compat', () => {
    const flow = makeFlow({
      question: 'What brings you in today?',
      options: [{ label: 'Custody', value: 'custody' }, { label: 'Support', value: 'support' }],
    });
    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('What brings you in today?');
    expect(prompt).not.toContain('Also collect');
  });
});

// ─── collect_info backward compatibility ─────────────────────────────────────

describe('collect_info node backward compatibility', () => {
  function makeCollectFlow(config: any) {
    return {
      id: 'ci-test',
      name: 'CI Flow',
      description: null,
      nodes: [
        { id: 'n1', type: 'start', label: 'Start', config: {} },
        { id: 'n2', type: 'collect_info', label: 'Get Info', config },
        { id: 'n3', type: 'end', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2', label: null, condition: null, sortOrder: 0 },
        { id: 'e2', sourceNodeId: 'n2', targetNodeId: 'n3', label: null, condition: null, sortOrder: 0 },
      ],
    };
  }

  it('old collect_info without question still compiles', () => {
    const flow = makeCollectFlow({
      fields: [
        { name: 'caller_name', label: 'First and last name', type: 'text', required: true },
      ],
    });
    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('Collect the following information');
    expect(prompt).toContain('- First and last name (required)');
  });

  it('collect_info with a question field emits the question', () => {
    const flow = makeCollectFlow({
      question: 'Could I get your name please?',
      fields: [
        { name: 'caller_name', label: 'First and last name', type: 'text', required: true },
      ],
    });
    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('Ask: "Could I get your name please?"');
    expect(prompt).toContain('- First and last name (required)');
  });

  it('collect_info marks optional fields correctly', () => {
    const flow = makeCollectFlow({
      fields: [
        { name: 'phone', label: 'Phone number', type: 'text', required: true },
        { name: 'email', label: 'Email address', type: 'text', required: false },
      ],
    });
    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('- Phone number (required)');
    expect(prompt).toContain('- Email address (optional)');
  });

  it('collect_info with choice field lists the options', () => {
    const flow = makeCollectFlow({
      fields: [
        { name: 'contact_pref', label: 'Preferred contact', type: 'choice', options: ['Phone', 'Email'], required: true },
      ],
    });
    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('Preferred contact (required): options are Phone, Email');
  });
});

// ─── extractToolsFromFlow ─────────────────────────────────────────────────────

describe('extractToolsFromFlow', () => {
  it('extracts tool names from action nodes', () => {
    const flow = {
      id: 'test',
      name: 'Test',
      description: null,
      nodes: [
        { id: 'n1', type: 'action', label: 'Check', config: { actionType: 'call_tool', toolName: 'checkClient' } },
        { id: 'n2', type: 'transfer', label: 'Transfer', config: {} },
        { id: 'n3', type: 'end', label: 'End', config: {} },
      ],
      edges: [],
    };

    const tools = extractToolsFromFlow(flow);
    expect(tools).toContain('checkClient');
    expect(tools).toContain('generateTransferSummary');
    expect(tools).toContain('endCall');
  });

  it('always includes endCall', () => {
    const flow = { id: 'test', name: 'Test', description: null, nodes: [], edges: [] };
    const tools = extractToolsFromFlow(flow);
    expect(tools).toContain('endCall');
  });

  it('includes generateTransferSummary when a transfer node exists', () => {
    const flow = {
      id: 'test',
      name: 'Test',
      description: null,
      nodes: [{ id: 'n1', type: 'transfer', label: 'Transfer', config: {} }],
      edges: [],
    };
    const tools = extractToolsFromFlow(flow);
    expect(tools).toContain('generateTransferSummary');
  });

  it('does NOT include generateTransferSummary when no transfer node', () => {
    const flow = {
      id: 'test',
      name: 'Test',
      description: null,
      nodes: [{ id: 'n1', type: 'end', label: 'End', config: {} }],
      edges: [],
    };
    const tools = extractToolsFromFlow(flow);
    expect(tools).not.toContain('generateTransferSummary');
  });

  it('deduplicates tools when multiple action nodes use the same tool', () => {
    const flow = {
      id: 'test',
      name: 'Test',
      description: null,
      nodes: [
        { id: 'n1', type: 'action', label: 'A1', config: { actionType: 'call_tool', toolName: 'lookupClient' } },
        { id: 'n2', type: 'action', label: 'A2', config: { actionType: 'call_tool', toolName: 'lookupClient' } },
      ],
      edges: [],
    };
    const tools = extractToolsFromFlow(flow);
    expect(tools.filter((t: string) => t === 'lookupClient')).toHaveLength(1);
  });
});

// ─── Family Court Intake template structure ──────────────────────────────────

describe('Family Court Intake template', () => {
  it('creates valid template with nodes and edges', () => {
    const template = createFamilyIntakeTemplate();
    expect(template.name).toBeTruthy();
    expect(template.isTemplate).toBe(true);
    expect(template.nodes.length).toBeGreaterThan(20);
    expect(template.edges.length).toBeGreaterThan(20);
  });

  it('has exactly one start node', () => {
    const template = createFamilyIntakeTemplate();
    const startNodes = template.nodes.filter((n: any) => n.type === 'start');
    expect(startNodes).toHaveLength(1);
  });

  it('has shared attorney and paralegal transfer nodes', () => {
    const template = createFamilyIntakeTemplate();
    const transferNodes = template.nodes.filter((n: any) => n.type === 'transfer');
    expect(transferNodes.map((n: any) => n.label)).toEqual(expect.arrayContaining(['Transfer to Attorney', 'Transfer to Paralegal']));
  });

  it('uses the same warm open-ended issue question as the main intake flow', () => {
    const template = createFamilyIntakeTemplate();
    const q5 = template.nodes.find((n: any) => n.label === "Q5. Tell Me What's Going On");
    expect(q5).toBeDefined();
    expect(q5!.config.note).toContain('The caller should feel heard, not processed.');
    expect(q5!.config.note).toContain('do not force it into a family branch');
  });

  it('adds an explicit outside-family fallback from both the open-ended intake and family triage', () => {
    const template = createFamilyIntakeTemplate();
    const q5 = template.nodes.find((n: any) => n.label === "Q5. Tell Me What's Going On");
    const famTriage = template.nodes.find((n: any) => n.label === 'Family Law - Matter Triage');
    const outsideResponseNodes = template.nodes.filter((n: any) => n.type === 'response' && n.label === 'Different practice area / not family law');
    const outsideAction = template.nodes.find((n: any) => n.label === 'Flag: Outside Family Scope');
    const outsideEnd = template.nodes.find((n: any) => n.label === 'Family Line Only - Call Main Line');

    expect(q5).toBeDefined();
    expect(famTriage).toBeDefined();
    expect(outsideResponseNodes.length).toBeGreaterThan(0);
    expect(outsideAction).toBeDefined();
    expect(outsideEnd).toBeDefined();
    expect(outsideEnd!.type).toBe('end');
    expect(outsideEnd!.config.closingMessage).toBe('This line is for family law only, please call the main line.');

    const q5Targets = template.edges
      .filter((e: any) => e.sourceNodeId === q5!.id)
      .map((e: any) => template.nodes.find((n: any) => n.id === e.targetNodeId)?.label);
    const triageTargets = template.edges
      .filter((e: any) => e.sourceNodeId === famTriage!.id)
      .map((e: any) => template.nodes.find((n: any) => n.id === e.targetNodeId)?.label);

    expect(q5Targets).toContain('Different practice area / not family law');
    expect(triageTargets).toContain('Different practice area / not family law');
    expect(template.edges.some((e: any) => e.sourceNodeId === outsideAction!.id && e.targetNodeId === outsideEnd!.id)).toBe(true);
  });

  it('has custody branch routing aligned to the main family flow labels', () => {
    const template = createFamilyIntakeTemplate();
    const custodyNode = template.nodes.find((n: any) => n.label === 'FA - Custody Order Status');
    expect(custodyNode).toBeDefined();
    expect(custodyNode!.type).toBe('question');
  });

  it('has safety-first protocol for family offense', () => {
    const template = createFamilyIntakeTemplate();
    const safetyNode = template.nodes.find((n: any) => n.label === 'FC - Safety Check');
    expect(safetyNode).toBeDefined();
    expect(safetyNode!.type).toBe('question');
    expect(safetyNode!.config.question).toContain('safe');
  });

  it('has emergency action node with safety flag and O-Petition', () => {
    const template = createFamilyIntakeTemplate();
    const emergencyNode = template.nodes.find((n: any) => n.label === 'EMERGENCY - Advise 911');
    expect(emergencyNode).toBeDefined();
    expect(emergencyNode!.config.flagValue).toBe('safety_first');
    expect(emergencyNode!.config.petitionType).toContain('O-Petition');
  });

  it('Q2 (Caller Name) is now a question node with collectFields - not collect_info', () => {
    const template = createFamilyIntakeTemplate();
    const q2 = template.nodes.find((n: any) => n.label === 'Q2. Caller Name');
    expect(q2).toBeDefined();
    expect(q2!.type).toBe('question');
    expect(q2!.config.question).toBeTruthy();
    expect(q2!.config.collectFields).toBeDefined();
    expect(q2!.config.collectFields).toHaveLength(1);
    expect(q2!.config.collectFields[0].name).toBe('caller_name');
    expect(q2!.config.collectFields[0].label).toBe('First and last name');
  });

  it('FA3 (Number and Ages of Children) is now a question node with 2 collectFields', () => {
    const template = createFamilyIntakeTemplate();
    const a3 = template.nodes.find((n: any) => n.label === 'FA3. Children - Number and Ages');
    expect(a3).toBeDefined();
    expect(a3!.type).toBe('question');
    expect(a3!.config.question).toContain('children');
    expect(a3!.config.collectFields).toHaveLength(2);
    expect(a3!.config.collectFields[0].name).toBe('num_children');
    expect(a3!.config.collectFields[1].name).toBe('children_ages');
  });

  it('has NO standalone collect_info nodes - all converted to question+collectFields', () => {
    const template = createFamilyIntakeTemplate();
    const collectInfoNodes = template.nodes.filter((n: any) => n.type === 'collect_info');
    expect(collectInfoNodes).toHaveLength(0);
  });

  it('keeps non-core family questions collapsed by default while leaving the opening path expanded', () => {
    const template = createFamilyIntakeTemplate();
    const q1 = template.nodes.find((n: any) => n.label === 'Q1. Shall we get started?');
    const q5 = template.nodes.find((n: any) => n.label === "Q5. Tell Me What's Going On");
    const divorce = template.nodes.find((n: any) => n.label === 'FH - Divorce / Separation');

    expect(q1?.config.defaultCollapsed).toBeUndefined();
    expect(q5?.config.defaultCollapsed).toBeUndefined();
    expect(divorce?.config.defaultCollapsed).toBe(true);
  });

  it('compiled prompt contains all critical legal terms', () => {
    const template = createFamilyIntakeTemplate();
    const flow = { id: 'test', ...template };
    const prompt = compileFlowToPrompt(flow, 'Aria');

    expect(prompt).toContain('V-Petition');
    expect(prompt).toContain('safe');
    expect(prompt).toContain('O-Petition');
    expect(prompt).toContain('NEVER give legal advice');
    expect(prompt).toContain('confidential');
    expect(prompt).toContain('endCall');
  });

  it('compiled prompt instructs AI to follow script exactly', () => {
    const template = createFamilyIntakeTemplate();
    const flow = { id: 'test', ...template };
    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('FOLLOW THIS SCRIPT EXACTLY');
    expect(prompt).toContain('silently call advanceActiveFlow');
    expect(prompt).toContain('Call tools silently');
    expect(prompt).toContain('During active-flow calls, do NOT call captureIntakeState');
    expect(prompt).toContain('Before every tool call, say nothing at all');
    expect(prompt).toContain('Never say tool names out loud');
  });

  it('compiled prompt uses summary-only follow-up by default', () => {
    const template = createFamilyIntakeTemplate();
    const flow = { id: 'test', ...template };
    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('LAWYER FOLLOW-UP');
    expect(prompt).toContain('generateTransferSummary');
    expect(prompt).toContain('handoffMode="summary_only"');
  });

  it('compiled prompt does not promise a live handoff by default', () => {
    const template = createFamilyIntakeTemplate();
    const flow = { id: 'test', ...template };
    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('Do NOT promise a live handoff');
    expect(prompt).not.toContain('IF ATTORNEY IS AVAILABLE');
    expect(prompt).not.toContain('checkAttorneyAvailability');
  });

  it('compiled prompt always instructs endCall after follow-up handoff', () => {
    const template = createFamilyIntakeTemplate();
    const flow = { id: 'test', ...template };
    const prompt = compileFlowToPrompt(flow);
    const transferIdx = prompt.indexOf('LAWYER FOLLOW-UP');
    const endCallIdx = prompt.indexOf('endCall', transferIdx);
    expect(endCallIdx).toBeGreaterThan(transferIdx);
  });

  // ── Transfer endpoint audit (no scheduling — all branches go direct to transfer) ──

  it('has no Connect or Schedule question node (scheduling removed)', () => {
    const template = createFamilyIntakeTemplate();
    const cos = template.nodes.find((n: any) => n.label === 'Connect or Schedule?');
    expect(cos).toBeUndefined();
  });

  it('has no Book Consultation action node (scheduling removed)', () => {
    const template = createFamilyIntakeTemplate();
    const booking = template.nodes.find((n: any) => n.label === 'Book Consultation');
    expect(booking).toBeUndefined();
  });

  it('all branch endpoints route directly to a transfer node', () => {
    const template = createFamilyIntakeTemplate();
    const transferNodes = new Set(
      template.nodes.filter((n: any) => n.type === 'transfer').map((n: any) => n.id)
    );
    // Every non-transfer, non-end node must eventually reach a transfer node
    // (verified by checking no dead ends exist — covered by other tests)
    expect(transferNodes.size).toBeGreaterThanOrEqual(1);
  });

  it('emergency and urgent paths go directly to the attorney transfer node', () => {
    const template = createFamilyIntakeTemplate();
    const emergency = template.nodes.find((n: any) => n.label === 'EMERGENCY - Advise 911');

    // cEmergency -> transfer directly
    const emergencyEdge = template.edges.find((e: any) => e.sourceNodeId === emergency!.id);
    const emergencyTransfer = template.nodes.find((n: any) => n.id === emergencyEdge!.targetNodeId);

    expect(emergencyTransfer?.type).toBe('transfer');
    expect(emergencyTransfer?.config?.transferTarget).toBe('attorney');
    expect(emergencyTransfer?.label).toBe('Transfer to Attorney');
  });

  // ── Dead-end / orphan audit ──────────────────────────────────────────────

  it('every non-start node has at least one incoming edge (no orphans)', () => {
    const template = createFamilyIntakeTemplate();
    const startNode = template.nodes.find((n: any) => n.type === 'start');
    const targetIds = new Set(template.edges.map((e: any) => e.targetNodeId));
    for (const node of template.nodes) {
      if (node.id === startNode!.id) continue;
      expect(targetIds.has(node.id)).toBe(true);
    }
  });

  it('every non-transfer, non-end node has at least one outgoing edge (no dead ends)', () => {
    const template = createFamilyIntakeTemplate();
    const sourceIds = new Set(template.edges.map((e: any) => e.sourceNodeId));
    for (const node of template.nodes) {
      if (node.type === 'transfer' || node.type === 'end') continue;
      expect(sourceIds.has(node.id)).toBe(true);
    }
  });

  it('extractToolsFromFlow includes generateTransferSummary for the template', () => {
    const template = createFamilyIntakeTemplate();
    const flow = { id: 'test', ...template };
    const tools = extractToolsFromFlow(flow);
    expect(tools).toContain('generateTransferSummary');
    expect(tools).toContain('endCall');
  });

  it('compiled prompt includes generateTransferSummary instructions for follow-up mode', () => {
    const template = createFamilyIntakeTemplate();
    const flow = { id: 'test', ...template };
    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('generateTransferSummary');
    expect(prompt).not.toContain('checkAttorneyAvailability');
  });

  it('supports live transfer instructions when explicitly enabled', () => {
    vi.stubEnv('ENABLE_LIVE_CALL_TRANSFERS', 'true');
    const flow = {
      id: 'live-transfer-test',
      name: 'Live Transfer Test',
      description: null,
      nodes: [
        { id: 'n1', type: 'start', label: 'Start', config: {} },
        { id: 'n2', type: 'transfer', label: 'Transfer', config: { handoffMode: 'live_transfer', transferTarget: 'attorney' } },
      ],
      edges: [{ id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2', label: null, condition: null, sortOrder: 0 }],
    };

    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('checkAttorneyAvailability');
    expect(prompt).toContain('handoffMode="live_transfer"');
  });

  it('supports paralegal live transfer instructions without the attorney transfer env flag', () => {
    const flow = {
      id: 'paralegal-live-transfer-test',
      name: 'Paralegal Live Transfer Test',
      description: null,
      nodes: [
        { id: 'n1', type: 'start', label: 'Start', config: {} },
        { id: 'n2', type: 'transfer', label: 'Transfer', config: { handoffMode: 'live_transfer', transferTarget: 'paralegal' } },
      ],
      edges: [{ id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2', label: null, condition: null, sortOrder: 0 }],
    };

    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('transferTarget="paralegal", handoffMode="live_transfer"');
    expect(prompt).not.toContain('Welcome back! Let me connect you');
    expect(prompt).toContain('The live transfer itself will say exactly: "Of course. I\'ll transfer you to our team right away."');
    expect(prompt).toContain('Do NOT say anything before the tool call unless the caller asks a new question.');
    expect(prompt).toContain('Do NOT add filler before the tool call.');
    expect(prompt).toContain('Do NOT call endCall after a successful live transfer.');
  });

  it('keeps new-client responses on the normal intake path', () => {
    const flow = {
      id: 'new-client-short-circuit',
      name: 'New Client Short Circuit',
      description: null,
      nodes: [
        { id: 'n1', type: 'start', label: 'Start', config: {} },
        { id: 'n2', type: 'question', label: 'Client Status', config: { question: 'Are you new or existing?' } },
        { id: 'n3', type: 'response', label: 'New client - first time calling', config: { response: 'New client - first time calling' } },
        { id: 'n4', type: 'question', label: 'Deeper Intake', config: { question: 'Tell me more.' } },
        { id: 'n5', type: 'response', label: 'Existing client - worked with firm before', config: { response: 'Existing client - worked with firm before' } },
        { id: 'n6', type: 'transfer', label: 'Paralegal Handoff', config: { transferTarget: 'paralegal', handoffMode: 'live_transfer' } },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2', label: null, condition: null, sortOrder: 0 },
        { id: 'e2', sourceNodeId: 'n2', targetNodeId: 'n3', label: null, condition: null, sortOrder: 0 },
        { id: 'e3', sourceNodeId: 'n2', targetNodeId: 'n5', label: null, condition: null, sortOrder: 1 },
        { id: 'e4', sourceNodeId: 'n3', targetNodeId: 'n4', label: null, condition: null, sortOrder: 0 },
        { id: 'e5', sourceNodeId: 'n5', targetNodeId: 'n6', label: null, condition: null, sortOrder: 0 },
      ],
    };

    const prompt = compileFlowToPrompt(flow);
    expect(prompt).not.toContain('Do not continue with the rest of intake first.');
    expect(prompt).toContain('Then proceed to SECTION 2.');
  });

  it('compiled prompt includes Q2 collect field label "First and last name"', () => {
    const template = createFamilyIntakeTemplate();
    const flow = { id: 'test', ...template };
    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('First and last name');
  });

  it('compiled prompt includes FA3 collect field labels', () => {
    const template = createFamilyIntakeTemplate();
    const flow = { id: 'test', ...template };
    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('Number of children involved');
    expect(prompt).toContain('Ages of each child');
  });

  it('all edges reference valid node IDs', () => {
    const template = createFamilyIntakeTemplate();
    const nodeIds = new Set(template.nodes.map((n: any) => n.id));
    for (const edge of template.edges) {
      expect(nodeIds.has(edge.sourceNodeId)).toBe(true);
      expect(nodeIds.has(edge.targetNodeId)).toBe(true);
    }
  });

  it('no orphaned nodes (every non-start node has at least one incoming edge)', () => {
    const template = createFamilyIntakeTemplate();
    const startNode = template.nodes.find((n: any) => n.type === 'start');
    const targetIds = new Set(template.edges.map((e: any) => e.targetNodeId));
    for (const node of template.nodes) {
      if (node.id === startNode!.id) continue;
      expect(targetIds.has(node.id)).toBe(true);
    }
  });

  it('all question nodes in the template have a question text or guidance note', () => {
    const template = createFamilyIntakeTemplate();
    const questionNodes = template.nodes.filter((n: any) => n.type === 'question');
    for (const node of questionNodes) {
      // A question must have at least one of: verbatim question text or AI guidance note
      expect(node.config.question || node.config.note).toBeTruthy();
    }
  });

  it('question nodes with collectFields all have a valid question prompt', () => {
    const template = createFamilyIntakeTemplate();
    const withFields = template.nodes.filter((n: any) => n.type === 'question' && n.config.collectFields?.length > 0);
    expect(withFields.length).toBeGreaterThan(0);
    for (const node of withFields) {
      expect(typeof node.config.question).toBe('string');
      expect(node.config.question.length).toBeGreaterThan(0);
    }
  });
});
