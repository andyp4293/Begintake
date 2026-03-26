/**
 * Anderson Bowman PLLC — AI Receptionist Intake Script
 * Family Court Practice Group — Kew Gardens, New York
 *
 * This template encodes the full 9-page intake script as a flow graph.
 * Each section, question, branch, and transfer protocol is represented.
 * Labels use document section numbering (A1, A2, B1, etc.).
 */

let nodeCounter = 0;
function nodeId() { return `ab-node-${++nodeCounter}`; }
let edgeCounter = 0;
function edgeId() { return `ab-edge-${++edgeCounter}`; }

export function createAndersonBowmanTemplate() {
  nodeCounter = 0;
  edgeCounter = 0;

  const nodes: any[] = [];
  const edges: any[] = [];
  let y = 0;

  function addNode(type: string, label: string, config: any, x = 0) {
    const id = nodeId();
    nodes.push({ id, type, label, config, positionX: x, positionY: y, sortOrder: nodes.length });
    y += 150;
    return id;
  }

  function addEdge(sourceId: string, targetId: string, label?: string, condition?: any) {
    const id = edgeId();
    edges.push({ id, sourceNodeId: sourceId, targetNodeId: targetId, label: label || null, condition: condition || null, sortOrder: edges.length });
    return id;
  }

  // ═══ SECTION 0: OPENING ═══
  const startId = addNode('start', '0. Opening Greeting', {
    greeting: "Good afternoon. Thank you for calling Anderson Bowman PLLC. My name is Aria, and I'm the firm's intake assistant. I'm going to ask you a few questions so that when I connect you with one of our attorneys, they'll already have everything they need to help you right away. Everything you share is confidential. Shall we get started?",
  });

  const q1Id = addNode('question', '0a. Shall we get started?', {
    question: 'Shall we get started?',
    options: [
      { label: 'Yes, let\'s begin', value: 'yes' },
      { label: 'What is this for?', value: 'explain' },
    ],
  });
  addEdge(startId, q1Id);

  const collectInfoId = addNode('collect_info', '0b. Caller Information', {
    fields: [
      { name: 'caller_name', label: 'First and last name', type: 'text', required: true },
      { name: 'phone', label: 'Best phone number to reach you', type: 'phone', required: true },
    ],
  });
  addEdge(q1Id, collectInfoId, 'Continue');

  const q4Id = addNode('question', '0c. Self or On Behalf Of', {
    question: 'Are you calling for yourself, or on behalf of someone else?',
    options: [
      { label: 'For myself', value: 'self' },
      { label: 'For a family member', value: 'family' },
    ],
  });
  addEdge(collectInfoId, q4Id);

  // ═══ SECTION 1: PRIMARY TRIAGE ═══
  const triageId = addNode('question', '1. Primary Triage — What brings you in?', {
    question: 'What brings you to the firm today?',
    options: [
      { label: 'A. My children — custody or visitation', value: 'A' },
      { label: 'B. Child support or spousal support', value: 'B' },
      { label: 'C. A family member is threatening or hurting me', value: 'C' },
      { label: 'D. A child\'s safety or welfare concern', value: 'D' },
      { label: 'E. Paternity — establishing who the father is', value: 'E' },
      { label: 'F. Adoption or guardianship', value: 'F' },
      { label: 'G. A juvenile matter', value: 'G' },
      { label: 'H. Something else', value: 'H' },
    ],
    allowFreeform: true,
  });
  addEdge(q4Id, triageId);

  // ═══ BRANCH A: CUSTODY & VISITATION ═══
  const branchADecision = addNode('decision', 'A1. Custody Order Status', {
    description: 'Is there currently a custody order in place, or would this be a new filing?',
  }, -600);

  const branchANew = addNode('action', 'A1a. Flag: New V-Petition', {
    actionType: 'set_flag', flagName: 'petitionType', flagValue: 'V-Petition — new',
  }, -600);

  const branchAMod = addNode('action', 'A1b. Flag: Modify V-Petition', {
    actionType: 'set_flag', flagName: 'petitionType', flagValue: 'V-Petition — modification',
    note: 'Substantial change in circumstances required',
  }, -400);

  const branchAViolation = addNode('action', 'A1c. Flag: Violation V-Petition', {
    actionType: 'set_flag', flagName: 'petitionType', flagValue: 'V-Petition — violation/enforcement',
    note: 'Flag potential contempt/enforcement',
  }, -200);

  addEdge(triageId, branchADecision, 'A. Custody or visitation');
  addEdge(branchADecision, branchANew, 'No order exists');
  addEdge(branchADecision, branchAMod, 'Order exists — want to modify');
  addEdge(branchADecision, branchAViolation, 'Order exists — being violated');

  const a2 = addNode('question', 'A2. Type of Custody Sought', {
    question: 'Are you seeking physical custody, legal custody, or both?',
    options: [
      { label: 'Physical custody (where the child lives)', value: 'physical' },
      { label: 'Legal custody (major decision-making)', value: 'legal' },
      { label: 'Both physical and legal custody', value: 'both' },
      { label: 'Not sure', value: 'unsure' },
    ],
  }, -600);

  addEdge(branchANew, a2);
  addEdge(branchAMod, a2);
  addEdge(branchAViolation, a2);

  const a3 = addNode('question', 'A3. Marital / Relationship Status', {
    question: 'What is your marital or relationship status with the other parent?',
    options: [
      { label: 'Married or divorcing', value: 'married' },
      { label: 'Never married', value: 'never_married' },
      { label: 'Separated or divorced', value: 'separated' },
    ],
  }, -600);
  addEdge(a2, a3);

  const a4 = addNode('collect_info', 'A4. Children Information', {
    fields: [
      { name: 'num_children', label: 'Number of children involved', type: 'text', required: true },
      { name: 'children_ages', label: 'Ages of children', type: 'text', required: true },
    ],
  }, -600);
  addEdge(a3, a4);

  const a5 = addNode('question', 'A5. Urgency / Safety Screen', {
    question: 'Is there an immediate safety concern for you or the children right now?',
    options: [
      { label: 'Yes — immediate safety concern', value: 'urgent' },
      { label: 'No — routine matter', value: 'routine' },
    ],
  }, -600);
  addEdge(a4, a5);

  // ═══ BRANCH B: CHILD SUPPORT & SPOUSAL SUPPORT ═══
  const branchBDecision = addNode('decision', 'B1. Support Filing Status', {
    description: 'Are you looking to file for support for the first time, modify an existing order, or enforce an order that isn\'t being followed?',
  }, -300);

  addEdge(triageId, branchBDecision, 'B. Child support or spousal support');

  const bNew = addNode('action', 'B1a. Flag: New F-Petition', {
    actionType: 'set_flag', flagName: 'petitionType', flagValue: 'F-Petition — new',
  }, -300);

  const bMod = addNode('action', 'B1b. Flag: Modify Support', {
    actionType: 'set_flag', flagName: 'petitionType', flagValue: 'F-Petition — modification',
  }, -200);

  const bEnforce = addNode('action', 'B1c. Flag: Enforce Support', {
    actionType: 'set_flag', flagName: 'petitionType', flagValue: 'F-Petition — enforcement/violation',
  }, -100);

  addEdge(branchBDecision, bNew, 'New — first time filing');
  addEdge(branchBDecision, bMod, 'Modify existing order');
  addEdge(branchBDecision, bEnforce, 'Enforce — not being paid');

  const b2 = addNode('question', 'B2. Type of Support Sought', {
    question: 'Are you looking for child support, spousal maintenance, or both?',
    options: [
      { label: 'Child support only', value: 'child' },
      { label: 'Spousal maintenance only', value: 'spousal' },
      { label: 'Both', value: 'both' },
    ],
  }, -300);

  addEdge(bNew, b2);
  addEdge(bMod, b2);
  addEdge(bEnforce, b2);

  const b3 = addNode('question', 'B3. Party Role (Petitioner / Respondent)', {
    question: 'Are you the one receiving support, or being asked to pay?',
    options: [
      { label: 'Receiving support (Petitioner)', value: 'petitioner' },
      { label: 'Being asked to pay (Respondent)', value: 'respondent' },
    ],
  }, -300);
  addEdge(b2, b3);

  // ═══ BRANCH C: FAMILY OFFENSE / ORDER OF PROTECTION ═══
  const branchCSafety = addNode('question', 'C1. Immediate Safety Check', {
    question: 'First, I need to ask — are you in a safe place right now?',
    options: [
      { label: 'Yes, I am safe', value: 'safe' },
      { label: 'No, or I\'m not sure', value: 'unsafe' },
    ],
  }, 0);

  addEdge(triageId, branchCSafety, 'C. Family offense / threats');

  const cUnsafe = addNode('action', 'C1a. EMERGENCY — Call 911', {
    actionType: 'set_flag', flagName: 'urgencyFlag', flagValue: 'safety_first',
    petitionType: 'O-Petition — emergency order of protection',
    note: 'Advise caller to call 911 immediately. Offer immediate attorney transfer.',
  }, 100);
  addEdge(branchCSafety, cUnsafe, 'Not safe / unsure');

  const c2 = addNode('question', 'C2. Nature of Conduct', {
    question: 'Can you tell me a little about what has been happening?',
    options: [
      { label: 'Physical violence or threats', value: 'physical' },
      { label: 'Harassment, stalking, or intimidation', value: 'harassment' },
      { label: 'Emotional or psychological abuse', value: 'emotional' },
      { label: 'Sexual abuse', value: 'sexual' },
    ],
  }, 0);
  addEdge(branchCSafety, c2, 'Caller is safe');

  const c3 = addNode('question', 'C3. Relationship to Respondent', {
    question: 'What is your relationship to the person who is doing this?',
    options: [
      { label: 'Spouse or former spouse', value: 'spouse' },
      { label: 'Co-parent or parent of my child', value: 'coparent' },
      { label: 'Parent or sibling', value: 'family' },
      { label: 'Intimate partner / boyfriend / girlfriend', value: 'partner' },
    ],
  }, 0);
  addEdge(c2, c3);

  // ═══ BRANCH D: CHILD WELFARE / ACS ═══
  const branchDDecision = addNode('decision', 'D1. ACS / Child Welfare Situation', {
    description: 'Can you tell me more about the situation?',
  }, 300);

  addEdge(triageId, branchDDecision, 'D. Child safety / welfare concern');

  const d2 = addNode('question', 'D2. ACS Investigation Stage', {
    question: 'Has ACS come to your home? And is there a court date scheduled?',
    options: [
      { label: 'Investigation stage, no court date', value: 'investigation' },
      { label: 'Petition filed, court date scheduled', value: 'court_date' },
    ],
  }, 300);
  addEdge(branchDDecision, d2, 'ACS came to my home');

  // ═══ BRANCH E: PATERNITY ═══
  const branchEDecision = addNode('decision', 'E1. Paternity — Caller Role', {
    description: 'Are you a mother looking to establish paternity, a father seeking rights, or someone disputing paternity?',
  }, 600);

  addEdge(triageId, branchEDecision, 'E. Paternity');

  // ═══ BRANCH F: ADOPTION & GUARDIANSHIP ═══
  const branchFDecision = addNode('decision', 'F1. Adoption / Guardianship Type', {
    description: 'What type of adoption or guardianship matter do you need help with?',
  }, 900);

  addEdge(triageId, branchFDecision, 'F. Adoption or guardianship');

  // ═══ BRANCH G: JUVENILE ═══
  const branchGDecision = addNode('decision', 'G1. Juvenile Matter Type', {
    description: 'Can you tell me more about the juvenile matter?',
  }, 1200);

  addEdge(triageId, branchGDecision, 'G. Juvenile matter');

  // ═══ BRANCH H: OTHER ═══
  const branchHDecision = addNode('decision', 'H1. Other Legal Matter', {
    description: 'Can you tell me what kind of legal matter you need help with?',
  }, 1500);

  addEdge(triageId, branchHDecision, 'H. Something else');

  // ═══ TRANSFER NODE (all branches lead here) ═══
  const transferId = addNode('transfer', 'Transfer to Attorney', {
    message: "Thank you so much for sharing all of that with me. I now have everything the attorney will need to help you effectively. Please hold for just a moment — I'm connecting you now with a member of our legal team.",
    includeNotes: true,
    transferData: ['caller_name', 'phone', 'party_role', 'matter_category', 'petition_type', 'urgency_flag', 'branch_path', 'all_collected_fields'],
  }, 0);

  // Connect all branch endpoints to transfer
  addEdge(a5, transferId, 'Urgent — safety concern');
  addEdge(a5, transferId, 'Routine');
  addEdge(b3, transferId, 'Continue');
  addEdge(cUnsafe, transferId, 'Emergency transfer');
  addEdge(c3, transferId, 'Continue');
  addEdge(d2, transferId, 'Continue');
  addEdge(branchDDecision, transferId, 'Concerned about child elsewhere');
  addEdge(branchDDecision, transferId, 'Foster parent legal matter');
  addEdge(branchEDecision, transferId, 'Mother seeking to establish');
  addEdge(branchEDecision, transferId, 'Father seeking rights');
  addEdge(branchEDecision, transferId, 'Alleged father disputing');
  addEdge(branchFDecision, transferId, 'Any adoption/guardianship type');
  addEdge(branchGDecision, transferId, 'Any juvenile matter');
  addEdge(branchHDecision, transferId, 'Any other matter');

  return {
    name: 'Anderson Bowman PLLC — Family Court Intake',
    description: 'Complete AI intake script for prospective family law clients. Covers custody, support, family offense, child welfare, paternity, adoption, juvenile, and miscellaneous matters. Routes callers through triage and transfers with structured notes to attorneys.',
    isTemplate: true,
    nodes,
    edges,
  };
}
