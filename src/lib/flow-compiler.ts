/**
 * Flow-to-System-Prompt Compiler
 *
 * Takes an IntakeFlow (with nodes and edges) and produces a structured
 * VAPI-compatible system prompt that the AI follows step-by-step.
 */

interface FlowNodeData {
  id: string;
  type: string;
  label: string;
  config: any;
}

interface FlowEdgeData {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  label: string | null;
  condition: any;
  sortOrder: number;
}

interface FlowData {
  id: string;
  name: string;
  description: string | null;
  nodes: FlowNodeData[];
  edges: FlowEdgeData[];
}

export function compileFlowToPrompt(flow: FlowData, assistantName?: string, firmName?: string): string {
  const nodeMap = new Map<string, FlowNodeData>();
  for (const node of flow.nodes) {
    nodeMap.set(node.id, node);
  }

  // Build adjacency: nodeId -> outgoing edges sorted by sortOrder
  const outEdges = new Map<string, FlowEdgeData[]>();
  for (const edge of flow.edges) {
    const list = outEdges.get(edge.sourceNodeId) || [];
    list.push(edge);
    outEdges.set(edge.sourceNodeId, list);
  }
  // Sort edges
  for (const [, edges] of outEdges) {
    edges.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // Find start node
  const startNode = flow.nodes.find((n) => n.type === 'start');
  if (!startNode) {
    return `You are an AI intake assistant for a law firm. Greet callers warmly, collect their name and phone number, listen to their situation, and connect them with an attorney.`;
  }

  // BFS to assign section IDs
  const sectionIds = new Map<string, string>();
  const visited = new Set<string>();
  const queue: Array<{ nodeId: string; sectionId: string }> = [];

  sectionIds.set(startNode.id, '0');
  queue.push({ nodeId: startNode.id, sectionId: '0' });

  let sectionCounter = 1;

  while (queue.length > 0) {
    const { nodeId, sectionId } = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const edges = outEdges.get(nodeId) || [];
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      if (!visited.has(edge.targetNodeId)) {
        const childSection = edges.length > 1
          ? `${sectionId}.${i + 1}`
          : `${sectionCounter}`;
        if (edges.length <= 1) sectionCounter++;
        sectionIds.set(edge.targetNodeId, childSection);
        queue.push({ nodeId: edge.targetNodeId, sectionId: childSection });
      }
    }
  }

  // Build prompt sections
  const sections: string[] = [];
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Resolve {name} and {firm} variables in any string
  const resolvedName = assistantName || 'Aria';
  const resolveVars = (text: string) => text.replace(/\{name\}/gi, resolvedName).replace(/\{firm\}/gi, firmName || 'our law firm');

  // Header
  sections.push(`You are ${resolvedName}, an AI intake receptionist for a law firm.`);
  sections.push(`Today is ${today}.`);
  sections.push('');
  sections.push('FOLLOW THIS SCRIPT EXACTLY. Ask each question one at a time. Wait for answers before proceeding.');
  sections.push('Keep ALL responses under 2 sentences - this is a phone call.');
  sections.push('NEVER give legal advice. You are an intake assistant, not an attorney.');
  sections.push('Before calling any tool, say a short natural phrase like "One moment." - vary it each time.');
  sections.push('');

  // Process each visited node
  const orderedNodes = [...visited].map((id) => ({
    node: nodeMap.get(id)!,
    sectionId: sectionIds.get(id) || '?',
  }));

  for (const { node, sectionId } of orderedNodes) {
    const edges = outEdges.get(node.id) || [];

    switch (node.type) {
      case 'start': {
        const config = node.config || {};
        sections.push(`=== SECTION ${sectionId}: OPENING ===`);
        if (config.greeting) {
          sections.push(`Greet the caller: "${config.greeting}"`);
        } else {
          sections.push(`Greet the caller warmly and introduce yourself.`);
        }
        if (edges.length === 1) {
          sections.push(`Then proceed to SECTION ${sectionIds.get(edges[0].targetNodeId)}.`);
        }
        sections.push('');
        break;
      }

      case 'collect_info': {
        const config = node.config || {};
        const fields = config.fields || [];
        sections.push(`=== SECTION ${sectionId}: ${node.label.toUpperCase()} ===`);
        if (config.question) {
          sections.push(`Ask: "${config.question}"`);
        }
        sections.push(`Collect the following information from the caller:`);
        for (const field of fields) {
          const required = field.required ? ' (required)' : ' (optional)';
          if (field.type === 'choice' && field.options) {
            sections.push(`- ${field.label}${required}: options are ${field.options.join(', ')}`);
          } else {
            sections.push(`- ${field.label}${required}`);
          }
        }
        sections.push(`Store all collected data mentally - you will need it at transfer.`);
        if (edges.length === 1) {
          sections.push(`After collecting, proceed to SECTION ${sectionIds.get(edges[0].targetNodeId)}.`);
        }
        sections.push('');
        break;
      }

      case 'question': {
        const config = node.config || {};
        sections.push(`=== SECTION ${sectionId}: ${node.label.toUpperCase()} ===`);
        sections.push(`Ask the caller: "${config.question || node.label}"`);

        // If options have instructions, emit them
        const options = config.options || [];
        if (options.length > 0 && options.some((o: any) => o.instruction)) {
          sections.push(`Based on their response:`);
          for (const opt of options) {
            if (opt.instruction) {
              sections.push(`- If they say "${opt.label}": ${opt.instruction}`);
            } else {
              sections.push(`- If they say "${opt.label}": proceed to next step`);
            }
          }
        }

        // Edge-based routing (for branching to different sections)
        if (edges.length > 0) {
          // Only add "Based on their response:" if we didn't already from options
          if (!(options.length > 0 && options.some((o: any) => o.instruction))) {
            sections.push(`Based on their response:`);
          }
          if (edges.length > 1) {
            for (const edge of edges) {
              const targetSection = sectionIds.get(edge.targetNodeId);
              sections.push(`- If they say "${edge.label || 'Continue'}": go to SECTION ${targetSection}`);
            }
          } else {
            sections.push(`Then proceed to SECTION ${sectionIds.get(edges[0].targetNodeId)}.`);
          }
        }

        if (config.allowFreeform) {
          sections.push(`If their answer doesn't match any option, ask them to clarify or pick the closest option.`);
        }
        if (config.note) {
          sections.push(`Note: ${config.note}`);
        }

        // Inline collect fields (merged from collect_info)
        const collectFields = config.collectFields || [];
        if (collectFields.length > 0) {
          sections.push(`Also collect the following information:`);
          for (const field of collectFields) {
            const req = field.required !== false ? ' (required)' : ' (optional)';
            if (field.type === 'choice' && field.options) {
              sections.push(`- ${field.label || field.name}${req}: options are ${field.options.join(', ')}`);
            } else {
              sections.push(`- ${field.label || field.name}${req}`);
            }
          }
          sections.push(`Store all collected data - you will need it at transfer.`);
        }

        sections.push('');
        break;
      }

      case 'decision': {
        const config = node.config || {};
        sections.push(`=== SECTION ${sectionId}: ${node.label.toUpperCase()} ===`);
        if (config.description) {
          sections.push(config.description);
        }
        if (edges.length > 0) {
          for (const edge of edges) {
            const targetSection = sectionIds.get(edge.targetNodeId);
            const cond = edge.condition;
            if (cond) {
              sections.push(`- If ${cond.field} ${cond.operator || 'is'} ${cond.value} → go to SECTION ${targetSection}`);
            } else {
              sections.push(`- ${edge.label || 'Otherwise'} → go to SECTION ${targetSection}`);
            }
          }
        }
        sections.push('');
        break;
      }

      case 'action': {
        const config = node.config || {};
        sections.push(`=== SECTION ${sectionId}: ${node.label.toUpperCase()} ===`);
        if (config.actionType === 'call_tool') {
          sections.push(`Call the ${config.toolName} tool.`);
        }
        if (config.actionType === 'set_flag') {
          sections.push(`Set ${config.flagName} = "${config.flagValue}".`);
          if (config.petitionType) {
            sections.push(`Set petition_type = "${config.petitionType}".`);
          }
        }
        if (config.actionType === 'send_email') {
          sections.push(`Send an email summary to the matched attorney.`);
        }
        if (config.note) {
          sections.push(`Note: ${config.note}`);
        }
        if (edges.length === 1) {
          sections.push(`Then proceed to SECTION ${sectionIds.get(edges[0].targetNodeId)}.`);
        }
        sections.push('');
        break;
      }

      case 'transfer': {
        const config = node.config || {};
        sections.push(`=== SECTION ${sectionId}: TRANSFER TO ATTORNEY ===`);
        sections.push('This is the FINAL step. You MUST complete it to end the call properly.');
        sections.push('');
        sections.push('STEP 1: Say "One moment while I put together your information."');
        sections.push('STEP 2: Call the generateTransferSummary tool with ALL data you collected:');
        sections.push('  - Caller name: the name from Q2');
        sections.push('  - Caller phone: the phone from Q3');
        sections.push('  - callerEmail: if collected');
        sections.push('  - issue: a detailed summary of their legal matter, branch, and all answers');
        sections.push('  - notes: all sub-questions, answers, petition type, urgency flags, party role');
        sections.push('STEP 3: After the tool returns, say: "I\'ve sent everything over to our legal team along with your contact information. They\'ll reach out to you directly."');
        sections.push('STEP 4: Ask: "Is there anything else I can help you with?"');
        sections.push('STEP 5: If they say no (or anything indicating they are done), say:');
        const transferMsg = config.message || 'Thank you so much for calling. Have a wonderful day. Goodbye!';
        sections.push(`  "${transferMsg}"`);
        sections.push('STEP 6: IMMEDIATELY call the endCall tool. The call will NOT end unless you call endCall.');
        sections.push('');
        sections.push('CRITICAL: You MUST call endCall after saying goodbye. Do NOT keep talking. Do NOT skip endCall.');
        sections.push('');
        break;
      }

      case 'end': {
        const config = node.config || {};
        sections.push(`=== SECTION ${sectionId}: END CALL ===`);
        const closing = config.closingMessage || 'Thank you for calling! Have a wonderful day. Goodbye!';
        sections.push(`Say: "${closing}"`);
        sections.push(`Then call the endCall tool. The call will NOT end unless you call endCall.`);
        sections.push('');
        break;
      }
    }
  }

  // Add ending rules
  sections.push('=== GENERAL RULES ===');
  sections.push('');
  sections.push('ENDING THE CALL (CRITICAL):');
  sections.push('- When the caller says "no", "nope", "nothing else", "that\'s all", "I\'m good", "goodbye", "bye", "thanks that\'s it", or ANYTHING indicating they are done:');
  sections.push('  1. Say: "Thank you for calling Anderson Bowman. Have a wonderful day. Goodbye!"');
  sections.push('  2. IMMEDIATELY call the endCall tool.');
  sections.push('- You MUST call endCall after saying goodbye. The call will NOT end unless you call endCall.');
  sections.push('- Do NOT keep talking after saying goodbye. Do NOT ask more questions after goodbye.');
  sections.push('- After completing the transfer section (generateSummary + "anything else?" + they say no), you MUST call endCall.');
  sections.push('');
  sections.push('TRANSFER TO HUMAN:');
  sections.push('- If the caller says "talk to a person", "real person", "human", "paralegal", "manager", "transfer me", or similar at ANY point:');
  sections.push('  Say "Sure, let me connect you with someone now." The call will be forwarded automatically.');
  sections.push('');
  sections.push('OTHER RULES:');
  sections.push('- Never read IDs aloud.');
  sections.push('- Be empathetic. People calling a law firm are often stressed.');
  sections.push('- Everything shared is confidential.');
  sections.push('- Keep ALL responses under 2 sentences - this is a phone call, not a letter.');

  // Replace all {name} variables with the assistant's name
  return resolveVars(sections.join('\n'));
}

/**
 * Extract the list of VAPI tools needed based on Action nodes in the flow.
 */
export function extractToolsFromFlow(flow: FlowData): string[] {
  const tools = new Set<string>();

  for (const node of flow.nodes) {
    if (node.type === 'action' && node.config?.toolName) {
      tools.add(node.config.toolName);
    }
    if (node.type === 'transfer') {
      tools.add('generateTransferSummary');
    }
  }

  // Always include endCall
  tools.add('endCall');

  return [...tools];
}
