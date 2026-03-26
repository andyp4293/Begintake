import { describe, it, expect } from 'vitest';
import { compileFlowToPrompt, extractToolsFromFlow } from './flow-compiler';
import { createAndersonBowmanTemplate } from './templates/anderson-bowman';

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

    // Check key sections exist
    expect(prompt).toContain('Aria');
    expect(prompt).toContain('Anderson Bowman PLLC');
    expect(prompt).toContain('Shall we get started');
    expect(prompt).toContain('What brings you to the firm today');
    expect(prompt).toContain('custody');
    expect(prompt).toContain('safety');
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
});

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
});

describe('Anderson Bowman template', () => {
  it('creates valid template with nodes and edges', () => {
    const template = createAndersonBowmanTemplate();
    expect(template.name).toContain('Anderson Bowman');
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

  it('has the 8 triage branches', () => {
    const template = createAndersonBowmanTemplate();
    const triageNode = template.nodes.find((n: any) => n.label === 'What brings you to the firm?');
    expect(triageNode).toBeDefined();
    const triageEdges = template.edges.filter((e: any) => e.sourceNodeId === triageNode!.id);
    expect(triageEdges.length).toBe(8);
  });
});
