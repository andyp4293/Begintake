/**
 * Anderson Bowman PLLC - AI Receptionist Intake Script
 * Family Court Practice Group - Kew Gardens, New York
 *
 * This template encodes the full 9-page intake script as a flow graph.
 * Labels match the attorney review document exactly:
 *   Section 0: Q1–Q4 (Opening & Caller Identification)
 *   Section 1: Q5 (Primary Matter Triage)
 *   Branch A: A1–A4 (Custody & Visitation)
 *   Branch B: B1–B3 (Child Support & Spousal Maintenance)
 *   Branch C: C1–C2 (Family Offense / Order of Protection)
 *   Branch D: D1–D2 (Child Welfare / ACS)
 *   Branch E: Paternity routing
 *   Branch F: Adoption & Guardianship routing
 *   Branch G: Juvenile Delinquency & PINS routing
 *   Branch H: Other / Miscellaneous routing
 *   Transfer Protocol
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

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 0 - OPENING & CALLER IDENTIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  const startId = addNode('start', 'Opening Greeting', {
    greeting: "Good afternoon. Thank you for calling {firm}. My name is {name}, and I'm the firm's intake assistant. I'm going to ask you a few questions so that when I connect you with one of our attorneys, they'll already have everything they need to help you right away. Everything you share is confidential. Shall we get started?",
  });

  // Q1. Shall we get started?
  const q1 = addNode('question', 'Q1. Shall we get started?', {
    question: 'Shall we get started?',
    options: [
      { label: 'Yes, let\'s begin', value: 'yes', instruction: 'Proceed to Q2.' },
      { label: 'What is this for?', value: 'explain', instruction: 'Briefly explain: "Of course - I\'m going to collect some basic information about you and your situation, then connect you with one of our attorneys who can help. It only takes a few minutes." Then proceed to Q2.' },
    ],
  });
  addEdge(startId, q1);

  // Q2. May I have your first and last name?
  const q2 = addNode('question', 'Q2. Caller Name', {
    question: 'Could I start with your first and last name?',
    options: [],
    collectFields: [
      { name: 'caller_name', label: 'First and last name', type: 'text', required: true },
    ],
  });
  addEdge(q1, q2, 'Continue');

  // Q3. Best phone number to reach you?
  const q3 = addNode('question', 'Q3. Best Number to Reach You', {
    question: 'Is the number you\'re calling from the best number to reach you in case we get disconnected?',
    options: [
      { label: 'Yes, this number is fine', value: 'yes', instruction: 'Note: use the caller\'s phone number from the call. Proceed to Q4.' },
      { label: 'No, use a different number', value: 'no', instruction: 'Ask: "What\'s the best number to reach you?" Collect and note the number, then proceed to Q4.' },
    ],
  });
  addEdge(q2, q3);

  // Q4. Calling for yourself or someone else?
  const q4 = addNode('question', 'Q4. Self or On Behalf Of', {
    question: 'Are you calling for yourself, or on behalf of someone else?',
    options: [
      { label: 'For myself', value: 'self', instruction: 'Proceed to Q5.' },
      { label: 'For a family member', value: 'family', instruction: 'Ask follow-up: "What is your relationship to them? For example, are you a parent, grandparent, or someone else?" Note the relationship, then proceed to Q5.' },
    ],
  });
  addEdge(q3, q4);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1 - PRIMARY MATTER TRIAGE
  // ═══════════════════════════════════════════════════════════════════════════

  // Q5. What brings you to the firm today?
  const q5 = addNode('question', 'Q5. What brings you to the firm today?', {
    question: 'What brings you to the firm today?',
    options: [
      { label: 'My children - custody or visitation', value: 'A' },
      { label: 'Child support or spousal support', value: 'B' },
      { label: 'A family member is threatening or hurting me', value: 'C' },
      { label: 'A child\'s safety or welfare concern', value: 'D' },
      { label: 'Paternity - establishing who the father is', value: 'E' },
      { label: 'Adoption or guardianship', value: 'F' },
      { label: 'A juvenile matter', value: 'G' },
      { label: 'Something else', value: 'H' },
    ],
    allowFreeform: true,
  });
  addEdge(q4, q5);

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCH A - CUSTODY & VISITATION [V-Petition, FCA Art. 6]
  // ═══════════════════════════════════════════════════════════════════════════

  // Routing table: custody order status
  const branchARouting = addNode('decision', 'Branch A - Custody Order Status', {
    description: 'Is there currently a custody order in place, or would this be a new filing?',
  }, -600);
  addEdge(q5, branchARouting, 'Custody or visitation');

  const aNew = addNode('action', 'Flag: V-Petition - new', {
    actionType: 'set_flag', flagName: 'petitionType', flagValue: 'V-Petition (Custody) - new',
  }, -600);

  const aMod = addNode('action', 'Flag: V-Petition - modification', {
    actionType: 'set_flag', flagName: 'petitionType', flagValue: 'V-Petition - modification',
    note: 'Substantial change in circumstances required',
  }, -400);

  const aViolation = addNode('action', 'Flag: V-Petition - violation/enforcement', {
    actionType: 'set_flag', flagName: 'petitionType', flagValue: 'V-Petition - violation/enforcement',
    note: 'Flag potential contempt/enforcement',
  }, -200);

  addEdge(branchARouting, aNew, 'No order exists');
  addEdge(branchARouting, aMod, 'Order exists - want to modify');
  addEdge(branchARouting, aViolation, 'Order exists - being violated');

  // A1. Marital / Relationship Status
  const a1 = addNode('question', 'A1. Marital / Relationship Status', {
    question: 'What is your marital or relationship status with the other parent?',
    options: [
      { label: 'Married or divorcing', value: 'married' },
      { label: 'Never married', value: 'never_married' },
      { label: 'Separated or divorced', value: 'separated' },
    ],
    note: 'Married/divorcing may need Supreme Court referral for divorce',
  }, -600);
  addEdge(aNew, a1);
  addEdge(aMod, a1);
  addEdge(aViolation, a1);

  // A2. Type of Custody Sought
  const a2 = addNode('question', 'A2. Type of Custody Sought', {
    question: 'Are you seeking physical custody, legal custody, or both?',
    options: [
      { label: 'Physical custody (residence)', value: 'physical' },
      { label: 'Legal custody (decision-making)', value: 'legal' },
      { label: 'Both / unsure', value: 'both' },
    ],
  }, -600);
  addEdge(a1, a2);

  // A3. Number and Ages of Children
  const a3 = addNode('question', 'A3. Number and Ages of Children', {
    question: 'How many children are involved, and how old are they?',
    options: [],
    collectFields: [
      { name: 'num_children', label: 'How many children are involved', type: 'text', required: true },
      { name: 'children_ages', label: 'Ages of each child', type: 'text', required: true },
    ],
    note: 'If teenager 13-17, court may consider child preference',
  }, -600);
  addEdge(a2, a3);

  // A4. Urgency / Safety Screen
  const a4 = addNode('question', 'A4. Urgency / Safety Screen', {
    question: 'Is there an immediate safety concern for you or the children right now?',
    options: [
      { label: 'Yes - immediate safety concern', value: 'urgent', instruction: 'FLAG URGENT. Say: "I understand - your safety is the priority. Let me get you connected with an attorney right away." Proceed immediately to Transfer.' },
      { label: 'No - routine matter', value: 'routine', instruction: 'Proceed to Transfer.' },
    ],
    note: 'CRITICAL QUESTION - determines whether emergency application is needed',
  }, -600);
  addEdge(a3, a4);

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCH B - CHILD SUPPORT & SPOUSAL MAINTENANCE [F-Petition, FCA Art. 4]
  // ═══════════════════════════════════════════════════════════════════════════

  // Routing table: support filing status
  const branchBRouting = addNode('decision', 'Branch B - Support Filing Status', {
    description: 'Are you looking to file for support for the first time, modify an existing order, or enforce an order that isn\'t being followed?',
  }, -300);
  addEdge(q5, branchBRouting, 'Child support or spousal support');

  const bNew = addNode('action', 'Flag: F-Petition - new', {
    actionType: 'set_flag', flagName: 'petitionType', flagValue: 'F-Petition (Support) - new',
  }, -300);

  const bMod = addNode('action', 'Flag: F-Petition - modification', {
    actionType: 'set_flag', flagName: 'petitionType', flagValue: 'F-Petition - modification',
    note: 'Must show substantial change in circumstances',
  }, -200);

  const bEnforce = addNode('action', 'Flag: F-Petition - enforcement', {
    actionType: 'set_flag', flagName: 'petitionType', flagValue: 'F-Petition - violation/enforcement',
  }, -100);

  addEdge(branchBRouting, bNew, 'New - first time');
  addEdge(branchBRouting, bMod, 'Modify existing order');
  addEdge(branchBRouting, bEnforce, 'Enforce - not being paid');

  // B1. Type of Support
  const b1 = addNode('question', 'B1. Type of Support', {
    question: 'Are you looking for child support, spousal maintenance, or both?',
    options: [
      { label: 'Child support only', value: 'child' },
      { label: 'Spousal maintenance only', value: 'spousal' },
      { label: 'Both', value: 'both' },
    ],
  }, -300);
  addEdge(bNew, b1);
  addEdge(bMod, b1);
  addEdge(bEnforce, b1);

  // B2. Arrears (enforcement matters only)
  const b2 = addNode('question', 'B2. Arrears Period (if enforcement)', {
    question: 'How long has it been since you last received the support payments you\'re owed?',
    options: [
      { label: 'Less than 3 months', value: 'lt3mo' },
      { label: '3 to 12 months', value: '3to12mo' },
      { label: 'Over 1 year', value: 'gt1yr' },
    ],
    note: 'Over 1 year = flag significant arrears, possible CSEA referral / income execution',
  }, -300);
  addEdge(b1, b2);

  // B3. Party Role
  const b3 = addNode('question', 'B3. Party Role', {
    question: 'Are you the one receiving support, or being asked to pay?',
    options: [
      { label: 'Receiving support (Petitioner)', value: 'petitioner' },
      { label: 'Being asked to pay (Respondent)', value: 'respondent' },
    ],
    note: 'Respondent = respondent-side representation',
  }, -300);
  addEdge(b2, b3);

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCH C - FAMILY OFFENSE / ORDER OF PROTECTION [O-Petition, FCA Art. 8]
  // SAFETY-FIRST PROTOCOL
  // ═══════════════════════════════════════════════════════════════════════════

  // Safety check (before any other questions)
  const cSafety = addNode('question', 'Branch C - Safety Check', {
    question: 'First, I need to ask - are you in a safe place right now?',
    options: [
      { label: 'Yes, I am safe', value: 'safe' },
      { label: 'No, or I\'m not sure', value: 'unsafe' },
    ],
    note: 'SAFETY-FIRST PROTOCOL - caller safety must be confirmed before proceeding',
  }, 0);
  addEdge(q5, cSafety, 'Family member threatening or hurting me');

  const cEmergency = addNode('action', 'EMERGENCY - Advise 911', {
    actionType: 'set_flag', flagName: 'urgencyFlag', flagValue: 'safety_first',
    petitionType: 'O-Petition - emergency order of protection',
    note: 'EMERGENCY PROTOCOL: Advise caller to call 911 immediately. Offer immediate attorney transfer.',
  }, 100);
  addEdge(cSafety, cEmergency, 'Not safe / unsure');

  // C1. Nature of Conduct
  const c1 = addNode('question', 'C1. Nature of Conduct', {
    question: 'Can you tell me a little about what has been happening?',
    options: [
      { label: 'Physical violence or threats', value: 'physical' },
      { label: 'Harassment, stalking, or intimidation', value: 'harassment' },
      { label: 'Emotional / psychological abuse', value: 'emotional' },
      { label: 'Sexual abuse', value: 'sexual' },
    ],
  }, 0);
  addEdge(cSafety, c1, 'Caller is safe');

  // C2. Relationship to Respondent
  const c2 = addNode('question', 'C2. Relationship to Respondent', {
    question: 'What is your relationship to the person who is doing this?',
    options: [
      { label: 'Spouse or former spouse', value: 'spouse' },
      { label: 'Co-parent or parent of my child', value: 'coparent' },
      { label: 'Parent or sibling (family member)', value: 'family' },
      { label: 'Intimate partner / boyfriend / girlfriend', value: 'partner' },
    ],
  }, 0);
  addEdge(c1, c2);

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCH D - CHILD WELFARE / ACS [N-Petition / A-Petition, FCA Art. 10]
  // ═══════════════════════════════════════════════════════════════════════════

  const branchDRouting = addNode('decision', 'Branch D - ACS / Child Welfare', {
    description: 'Can you tell me more about the situation? Did ACS come to your home, are you concerned about a child elsewhere, or is this a foster care matter?',
  }, 300);
  addEdge(q5, branchDRouting, 'Child\'s safety or welfare concern');

  // D1. Stage of ACS Involvement
  const d1 = addNode('question', 'D1. Stage of ACS Involvement', {
    question: 'Has ACS come to your home? And is there a court date scheduled?',
    options: [
      { label: 'ACS at investigation stage - no court date yet', value: 'investigation' },
      { label: 'Petition filed - court date scheduled', value: 'court_date' },
    ],
    note: 'If court date imminent, flag URGENT',
  }, 300);
  addEdge(branchDRouting, d1, 'ACS came to my home');

  // D2. Foster Care Sub-Branch
  const d2 = addNode('question', 'D2. Foster Care Sub-Branch', {
    question: 'What kind of foster care matter is this?',
    options: [
      { label: 'Extension of placement / permanency hearing', value: 'placement' },
      { label: 'Foster-to-adopt', value: 'foster_adopt' },
      { label: 'Dispute with agency', value: 'agency_dispute' },
    ],
  }, 400);
  addEdge(branchDRouting, d2, 'Foster parent legal matter');

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCH E - PATERNITY [P-Petition, FCA Art. 5]
  // ═══════════════════════════════════════════════════════════════════════════

  const branchERouting = addNode('decision', 'Branch E - Paternity', {
    description: 'Are you a mother looking to establish paternity, a father seeking parental rights, or someone disputing paternity?',
  }, 600);
  addEdge(q5, branchERouting, 'Paternity');

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCH F - ADOPTION & GUARDIANSHIP
  // ═══════════════════════════════════════════════════════════════════════════

  const branchFRouting = addNode('decision', 'Branch F - Adoption / Guardianship', {
    description: 'What type of adoption or guardianship matter do you need help with? For example: stepparent adoption, foster-to-adopt, private adoption, kinship adoption, guardianship of a minor, or guardianship of an adult with a disability?',
  }, 900);
  addEdge(q5, branchFRouting, 'Adoption or guardianship');

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCH G - JUVENILE DELINQUENCY & PINS [D-Petition / PINS, FCA Art. 3 & 7]
  // ═══════════════════════════════════════════════════════════════════════════

  const branchGRouting = addNode('decision', 'Branch G - Juvenile Matter', {
    description: 'Can you tell me more about the juvenile matter? Is this about an alleged crime or delinquent act, or about truancy or a child beyond parental control?',
  }, 1200);
  addEdge(q5, branchGRouting, 'Juvenile matter');

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCH H - OTHER / MISCELLANEOUS
  // ═══════════════════════════════════════════════════════════════════════════

  const branchHRouting = addNode('decision', 'Branch H - Other Legal Matter', {
    description: 'Can you tell me what kind of legal matter you need help with? For example: name change, termination of parental rights, Special Immigrant Juvenile Status (SIJS), or something else?',
  }, 1500);
  addEdge(q5, branchHRouting, 'Something else');

  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSFER PROTOCOL - HANDOFF TO ATTORNEY
  // ═══════════════════════════════════════════════════════════════════════════

  const transferId = addNode('transfer', 'Transfer to Attorney', {
    message: "Thank you so much for sharing all of that with me. I now have everything the attorney will need to help you effectively. Please hold for just a moment - I'm connecting you now with a member of our legal team.",
    includeNotes: true,
    transferData: ['caller_name', 'phone', 'party_role', 'matter_category', 'petition_type', 'urgency_flag', 'branch_path', 'all_collected_fields'],
  }, 0);

  // ═══════════════════════════════════════════════════════════════════════════
  // CONNECT OR SCHEDULE - offered before every non-emergency transfer
  // ═══════════════════════════════════════════════════════════════════════════

  const connectOrSchedule = addNode('question', 'Connect or Schedule?', {
    question: 'Would you prefer to speak with an attorney right now, or would you like to schedule a consultation for a later time?',
    options: [
      { label: 'Connect me now', value: 'now', instruction: 'Proceed to transfer immediately.' },
      { label: 'Schedule a consultation', value: 'schedule', instruction: 'Proceed to book an appointment.' },
    ],
  }, 0);

  // ═══════════════════════════════════════════════════════════════════════════
  // APPOINTMENT BOOKING PATH
  // ═══════════════════════════════════════════════════════════════════════════

  const appointmentNode = addNode('action', 'Book Consultation', {
    actionType: 'book_appointment',
    note: 'Call the bookAppointment tool with the caller name, phone number, matter category, and petition type. Read back the confirmed date and time to the caller.',
  }, 200);

  const nothingElseNode = addNode('question', 'Anything Else?', {
    question: 'Is there anything else I can help you with today?',
    options: [
      { label: 'No, that is all', value: 'no', instruction: 'Thank them warmly and proceed to end the call.' },
      { label: 'Yes, I have another question', value: 'yes', instruction: 'Address their question briefly, then proceed to end the call.' },
    ],
  }, 200);

  const endAfterSchedule = addNode('end', 'End - After Scheduling', {
    closingMessage: 'Wonderful. We look forward to speaking with you at your consultation. Have a great day. Goodbye!',
  }, 200);

  // Appointment booking chain
  addEdge(appointmentNode, nothingElseNode);
  addEdge(nothingElseNode, endAfterSchedule, 'No, that is all');
  addEdge(nothingElseNode, endAfterSchedule, 'Yes, I have another question');

  // Connect or Schedule routing
  addEdge(connectOrSchedule, transferId, 'Connect me now');
  addEdge(connectOrSchedule, appointmentNode, 'Schedule a consultation');

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCH ENDPOINTS
  // Emergency paths bypass scheduling and go directly to transfer
  // All routine paths go through Connect or Schedule first
  // ═══════════════════════════════════════════════════════════════════════════

  // Branch A - urgent bypasses scheduling, routine goes through it
  addEdge(a4, transferId, 'Urgent - emergency custody');
  addEdge(a4, connectOrSchedule, 'Routine - proceed to transfer');

  // Emergency (Branch C) - always direct transfer, no scheduling
  addEdge(cEmergency, transferId, 'Emergency transfer');

  // All other branch endpoints route through Connect or Schedule
  addEdge(b3, connectOrSchedule, 'Proceed to transfer');
  addEdge(c2, connectOrSchedule, 'Proceed to transfer');
  addEdge(d1, connectOrSchedule, 'Proceed to transfer');
  addEdge(d2, connectOrSchedule, 'Proceed to transfer');
  addEdge(branchDRouting, connectOrSchedule, 'Concerned about child elsewhere');
  addEdge(branchERouting, connectOrSchedule, 'Mother seeking to establish');
  addEdge(branchERouting, connectOrSchedule, 'Father seeking rights');
  addEdge(branchERouting, connectOrSchedule, 'Alleged father disputing');
  addEdge(branchFRouting, connectOrSchedule, 'Any type');
  addEdge(branchGRouting, connectOrSchedule, 'Any type');
  addEdge(branchHRouting, connectOrSchedule, 'Any type');

  return {
    name: 'Family Court Intake Example',
    description: 'Complete AI intake script for prospective family law clients. Uses {firm} and {name} variables. Covers custody, support, family offense, child welfare, paternity, adoption, juvenile, and miscellaneous matters.',
    isTemplate: true,
    nodes,
    edges,
  };
}
