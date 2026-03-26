/**
 * Anderson Bowman PLLC — AI Receptionist Intake Script
 * Family Court Practice Group — Kew Gardens, New York
 *
 * This template encodes the full 9-page intake script as a flow graph.
 * Each section, question, branch, and transfer protocol is represented.
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
  const startId = addNode('start', 'Opening Greeting', {
    greeting: "Good afternoon. Thank you for calling Anderson Bowman PLLC. My name is Aria, and I'm the firm's intake assistant. I'm going to ask you a few questions so that when I connect you with one of our attorneys, they'll already have everything they need to help you right away. Everything you share is confidential. Shall we get started?",
  });

  const q1Id = addNode('question', 'Shall we get started?', {
    question: 'Shall we get started?',
    options: [
      { label: 'Yes, let\'s begin', value: 'yes' },
      { label: 'What is this for?', value: 'explain' },
    ],
  });
  addEdge(startId, q1Id);

  const collectInfoId = addNode('collect_info', 'Caller Information', {
    fields: [
      { name: 'caller_name', label: 'First and last name', type: 'text', required: true },
      { name: 'phone', label: 'Best phone number to reach you', type: 'phone', required: true },
    ],
  });
  addEdge(q1Id, collectInfoId, 'Yes');
  addEdge(q1Id, collectInfoId, 'Brief explanation then continue');

  const q4Id = addNode('question', 'Calling for self or someone else?', {
    question: 'Are you calling for yourself, or on behalf of someone else?',
    options: [
      { label: 'For myself', value: 'self' },
      { label: 'For a family member', value: 'family' },
    ],
  });
  addEdge(collectInfoId, q4Id);

  // ═══ SECTION 1: PRIMARY TRIAGE ═══
  const triageId = addNode('question', 'What brings you to the firm?', {
    question: 'What brings you to the firm today?',
    options: [
      { label: 'My children — custody or visitation', value: 'A' },
      { label: 'Child support or spousal support', value: 'B' },
      { label: 'A family member is threatening or hurting me', value: 'C' },
      { label: "A child's safety or welfare concern", value: 'D' },
      { label: 'Paternity — establishing who the father is', value: 'E' },
      { label: 'Adoption or guardianship', value: 'F' },
      { label: 'A juvenile matter', value: 'G' },
      { label: 'Something else', value: 'H' },
    ],
    allowFreeform: true,
  });
  addEdge(q4Id, triageId, 'For myself');
  addEdge(q4Id, triageId, 'For a family member (collect relationship)');

  // ═══ BRANCH A: CUSTODY & VISITATION ═══
  const branchADecision = addNode('decision', 'Custody Order Status', {
    description: 'Ask: "Is there currently a custody order in place, or would this be a new filing?"',
  }, -600);

  const branchANew = addNode('action', 'New V-Petition', {
    actionType: 'set_flag', flagName: 'petitionType', flagValue: 'V-Petition — new',
  }, -600);

  const branchAMod = addNode('action', 'Modify V-Petition', {
    actionType: 'set_flag', flagName: 'petitionType', flagValue: 'V-Petition — modification',
    note: 'Substantial change in circumstances required',
  }, -400);

  const branchAViolation = addNode('action', 'Violation V-Petition', {
    actionType: 'set_flag', flagName: 'petitionType', flagValue: 'V-Petition — violation/enforcement',
    note: 'Flag potential contempt/enforcement',
  }, -200);

  addEdge(triageId, branchADecision, 'Custody or visitation');
  addEdge(branchADecision, branchANew, 'No order exists');
  addEdge(branchADecision, branchAMod, 'Order exists — want to modify');
  addEdge(branchADecision, branchAViolation, 'Order exists — being violated');

  const a1 = addNode('question', 'Marital Status', {
    question: 'What is your marital or relationship status with the other parent?',
    options: [
      { label: 'Married or divorcing', value: 'married' },
      { label: 'Never married', value: 'never_married' },
      { label: 'Separated or divorced', value: 'separated' },
    ],
  }, -600);

  addEdge(branchANew, a1);
  addEdge(branchAMod, a1);
  addEdge(branchAViolation, a1);

  const a2 = addNode('question', 'Type of Custody', {
    question: 'Are you seeking physical custody, legal custody, or both?',
    options: [
      { label: 'Physical custody (residence)', value: 'physical' },
      { label: 'Legal custody (decision-making)', value: 'legal' },
      { label: 'Both or unsure', value: 'both' },
    ],
  }, -600);
  addEdge(a1, a2, 'Any');

  const a3 = addNode('collect_info', 'Children Info', {
    fields: [
      { name: 'num_children', label: 'Number of children', type: 'text', required: true },
      { name: 'children_ages', label: 'Ages of children', type: 'text', required: true },
    ],
  }, -600);
  addEdge(a2, a3, 'Any');

  const a4 = addNode('question', 'Urgency/Safety Screen', {
    question: 'Is there an immediate safety concern for you or the children right now?',
    options: [
      { label: 'Yes — immediate safety concern', value: 'urgent' },
      { label: 'No — routine matter', value: 'routine' },
    ],
  }, -600);
  addEdge(a3, a4);

  // ═══ BRANCH B: CHILD SUPPORT ═══
  const branchBDecision = addNode('decision', 'Support Status', {
    description: 'Ask: "Are you looking to file for support for the first time, modify an existing order, or enforce an order that isn\'t being followed?"',
  }, -300);

  addEdge(triageId, branchBDecision, 'Child support or spousal support');

  const b1 = addNode('question', 'Type of Support', {
    question: 'Are you looking for child support, spousal maintenance, or both?',
    options: [
      { label: 'Child support only', value: 'child' },
      { label: 'Spousal maintenance only', value: 'spousal' },
      { label: 'Both', value: 'both' },
    ],
  }, -300);

  const bNew = addNode('action', 'New F-Petition', {
    actionType: 'set_flag', flagName: 'petitionType', flagValue: 'F-Petition — new',
  }, -300);

  addEdge(branchBDecision, bNew, 'New — first time');
  addEdge(branchBDecision, b1, 'Modify existing');
  addEdge(branchBDecision, b1, 'Enforce — not being paid');
  addEdge(bNew, b1);

  const b3 = addNode('question', 'Party Role', {
    question: 'Are you the one receiving support, or being asked to pay?',
    options: [
      { label: 'Receiving support (Petitioner)', value: 'petitioner' },
      { label: 'Being asked to pay (Respondent)', value: 'respondent' },
    ],
  }, -300);
  addEdge(b1, b3, 'Any');

  // ═══ BRANCH C: FAMILY OFFENSE / OP ═══
  const branchCSafety = addNode('question', 'Safety Check', {
    question: 'First, I need to ask — are you in a safe place right now?',
    options: [
      { label: 'Yes, I am safe', value: 'safe' },
      { label: 'No, or I\'m not sure', value: 'unsafe' },
    ],
  }, 0);

  addEdge(triageId, branchCSafety, 'Family member threatening or hurting me');

  const cUnsafe = addNode('action', 'Emergency — Call 911', {
    actionType: 'set_flag', flagName: 'urgencyFlag', flagValue: 'safety_first',
    petitionType: 'O-Petition — emergency order of protection',
    note: 'Advise caller to call 911 immediately. Offer immediate attorney transfer.',
  }, 100);
  addEdge(branchCSafety, cUnsafe, 'Not safe / unsure');

  const c1 = addNode('question', 'Nature of Conduct', {
    question: 'Can you tell me a little about what has been happening?',
    options: [
      { label: 'Physical violence or threats', value: 'physical' },
      { label: 'Harassment, stalking, or intimidation', value: 'harassment' },
      { label: 'Emotional or psychological abuse', value: 'emotional' },
      { label: 'Sexual abuse', value: 'sexual' },
    ],
  }, 0);
  addEdge(branchCSafety, c1, 'Caller is safe');

  const c2 = addNode('question', 'Relationship to Respondent', {
    question: 'What is your relationship to the person who is doing this?',
    options: [
      { label: 'Spouse or former spouse', value: 'spouse' },
      { label: 'Co-parent or parent of my child', value: 'coparent' },
      { label: 'Parent or sibling', value: 'family' },
      { label: 'Intimate partner / boyfriend / girlfriend', value: 'partner' },
    ],
  }, 0);
  addEdge(c1, c2, 'Any');

  // ═══ BRANCH D: CHILD WELFARE / ACS ═══
  const branchDDecision = addNode('decision', 'ACS Situation', {
    description: 'Ask: "Can you tell me more about the situation?"',
  }, 300);

  addEdge(triageId, branchDDecision, "Child's safety or welfare concern");

  const d1 = addNode('question', 'ACS Stage', {
    question: 'Has ACS come to your home? And is there a court date scheduled?',
    options: [
      { label: 'Investigation stage, no court date', value: 'investigation' },
      { label: 'Petition filed, court date scheduled', value: 'court_date' },
    ],
  }, 300);
  addEdge(branchDDecision, d1, 'ACS came to my home');

  // ═══ BRANCH E: PATERNITY ═══
  const branchEDecision = addNode('decision', 'Paternity Role', {
    description: 'Ask: "Are you a mother looking to establish paternity, a father seeking rights, or disputing paternity?"',
  }, 600);

  addEdge(triageId, branchEDecision, 'Paternity');

  // ═══ BRANCH F: ADOPTION & GUARDIANSHIP ═══
  const branchFDecision = addNode('decision', 'Adoption/Guardianship Type', {
    description: 'Ask: "What type of adoption or guardianship matter do you need help with?"',
  }, 900);

  addEdge(triageId, branchFDecision, 'Adoption or guardianship');

  // ═══ BRANCH G: JUVENILE ═══
  const branchGDecision = addNode('decision', 'Juvenile Matter Type', {
    description: 'Ask: "Can you tell me more about the juvenile matter?"',
  }, 1200);

  addEdge(triageId, branchGDecision, 'Juvenile matter');

  // ═══ BRANCH H: OTHER ═══
  const branchHDecision = addNode('decision', 'Other Matter Type', {
    description: 'Ask: "Can you tell me what kind of legal matter you need help with?"',
  }, 1500);

  addEdge(triageId, branchHDecision, 'Something else');

  // ═══ TRANSFER NODE (all branches lead here) ═══
  const transferId = addNode('transfer', 'Transfer to Attorney', {
    message: "Thank you so much for sharing all of that with me. I now have everything the attorney will need to help you effectively. Please hold for just a moment — I'm connecting you now with a member of our legal team.",
    includeNotes: true,
    transferData: ['caller_name', 'phone', 'party_role', 'matter_category', 'petition_type', 'urgency_flag', 'branch_path', 'all_collected_fields'],
  }, 0);

  // Connect all branch endpoints to transfer
  addEdge(a4, transferId, 'Urgent — safety concern');
  addEdge(a4, transferId, 'Routine');
  addEdge(b3, transferId, 'Any');
  addEdge(cUnsafe, transferId, 'Emergency transfer');
  addEdge(c2, transferId, 'Any');
  addEdge(d1, transferId, 'Any');
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
