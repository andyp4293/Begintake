import {
  getLiveTransferAnnouncement,
  getTransferTarget,
  isLiveTransferEnabled,
  resolveTransferCallbackMessage,
  sanitizeLegacyTransferCopy,
} from './transfer-handoff';

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

function getOpeningQuestionNode(
  startNode: FlowNodeData | undefined,
  nodeMap: Map<string, FlowNodeData>,
  outEdges: Map<string, FlowEdgeData[]>,
): FlowNodeData | null {
  if (!startNode) return null;
  const firstEdge = (outEdges.get(startNode.id) || [])[0];
  if (!firstEdge) return null;
  const firstNode = nodeMap.get(firstEdge.targetNodeId);
  if (!firstNode || firstNode.type !== 'question') return null;
  if (typeof firstNode.config?.question !== 'string' || firstNode.config.question.trim().length === 0) return null;
  return firstNode;
}

function deriveRoutingLabel(targetNode: FlowNodeData | undefined, edge: FlowEdgeData): string {
  if (!targetNode) return edge.label || 'Continue';

  if (edge.label && edge.label.trim().length > 0) {
    return edge.label;
  }

  if (targetNode.type === 'response') {
    const response = typeof targetNode.config?.response === 'string'
      ? targetNode.config.response.trim()
      : '';
    if (response) return response;
  }

  if (targetNode.type === 'action' && targetNode.config?.actionType === 'set_flag') {
    const flagValue = typeof targetNode.config?.flagValue === 'string'
      ? targetNode.config.flagValue.trim()
      : '';
    if (flagValue) return flagValue;
  }

  return targetNode.label || 'Continue';
}

function getPreAnsweredQuestionInstruction(questionText: string): string | null {
  const normalized = questionText.toLowerCase();

  if (normalized.includes('first and last name') || normalized.includes('your name')) {
    return 'If the caller already clearly gave their name earlier in the conversation, treat it as captured and continue without re-asking this question.';
  }

  if (normalized.includes('best number') || normalized.includes('reach you if we get disconnected') || normalized.includes('callback number')) {
    return 'If the caller already confirmed the callback number or gave a replacement number earlier, treat that phone number as captured and continue without re-asking this question.';
  }

  if (normalized.includes('for yourself') || normalized.includes('on behalf of someone else')) {
    return 'If the caller already made clear whether they are calling for themselves or someone else, treat that as captured and continue without re-asking this question.';
  }

  if (normalized.includes('worked with our firm before') || normalized.includes('first time reaching out')) {
    return 'If the caller already made clear that they are a new or existing client earlier in the conversation, treat that as captured and continue without re-asking this question.';
  }

  if (normalized.includes('email')) {
    return 'If the caller already clearly gave their email earlier in the conversation, treat it as captured and continue without re-asking this question.';
  }

  if (normalized.includes("what's been going on") || normalized.includes('how can i help') || normalized.includes('tell me a little about')) {
    return 'If the caller already clearly explained their core issue earlier in the conversation, treat that issue summary as captured and continue without re-asking this question.';
  }

  return null;
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
    return `You are an AI intake assistant for a law firm. Greet callers warmly, collect their name and phone number, listen to their situation, and let them know the right lawyer will reach out to them.`;
  }

  const openingQuestionNode = getOpeningQuestionNode(startNode, nodeMap, outEdges);

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
  const resolveScriptText = (text: string) => sanitizeLegacyTransferCopy(resolveVars(text));

  // Header
  sections.push(`You are ${resolvedName}, an AI intake receptionist for a law firm.`);
  sections.push(`Today is ${today}.`);
  sections.push('');
  sections.push('FOLLOW THIS SCRIPT EXACTLY.');
  sections.push('ABSOLUTE RULE: never say filler phrases like "hold on a sec", "give me a moment", "just a sec", "one moment", or "this will take a sec."');
  sections.push('ACTIVE FLOW CONTROL: after EVERY caller answer, silently call advanceActiveFlow with the caller\'s exact latest response.');
  sections.push('Do NOT choose the next scripted question, branch, transfer, or scheduling step yourself. The server-owned flow runner decides that for you.');
  sections.push('When the caller answered the current question in natural language, include matchedChoiceLabel in advanceActiveFlow with a short semantic summary of the branch they most likely meant, even if they did not use the exact option words.');
  sections.push('When the caller clearly reveals or corrects a core fact like new versus existing client, for themselves versus someone else, their name, callback number, email, or issue summary, include those in semanticFacts even if they came out of order.');
  sections.push('If the caller clearly wants a real person, live staff member, or someone on the team instead of continuing with the AI, include semanticFacts.requestHuman as true even if they do not say the exact words "real person".');
  sections.push('If the caller is correcting something they said earlier, set semanticFacts.answerIntent to "correction". If the same turn both answers the current question and corrects earlier info, set it to "both".');
  sections.push('If the caller clearly has no idea, needs a plain-English explanation, wants to skip or move on from the current question, or has gone off-topic for the current question, include semanticFacts.questionState with the closest meaning.');
  sections.push('If the caller clearly sounds like they are not trying to reach a law firm at all, include semanticFacts.conversationFit as "wrong_number". If they clearly are describing a real legal problem, include semanticFacts.conversationFit as "legal_intake".');
  sections.push('If the caller turns into an obvious prank, scam, wrong-number, or non-legal business call at any point in the conversation, treat that as wrong_number even if the intake had already started.');
  sections.push('If the caller says they were scammed by, defrauded by, or harmed by a business or impersonator, that is still a legal intake, not a wrong-number call.');
  sections.push('After the summary or handoff stage, if the caller clearly sounds done, is asking a follow-up timing question, or urgently wants a real person now, include semanticFacts.postCallIntent with the closest intent.');
  sections.push('If advanceActiveFlow returns step="ask", step="clarify", or step="say", say the returned assistantMessage exactly and do not improvise a different scripted question.');
  sections.push('If advanceActiveFlow returns speakExactly=true, your very next spoken output must be the returned assistantMessage verbatim, with no prefix, suffix, hesitation, or filler words.');
  sections.push('If advanceActiveFlow returns step="live_transfer", stop speaking and let the live transfer happen.');
  sections.push('If advanceActiveFlow returns endCallAfterSpeaking=true, say the returned assistantMessage and then immediately call endCall.');
  sections.push('During active-flow calls, do NOT call checkClient, identifyLawyer, scheduleConsultation, generateSummary, or generateTransferSummary on your own unless the flow runner specifically tells you to. advanceActiveFlow normally handles those steps internally.');
  sections.push('Ask each question one at a time. Wait for answers before proceeding.');
  sections.push('Keep ALL responses under 2 sentences - this is a phone call.');
  sections.push('NEVER give legal advice. You are an intake assistant, not an attorney.');
  sections.push('Be empathetic and calm, but do not overdo apology language. Do not keep repeating phrases like "I\'m sorry", "sorry to hear that", or similar on every question.');
  sections.push('If the caller shares something difficult, acknowledge it naturally once, then continue the intake without repeating the same empathy phrase again and again.');
  sections.push('When the caller first explains the problem, sound like a calm human receptionist: briefly acknowledge it in a natural way, then move into the next question without becoming robotic.');
  sections.push('Assume many callers do not know legal procedure, legal labels, or what stage their matter is in. If they are unsure, ask a short plain-English follow-up that gets the same information instead of insisting on formal legal terminology.');
  sections.push('Sound like a calm front-desk receptionist, not a form, script reader, or decision tree.');
  sections.push('Call tools silently.');
  sections.push('During active-flow calls, do NOT call captureIntakeState. advanceActiveFlow already captures the needed slots from the caller response.');
  sections.push('Before every tool call, say nothing at all. The correct spoken content before a tool call is silence.');
  sections.push('Never say tool names out loud, and do not add filler like "one moment", "hold on", "hold on a sec", "just a sec", or "let me check" before a tool call.');
  sections.push('Never say filler like "give me a moment", "give me a second", "one sec", or similar before a tool call.');
  sections.push('Never preface a returned assistantMessage with filler like "give me a moment", "hold on a sec", "just a sec", "this will take a sec", or "one moment".');
  sections.push('Do NOT skip ahead to a summary, transfer, or goodbye. Only do that when you reach an explicit TRANSFER or END CALL section.');
  sections.push('If the current section points to another question or action section, you MUST continue to that next section before wrapping up the call.');
  sections.push('Once the caller has answered a scripted intake question, treat that answer as locked. Do NOT ask the same callback number, email, name, or "for yourself / on behalf of someone else" question again unless the caller corrected it, asked you to repeat it, or you truly could not understand the answer.');
  sections.push('If the caller volunteers answers to later scripted questions early, capture those facts immediately and skip those later questions instead of re-asking them just to preserve the original order.');
  sections.push('If one caller response answers multiple scripted questions at once, treat every clearly answered slot as captured and move to the first still-unanswered scripted question.');
  sections.push('If the caller gives a plausible direct answer to the current question - like a name, "first time", "for myself", or "yes, this number is fine" - treat it as sufficient and call advanceActiveFlow immediately instead of repeating or confirming the same question.');
  sections.push('If the caller says "hello?", asks if you are still there, or there is a brief pause, reassure them briefly and resume the current unanswered question. Do NOT restart the intake or reconfirm already captured answers.');
  sections.push('When a clarification is needed, restate the question naturally and let the caller answer in their own words. Do NOT turn the call into a rigid multiple-choice quiz unless they remain confused.');
  sections.push('If the caller sounds confused about the labels or choices, explain the difference in plain English and ask for whichever option is closest instead of repeating the same legal-language question word-for-word.');
  sections.push('If the caller asks a short follow-up question about the exact term or concept in the current intake question, answer it briefly in plain English and then return to that same question.');
  sections.push('Only answer follow-up questions when they clearly relate to the current intake step or the caller\'s legal situation. Do not drift into general small talk, broad legal advice, or unrelated Q&A.');
  sections.push('If the caller says they do not know or asks what you mean, give at most one short plain-English clarification for that question.');
  sections.push('If they still cannot answer a non-core follow-up after that one clarification, include semanticFacts.questionState instead of pushing the same question again.');
  sections.push('If the caller clearly cannot answer a non-core follow-up and wants to move on, signal that in semanticFacts.questionState instead of trapping them in the same question forever.');
  sections.push('If the caller gives a vague, noisy, or non-routable answer to the open-ended issue question, do not invent a legal category or subtype yet. Signal that it is still unclear and ask for a plain-English explanation of what happened.');
  sections.push('Use common sense with equivalent phrases. Do not require the caller to match the exact response label if their meaning is already clear.');
  sections.push('If the caller is clearly trying to reach a non-legal business or service that does not fit a law firm at all, politely tell them they have reached a law firm and likely have the wrong number instead of forcing them through intake.');
  sections.push('Do NOT invent extra follow-up questions unless the script explicitly tells you to ask one. After a scripted question is answered, move to the next scripted section.');
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
          sections.push(`Greet the caller: "${resolveScriptText(config.greeting)}"`);
        } else {
          sections.push(`Greet the caller warmly and introduce yourself.`);
        }
        if (openingQuestionNode) {
          const openingQuestionSectionId = sectionIds.get(openingQuestionNode.id);
          sections.push('Do not stop after the greeting. In the first spoken message, immediately continue into the next question.');
          sections.push(`The first spoken message already asks the question from SECTION ${openingQuestionSectionId}.`);
          sections.push(`If the caller answers right away, treat that answer as the answer to SECTION ${openingQuestionSectionId} and continue using that section's routing without repeating the question.`);
          sections.push(`Only repeat SECTION ${openingQuestionSectionId}'s question if the caller did not answer, you could not understand them, or they ask you to repeat it.`);
        } else {
          sections.push('Do not wait for a reply to the greeting itself before asking the next question.');
        }
        if (edges.length === 1 && !openingQuestionNode) {
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
        if (openingQuestionNode?.id === node.id) {
          sections.push('This question is already included in the first spoken message.');
          sections.push('If the caller already answered it immediately after the opening, do NOT ask it again.');
          sections.push(`Only if they did not answer or you need clarification, ask the caller: "${resolveScriptText(config.question || node.label)}"`);
        } else {
          sections.push(`Ask the caller: "${resolveScriptText(config.question || node.label)}"`);
        }

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
              sections.push(`- If they say "${deriveRoutingLabel(nodeMap.get(edge.targetNodeId), edge)}": go to SECTION ${targetSection}`);
            }
          } else {
            sections.push(`Then proceed to SECTION ${sectionIds.get(edges[0].targetNodeId)}.`);
          }
        }

        if (config.allowFreeform) {
          sections.push(`If their answer doesn't match any option, ask them to clarify or pick the closest option.`);
        }
        if (config.note) {
          sections.push(`Note: ${resolveScriptText(config.note)}`);
        }

        const preAnsweredInstruction = getPreAnsweredQuestionInstruction(resolveScriptText(config.question || node.label));
        if (preAnsweredInstruction) {
          sections.push(preAnsweredInstruction);
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

      case 'response': {
        const config = node.config || {};
        sections.push(`=== SECTION ${sectionId}: CALLER RESPONSE ===`);
        if (config.response) {
          sections.push(`If the caller responds with "${resolveScriptText(config.response)}":`);
        }
        if (config.instruction) {
          sections.push(resolveScriptText(config.instruction));
        }
        if (edges.length === 1) {
          sections.push(`Then proceed to SECTION ${sectionIds.get(edges[0].targetNodeId)}.`);
        } else if (edges.length > 1) {
          for (const edge of edges) {
            sections.push(`- proceed to SECTION ${sectionIds.get(edge.targetNodeId)}`);
          }
        }
        sections.push('');
        break;
      }

      case 'decision': {
        // Legacy backward compat - treat as a question node
        const config = node.config || {};
        sections.push(`=== SECTION ${sectionId}: ${node.label.toUpperCase()} ===`);
        const legacyQ = config.description || config.note;
        if (legacyQ) sections.push(`Ask the caller: "${resolveScriptText(legacyQ)}"`);
        if (edges.length > 0) {
          sections.push('Based on their response:');
          for (const edge of edges) {
            sections.push(`- If they say "${edge.label || 'Continue'}": go to SECTION ${sectionIds.get(edge.targetNodeId)}`);
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
        if (config.actionType === 'book_appointment') {
          sections.push(`Call the scheduleConsultation tool to schedule a consultation.`);
          sections.push(`Pass: caller name, caller phone, matter category, and petition type.`);
          sections.push(`Read back the confirmed date and time to the caller before continuing.`);
        }
        if (config.note) {
          sections.push(`Note: ${resolveScriptText(config.note)}`);
        }
        if (edges.length === 1) {
          sections.push(`Then proceed to SECTION ${sectionIds.get(edges[0].targetNodeId)}.`);
        }
        sections.push('');
        break;
      }

      case 'transfer': {
        const config = node.config || {};
        const transferTarget = getTransferTarget(config.transferTarget);
        const isParalegal = transferTarget === 'paralegal';
        const liveTransfer = isLiveTransferEnabled(config.handoffMode, transferTarget);
        const sectionTitle = isParalegal ? 'TEAM FOLLOW-UP' : 'LAWYER FOLLOW-UP';
        sections.push(`=== SECTION ${sectionId}: ${sectionTitle} ===`);
        sections.push('This is the FINAL step. You MUST complete it to end the call properly.');
        sections.push('');
        const transferMsg = resolveScriptText(resolveTransferCallbackMessage(config));
        const liveTransferLeadIn = getLiveTransferAnnouncement(transferTarget);

        if (liveTransfer && isParalegal) {
          sections.push('STEP 1: Immediately call the generateTransferSummary tool with transferTarget="paralegal", handoffMode="live_transfer", and any caller info you have (name, phone, email, notes).');
          sections.push(`The live transfer itself will say exactly: "${liveTransferLeadIn}"`);
          sections.push('STEP 2: If the live transfer starts, stop speaking and let the transfer happen.');
          sections.push('STEP 3: ONLY if the live transfer does not complete, say:');
          sections.push(`  "${transferMsg}"`);
          sections.push('STEP 4: After that fallback message, ask: "Is there anything else I can help you with today?"');
          sections.push('STEP 5: If they say no after the fallback path, call the endCall tool immediately.');
          sections.push('');
          sections.push('Do NOT say anything before the tool call unless the caller asks a new question.');
          sections.push('Do NOT add filler before the tool call.');
          sections.push('Do NOT say phrases like "give me a moment", "give me a second", "one sec", or "hold on" before the tool call.');
          sections.push('Do NOT call endCall after a successful live transfer.');
        } else if (liveTransfer) {
          sections.push(`STEP 1: Say: "${liveTransferLeadIn}"`);
          sections.push('STEP 2: After you finish that sentence, immediately call generateTransferSummary with transferTarget="attorney", handoffMode="live_transfer", and ALL collected data:');
          sections.push('  - callerName: from Q2');
          sections.push('  - callerPhone: from Q3');
          sections.push('  - callerEmail: if collected');
          sections.push('  - issue: full summary of their legal matter, branch, and all answers');
          sections.push('  - notes: sub-questions, answers, petition type, urgency flags, party role');
          sections.push('STEP 3: Call checkAttorneyAvailability with the caller\'s legal issue to check if the attorney is free right now.');
          sections.push('');
          sections.push('IF ATTORNEY IS AVAILABLE:');
          sections.push('  Let the live transfer proceed without announcing tool work.');
          sections.push('  The call transfer will happen automatically.');
          sections.push('  IF THE TRANSFER FAILS OR NO ONE ANSWERS:');
          sections.push('    Say warmly: "I\'m sorry - our attorney wasn\'t able to take the call right now, but your information has already been sent to them."');
          sections.push(`    Then say: "${transferMsg}"`);
          sections.push('    Ask: "Is there anything else I can help you with today?"');
          sections.push('    If they say no, call endCall immediately.');
          sections.push('');
          sections.push('IF ATTORNEY IS NOT AVAILABLE (busy or outside business hours):');
          sections.push('  Say:');
          sections.push(`  "${transferMsg}"`);
          sections.push('  Then ask: "Is there anything else I can help you with today?"');
          sections.push('  If they say no, call endCall immediately.');
          sections.push('');
          sections.push('CRITICAL: Always call endCall to end the call. The call will NOT end unless you call endCall.');
          sections.push('Do NOT call endCall after a successful live transfer.');
        } else {
          sections.push(`STEP 1: Call the generateTransferSummary tool with transferTarget="${transferTarget}" and handoffMode="summary_only". Include all caller details, issue notes, and any flags you collected.`);
          sections.push('STEP 2: After the tool returns, say:');
          sections.push(`  "${transferMsg}"`);
          sections.push('STEP 3: Ask: "Is there anything else I can help you with today?"');
          sections.push('STEP 4: If they say no, call endCall immediately.');
          sections.push('');
          sections.push('Do NOT promise a live handoff in this section. The caller should expect a follow-up, not an immediate transfer.');
          sections.push('CRITICAL: Always call endCall to end the call when the caller is done.');
        }
        sections.push('');
        break;
      }

      case 'end': {
        const config = node.config || {};
        sections.push(`=== SECTION ${sectionId}: END CALL ===`);
        const closing = resolveScriptText(config.closingMessage || 'Thank you for calling! Have a wonderful day. Goodbye!');
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
  sections.push(`  1. Say: "${resolveScriptText('Thank you for calling {firm}. Have a wonderful day. Goodbye!')}"`);
  sections.push('  2. IMMEDIATELY call the endCall tool.');
  sections.push('- You MUST call endCall after saying goodbye. The call will NOT end unless you call endCall.');
  sections.push('- Do NOT keep talking after saying goodbye. Do NOT ask more questions after goodbye.');
  sections.push('- After completing the transfer section (generateSummary + "anything else?" + they say no), you MUST call endCall.');
  sections.push('- Do NOT end the call early while there are still unanswered scripted sections on the caller\'s current branch.');
  sections.push('- Do NOT loop back to earlier intake questions once the caller already answered them, unless they corrected the answer or you genuinely never captured it.');
  sections.push('');
  sections.push('REQUESTS FOR A PERSON:');
  sections.push('- If the caller says "talk to a person", "real person", "human", "paralegal", "manager", "transfer me", or similar at ANY point:');
  sections.push('  If the intake is still in progress, let the server handle an immediate live paralegal transfer and do not try to talk the caller out of it.');
  sections.push('  If the call is already in the post-summary follow-up stage, do NOT offer a live paralegal transfer. Let the server end the intake with team follow-up instead.');
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
    if (node.type === 'action' && node.config?.actionType === 'book_appointment') {
      tools.add('scheduleConsultation');
    }
  }

  // Always include endCall
  tools.add('endCall');

  return [...tools];
}
