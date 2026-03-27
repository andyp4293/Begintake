import { describe, it, expect } from 'vitest';
import { compileFlowToPrompt, extractToolsFromFlow } from './flow-compiler';
import { createFamilyIntakeTemplate as createAndersonBowmanTemplate } from './templates/family-intake';

// ─── compileFlowToPrompt ──────────────────────────────────────────────────────

describe('compileFlowToPrompt', () => {
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
    expect(prompt).toContain('TRANSFER TO ATTORNEY');
  });

  it('compiles the Anderson Bowman template', () => {
    const template = createAndersonBowmanTemplate();
    const flow = { id: 'ab-test', ...template };
    const prompt = compileFlowToPrompt(flow, 'Aria');

    expect(prompt).toContain('Aria');
    expect(prompt).toContain('Shall we get started');
    expect(prompt).toContain('What brings you to the firm today');
    expect(prompt).toContain('custody');
    expect(prompt).toContain('safe');
    expect(prompt).toContain('TRANSFER TO ATTORNEY');
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

// ─── Anderson Bowman template structure ──────────────────────────────────────

describe('Anderson Bowman template', () => {
  it('creates valid template with nodes and edges', () => {
    const template = createAndersonBowmanTemplate();
    expect(template.name).toBeTruthy(); // "Family Court Intake Example"
    expect(template.isTemplate).toBe(true);
    expect(template.nodes.length).toBeGreaterThan(20);
    expect(template.edges.length).toBeGreaterThan(20);
  });

  it('has exactly one start node', () => {
    const template = createAndersonBowmanTemplate();
    const startNodes = template.nodes.filter((n: any) => n.type === 'start');
    expect(startNodes).toHaveLength(1);
  });

  it('has at least one transfer node', () => {
    const template = createAndersonBowmanTemplate();
    const transferNodes = template.nodes.filter((n: any) => n.type === 'transfer');
    expect(transferNodes.length).toBeGreaterThan(0);
  });

  it('has the 8 triage branches from Q5', () => {
    const template = createAndersonBowmanTemplate();
    const triageNode = template.nodes.find((n: any) => n.label === 'Q5. What brings you to the firm today?');
    expect(triageNode).toBeDefined();
    const triageEdges = template.edges.filter((e: any) => e.sourceNodeId === triageNode!.id);
    expect(triageEdges.length).toBe(8);
  });

  it('has custody branch (Branch A) as a decision node', () => {
    const template = createAndersonBowmanTemplate();
    const custodyNode = template.nodes.find((n: any) => n.label === 'Branch A - Custody Order Status');
    expect(custodyNode).toBeDefined();
    expect(['question', 'decision']).toContain(custodyNode!.type);
  });

  it('has safety-first protocol for family offense (Branch C)', () => {
    const template = createAndersonBowmanTemplate();
    const safetyNode = template.nodes.find((n: any) => n.label === 'Branch C - Safety Check');
    expect(safetyNode).toBeDefined();
    expect(safetyNode!.type).toBe('question');
    expect(safetyNode!.config.question).toContain('safe');
  });

  it('has emergency action node with safety flag and O-Petition', () => {
    const template = createAndersonBowmanTemplate();
    const emergencyNode = template.nodes.find((n: any) => n.label === 'EMERGENCY - Advise 911');
    expect(emergencyNode).toBeDefined();
    expect(emergencyNode!.config.flagValue).toBe('safety_first');
    expect(emergencyNode!.config.petitionType).toContain('O-Petition');
  });

  it('Q2 (Caller Name) is now a question node with collectFields - not collect_info', () => {
    const template = createAndersonBowmanTemplate();
    const q2 = template.nodes.find((n: any) => n.label === 'Q2. Caller Name');
    expect(q2).toBeDefined();
    expect(q2!.type).toBe('question');
    expect(q2!.config.question).toBeTruthy();
    expect(q2!.config.collectFields).toBeDefined();
    expect(q2!.config.collectFields).toHaveLength(1);
    expect(q2!.config.collectFields[0].name).toBe('caller_name');
    expect(q2!.config.collectFields[0].label).toBe('First and last name');
  });

  it('A3 (Number and Ages of Children) is now a question node with 2 collectFields', () => {
    const template = createAndersonBowmanTemplate();
    const a3 = template.nodes.find((n: any) => n.label === 'A3. Number and Ages of Children');
    expect(a3).toBeDefined();
    expect(a3!.type).toBe('question');
    expect(a3!.config.question).toContain('children');
    expect(a3!.config.collectFields).toHaveLength(2);
    expect(a3!.config.collectFields[0].name).toBe('num_children');
    expect(a3!.config.collectFields[1].name).toBe('children_ages');
  });

  it('has NO standalone collect_info nodes - all converted to question+collectFields', () => {
    const template = createAndersonBowmanTemplate();
    const collectInfoNodes = template.nodes.filter((n: any) => n.type === 'collect_info');
    expect(collectInfoNodes).toHaveLength(0);
  });

  it('compiled prompt contains all critical legal terms', () => {
    const template = createAndersonBowmanTemplate();
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
    const template = createAndersonBowmanTemplate();
    const flow = { id: 'test', ...template };
    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('FOLLOW THIS SCRIPT EXACTLY');
  });

  it('compiled prompt includes transfer protocol with generateTransferSummary', () => {
    const template = createAndersonBowmanTemplate();
    const flow = { id: 'test', ...template };
    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('TRANSFER TO ATTORNEY');
    expect(prompt).toContain('Caller name');
    expect(prompt).toContain('generateTransferSummary');
  });

  // ── Connect or Schedule audit ────────────────────────────────────────────

  it('has a Connect or Schedule question node', () => {
    const template = createAndersonBowmanTemplate();
    const node = template.nodes.find((n: any) => n.label === 'Connect or Schedule?');
    expect(node).toBeDefined();
    expect(node!.type).toBe('question');
    // Options are now separate Response child nodes, not a config.options array
    const outEdges = template.edges.filter((e: any) => e.sourceNodeId === node!.id);
    expect(outEdges).toHaveLength(2);
    const responseNodes = outEdges.map((e: any) =>
      template.nodes.find((n: any) => n.id === e.targetNodeId)
    );
    expect(responseNodes.every((n: any) => n.type === 'response')).toBe(true);
    // Responses use intent-based labels, not verbatim phrases
    expect(responseNodes.some((n: any) => n.config?.response?.toLowerCase().includes('now') || n.config?.response?.toLowerCase().includes('connect'))).toBe(true);
    expect(responseNodes.some((n: any) => n.config?.response?.toLowerCase().includes('schedule') || n.config?.response?.toLowerCase().includes('later') || n.config?.response?.toLowerCase().includes('book'))).toBe(true);
  });

  it('Connect or Schedule routes to both transfer and appointment booking', () => {
    const template = createAndersonBowmanTemplate();
    const cos = template.nodes.find((n: any) => n.label === 'Connect or Schedule?');
    const transfer = template.nodes.find((n: any) => n.type === 'transfer');
    const booking = template.nodes.find((n: any) => n.label === 'Book Consultation');
    expect(cos).toBeDefined();
    // cos -> Response nodes (cos_now, cos_schedule)
    const outEdges = template.edges.filter((e: any) => e.sourceNodeId === cos!.id);
    expect(outEdges).toHaveLength(2);
    const responseIds = outEdges.map((e: any) => e.targetNodeId);
    // Each Response node leads to transfer or booking
    const secondHopTargets = responseIds.flatMap((rid: string) =>
      template.edges.filter((e: any) => e.sourceNodeId === rid).map((e: any) => e.targetNodeId)
    );
    expect(secondHopTargets).toContain(transfer!.id);
    expect(secondHopTargets).toContain(booking!.id);
  });

  it('has a Book Consultation action node with book_appointment type', () => {
    const template = createAndersonBowmanTemplate();
    const node = template.nodes.find((n: any) => n.label === 'Book Consultation');
    expect(node).toBeDefined();
    expect(node!.type).toBe('action');
    expect(node!.config.actionType).toBe('book_appointment');
  });

  it('booking path leads to Anything Else then End - After Scheduling', () => {
    const template = createAndersonBowmanTemplate();
    const booking = template.nodes.find((n: any) => n.label === 'Book Consultation');
    const nothingElse = template.nodes.find((n: any) => n.label === 'Anything Else?');
    const endNode = template.nodes.find((n: any) => n.label === 'End - After Scheduling');
    expect(booking).toBeDefined();
    expect(nothingElse).toBeDefined();
    expect(endNode).toBeDefined();
    expect(endNode!.type).toBe('end');

    // booking -> nothingElse
    const bookingEdge = template.edges.find((e: any) => e.sourceNodeId === booking!.id);
    expect(bookingEdge!.targetNodeId).toBe(nothingElse!.id);

    // nothingElse -> Response nodes -> end (both answer paths go through Response nodes)
    const nothingElseEdges = template.edges.filter((e: any) => e.sourceNodeId === nothingElse!.id);
    expect(nothingElseEdges.length).toBeGreaterThanOrEqual(1);
    // Each edge from nothingElse targets a Response node, which then targets endNode
    nothingElseEdges.forEach((e: any) => {
      const responseNode = template.nodes.find((n: any) => n.id === e.targetNodeId);
      if (responseNode && responseNode.type === 'response') {
        const hopEdge = template.edges.find((he: any) => he.sourceNodeId === responseNode.id);
        expect(hopEdge!.targetNodeId).toBe(endNode!.id);
      } else {
        expect(e.targetNodeId).toBe(endNode!.id);
      }
    });
  });

  it('emergency paths bypass scheduling and go directly to transfer', () => {
    const template = createAndersonBowmanTemplate();
    const emergency = template.nodes.find((n: any) => n.label === 'EMERGENCY - Advise 911');
    const a4 = template.nodes.find((n: any) => n.label === 'A4. Urgency / Safety Screen');
    const transfer = template.nodes.find((n: any) => n.type === 'transfer');
    const cos = template.nodes.find((n: any) => n.label === 'Connect or Schedule?');

    // cEmergency -> transfer directly
    const emergencyEdge = template.edges.find((e: any) => e.sourceNodeId === emergency!.id);
    expect(emergencyEdge!.targetNodeId).toBe(transfer!.id);

    // a4 -> Response nodes; urgent Response -> transfer, routine Response -> cos
    const a4OutEdges = template.edges.filter((e: any) => e.sourceNodeId === a4!.id);
    const a4ResponseNodes = a4OutEdges.map((e: any) =>
      template.nodes.find((n: any) => n.id === e.targetNodeId)
    );

    // Find the urgent Response node (the one whose next hop is transfer)
    const urgentResponse = a4ResponseNodes.find((n: any) => {
      const hop = template.edges.find((e: any) => e.sourceNodeId === n.id);
      return hop && hop.targetNodeId === transfer!.id;
    });
    expect(urgentResponse).toBeDefined();

    // Find the routine Response node (the one whose next hop is cos)
    const routineResponse = a4ResponseNodes.find((n: any) => {
      const hop = template.edges.find((e: any) => e.sourceNodeId === n.id);
      return hop && hop.targetNodeId === cos!.id;
    });
    expect(routineResponse).toBeDefined();
  });

  it('no non-emergency branch endpoints connect directly to transfer (all go via Connect or Schedule)', () => {
    const template = createAndersonBowmanTemplate();
    const transfer = template.nodes.find((n: any) => n.type === 'transfer');
    const emergency = template.nodes.find((n: any) => n.label === 'EMERGENCY - Advise 911');
    const a4 = template.nodes.find((n: any) => n.label === 'A4. Urgency / Safety Screen');
    const cos = template.nodes.find((n: any) => n.label === 'Connect or Schedule?');

    // In the new Response-node pattern, edges to transfer can come from:
    // 1. cEmergency (emergency action node) - direct bypass
    // 2. a4_urgent (Response child of a4) - urgent bypass
    // 3. cos_now (Response child of cos) - the "Connect me now" path

    // Get Response children of a4 and cos
    const a4ResponseIds = new Set(
      template.edges
        .filter((e: any) => e.sourceNodeId === a4!.id)
        .map((e: any) => e.targetNodeId)
    );
    const cosResponseIds = new Set(
      template.edges
        .filter((e: any) => e.sourceNodeId === cos!.id)
        .map((e: any) => e.targetNodeId)
    );

    const allowedDirectToTransfer = new Set([
      emergency!.id,
      ...Array.from(a4ResponseIds),
      ...Array.from(cosResponseIds),
    ]);

    const directToTransfer = template.edges.filter(
      (e: any) => e.targetNodeId === transfer!.id && !allowedDirectToTransfer.has(e.sourceNodeId)
    );
    // No other node should connect directly to transfer
    expect(directToTransfer).toHaveLength(0);
  });

  // ── Dead-end / orphan audit ──────────────────────────────────────────────

  it('every non-start node has at least one incoming edge (no orphans)', () => {
    const template = createAndersonBowmanTemplate();
    const startNode = template.nodes.find((n: any) => n.type === 'start');
    const targetIds = new Set(template.edges.map((e: any) => e.targetNodeId));
    for (const node of template.nodes) {
      if (node.id === startNode!.id) continue;
      expect(targetIds.has(node.id)).toBe(true);
    }
  });

  it('every non-transfer, non-end node has at least one outgoing edge (no dead ends)', () => {
    const template = createAndersonBowmanTemplate();
    const sourceIds = new Set(template.edges.map((e: any) => e.sourceNodeId));
    for (const node of template.nodes) {
      if (node.type === 'transfer' || node.type === 'end') continue;
      expect(sourceIds.has(node.id)).toBe(true);
    }
  });

  it('extractToolsFromFlow includes bookAppointment for the template', () => {
    const template = createAndersonBowmanTemplate();
    const flow = { id: 'test', ...template };
    const tools = extractToolsFromFlow(flow);
    expect(tools).toContain('bookAppointment');
    expect(tools).toContain('generateTransferSummary');
    expect(tools).toContain('endCall');
  });

  it('compiled prompt includes bookAppointment tool instruction', () => {
    const template = createAndersonBowmanTemplate();
    const flow = { id: 'test', ...template };
    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('bookAppointment');
    expect(prompt).toContain('schedule a consultation');
  });

  it('compiled prompt includes Q2 collect field label "First and last name"', () => {
    const template = createAndersonBowmanTemplate();
    const flow = { id: 'test', ...template };
    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('First and last name');
  });

  it('compiled prompt includes A3 collect field labels', () => {
    const template = createAndersonBowmanTemplate();
    const flow = { id: 'test', ...template };
    const prompt = compileFlowToPrompt(flow);
    expect(prompt).toContain('How many children are involved');
    expect(prompt).toContain('Ages of each child');
  });

  it('all edges reference valid node IDs', () => {
    const template = createAndersonBowmanTemplate();
    const nodeIds = new Set(template.nodes.map((n: any) => n.id));
    for (const edge of template.edges) {
      expect(nodeIds.has(edge.sourceNodeId)).toBe(true);
      expect(nodeIds.has(edge.targetNodeId)).toBe(true);
    }
  });

  it('no orphaned nodes (every non-start node has at least one incoming edge)', () => {
    const template = createAndersonBowmanTemplate();
    const startNode = template.nodes.find((n: any) => n.type === 'start');
    const targetIds = new Set(template.edges.map((e: any) => e.targetNodeId));
    for (const node of template.nodes) {
      if (node.id === startNode!.id) continue;
      expect(targetIds.has(node.id)).toBe(true);
    }
  });

  it('all question nodes in the template have a question text or guidance note', () => {
    const template = createAndersonBowmanTemplate();
    const questionNodes = template.nodes.filter((n: any) => n.type === 'question');
    for (const node of questionNodes) {
      // A question must have at least one of: verbatim question text or AI guidance note
      expect(node.config.question || node.config.note).toBeTruthy();
    }
  });

  it('question nodes with collectFields all have a valid question prompt', () => {
    const template = createAndersonBowmanTemplate();
    const withFields = template.nodes.filter((n: any) => n.type === 'question' && n.config.collectFields?.length > 0);
    expect(withFields.length).toBeGreaterThan(0);
    for (const node of withFields) {
      expect(typeof node.config.question).toBe('string');
      expect(node.config.question.length).toBeGreaterThan(0);
    }
  });
});
