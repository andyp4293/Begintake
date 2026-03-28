/**
 * Family Court Intake Script
 *
 * Uses the Response node pattern:
 *   Question -> Response (per answer) -> next step
 * This gives each answer its own visible branch in the flow builder.
 */

let nodeCounter = 0;
function nodeId() { return `fi-node-${++nodeCounter}`; }
let edgeCounter = 0;
function edgeId() { return `fi-edge-${++edgeCounter}`; }

export function createFamilyIntakeTemplate() {
  nodeCounter = 0;
  edgeCounter = 0;

  const nodes: any[] = [];
  const edges: any[] = [];

  function addNode(type: string, label: string, config: any) {
    const id = nodeId();
    nodes.push({ id, type, label, config, positionX: 0, positionY: nodes.length * 120, sortOrder: nodes.length });
    return id;
  }

  function addEdge(sourceId: string, targetId: string) {
    const id = edgeId();
    edges.push({ id, sourceNodeId: sourceId, targetNodeId: targetId, label: null, condition: null, sortOrder: edges.length });
  }

  function response(label: string, instruction?: string) {
    return addNode('response', label, { response: label, instruction: instruction || '' });
  }

  // Transfer node declared early so it can be referenced by any branch
  const transferId = addNode('transfer', 'Transfer to Attorney', {
    transferTarget: 'attorney',
    message: "Thank you so much for sharing all of that with me. I've sent everything over to our legal team. They'll review your case and reach out to you as soon as possible.",
    includeNotes: true,
    transferData: ['caller_name', 'phone', 'party_role', 'matter_category', 'petition_type', 'urgency_flag', 'branch_path', 'all_collected_fields'],
  });

  // Separate paralegal transfer for existing clients (bypasses full intake)
  const transferParalegalId = addNode('transfer', 'Transfer to Paralegal', {
    transferTarget: 'paralegal',
    message: "Welcome back! Please hold one moment while I connect you with our team.",
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 0 - OPENING & CALLER IDENTIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  const startId = addNode('start', 'Opening Greeting', {
    greeting: "Good afternoon. Thank you for calling {firm}. My name is {name}, and I'm the firm's intake assistant. I'm going to ask you a few questions so that when I connect you with one of our attorneys, they'll already have everything they need to help you right away. Everything you share is confidential. Shall we get started?",
  });

  // Q1. Shall we get started?
  const q1 = addNode('question', 'Q1. Shall we get started?', { question: 'Shall we get started?' });
  addEdge(startId, q1);

  // Q1b. New or existing client
  const q1b = addNode('question', 'Q1b. New or Existing Client?', {
    question: 'Have you worked with our firm before, or is this your first time reaching out to us?',
    note: 'This helps us route you correctly. Listen for any indication they are a returning client.',
  });

  // Q1 responses - both lead to Q1b
  const q1_yes = response("Yes, let's begin");
  const q1_explain = response("What is this for?", "Briefly explain: \"Of course - I'm going to collect some basic information about you and your situation, then connect you with one of our attorneys who can help. It only takes a few minutes.\"");
  addEdge(q1, q1_yes);
  addEdge(q1_yes, q1b);
  addEdge(q1, q1_explain);
  addEdge(q1_explain, q1b);

  // Q1b responses
  const q1b_existing = response('Existing client - worked with firm before', "Say: \"Welcome back! Let me get you connected with our team right away.\"");
  const q1b_new      = response('New client - first time calling');
  addEdge(q1b, q1b_existing);
  addEdge(q1b_existing, transferParalegalId);   // existing clients → paralegal/reception, not attorney
  addEdge(q1b, q1b_new);

  // Q2. Caller name (collect field, no branching)
  const q2 = addNode('question', 'Q2. Caller Name', {
    question: 'Could I start with your first and last name?',
    collectFields: [{ name: 'caller_name', label: 'First and last name', type: 'text', required: true }],
  });
  addEdge(q1b_new, q2);

  // Q3. Best phone number
  const q3 = addNode('question', 'Q3. Best Number to Reach You', {
    question: "Is the number you're calling from the best number to reach you in case we get disconnected?",
  });
  addEdge(q2, q3);

  // Q4. Self or on behalf of
  const q4 = addNode('question', 'Q4. Self or On Behalf Of', {
    question: 'Are you calling for yourself, or on behalf of someone else?',
  });

  // Q3 responses - both lead to Q4
  const q3_yes = response('Yes, this number is fine', "Note the caller's phone number from the call.");
  const q3_no = response('No, use a different number', "Ask: \"What's the best number to reach you?\" Collect and note the number.");
  addEdge(q3, q3_yes);
  addEdge(q3_yes, q4);
  addEdge(q3, q3_no);
  addEdge(q3_no, q4);

  // Q5. Primary matter triage
  const q5 = addNode('question', 'Q5. What brings you to the firm today?', {
    question: 'What brings you to the firm today?',
  });

  // Q4 responses - both lead to Q5
  const q4_self = response('For myself');
  const q4_family = response('For a family member', 'Ask: "What is your relationship to them? For example, are you a parent, grandparent, or someone else?" Note the relationship.');
  addEdge(q4, q4_self);
  addEdge(q4_self, q5);
  addEdge(q4, q4_family);
  addEdge(q4_family, q5);

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1 - PRIMARY MATTER TRIAGE (Q5 responses -> branches)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── BRANCH A - CUSTODY & VISITATION ─────────────────────────────────────
  const branchARouting = addNode('question', 'Branch A - Custody Order Status', {
    note: 'Is there currently a custody order in place, or would this be a new filing?',
  });
  const q5_a = response('My children - custody or visitation');
  addEdge(q5, q5_a);
  addEdge(q5_a, branchARouting);

  const aNew = addNode('action', 'Flag: V-Petition - new', {
    actionType: 'set_flag', flagName: 'petitionType', flagValue: 'V-Petition (Custody) - new',
  });
  const aMod = addNode('action', 'Flag: V-Petition - modification', {
    actionType: 'set_flag', flagName: 'petitionType', flagValue: 'V-Petition - modification',
    note: 'Substantial change in circumstances required',
  });
  const aViolation = addNode('action', 'Flag: V-Petition - violation/enforcement', {
    actionType: 'set_flag', flagName: 'petitionType', flagValue: 'V-Petition - violation/enforcement',
    note: 'Flag potential contempt/enforcement',
  });

  const branchA_new = response('No order exists');
  const branchA_mod = response('Order exists - want to modify');
  const branchA_viol = response('Order exists - being violated');
  addEdge(branchARouting, branchA_new);   addEdge(branchA_new, aNew);
  addEdge(branchARouting, branchA_mod);   addEdge(branchA_mod, aMod);
  addEdge(branchARouting, branchA_viol);  addEdge(branchA_viol, aViolation);

  const a1 = addNode('question', 'A1. Marital / Relationship Status', {
    question: 'What is your marital or relationship status with the other parent?',
    note: 'Married/divorcing may need Supreme Court referral for divorce',
  });
  addEdge(aNew, a1);
  addEdge(aMod, a1);
  addEdge(aViolation, a1);

  const a2 = addNode('question', 'A2. Type of Custody Sought', {
    question: 'Are you seeking physical custody, legal custody, or both?',
  });
  const a1_married = response('Married or divorcing', 'Note: may need Supreme Court referral for divorce.');
  const a1_never   = response('Never married');
  const a1_sep     = response('Separated or divorced');
  addEdge(a1, a1_married); addEdge(a1_married, a2);
  addEdge(a1, a1_never);   addEdge(a1_never, a2);
  addEdge(a1, a1_sep);     addEdge(a1_sep, a2);

  const a3 = addNode('question', 'A3. Number and Ages of Children', {
    question: 'How many children are involved, and how old are they?',
    collectFields: [
      { name: 'num_children', label: 'How many children are involved', type: 'text', required: true },
      { name: 'children_ages', label: 'Ages of each child', type: 'text', required: true },
    ],
    note: 'If teenager 13-17, court may consider child preference',
  });
  const a2_physical = response('Physical custody (residence)');
  const a2_legal    = response('Legal custody (decision-making)');
  const a2_both     = response('Both / unsure');
  addEdge(a2, a2_physical); addEdge(a2_physical, a3);
  addEdge(a2, a2_legal);    addEdge(a2_legal, a3);
  addEdge(a2, a2_both);     addEdge(a2_both, a3);

  const a4 = addNode('question', 'A4. Urgency / Safety Screen', {
    question: 'Is there an immediate safety concern for you or the children right now?',
    note: 'CRITICAL QUESTION - determines whether emergency application is needed',
  });
  addEdge(a3, a4);

  // ── BRANCH B - CHILD SUPPORT & SPOUSAL MAINTENANCE ──────────────────────
  const branchBRouting = addNode('question', 'Branch B - Support Filing Status', {
    note: "Are you looking to file for support for the first time, modify an existing order, or enforce an order that isn't being followed?",
  });
  const q5_b = response('Child support or spousal support');
  addEdge(q5, q5_b);
  addEdge(q5_b, branchBRouting);

  const bNew     = addNode('action', 'Flag: F-Petition - new', { actionType: 'set_flag', flagName: 'petitionType', flagValue: 'F-Petition (Support) - new' });
  const bMod     = addNode('action', 'Flag: F-Petition - modification', { actionType: 'set_flag', flagName: 'petitionType', flagValue: 'F-Petition - modification', note: 'Must show substantial change in circumstances' });
  const bEnforce = addNode('action', 'Flag: F-Petition - enforcement', { actionType: 'set_flag', flagName: 'petitionType', flagValue: 'F-Petition - violation/enforcement' });

  const branchB_new     = response('New - first time');
  const branchB_mod     = response('Modify existing order');
  const branchB_enforce = response('Enforce - not being paid');
  addEdge(branchBRouting, branchB_new);     addEdge(branchB_new, bNew);
  addEdge(branchBRouting, branchB_mod);     addEdge(branchB_mod, bMod);
  addEdge(branchBRouting, branchB_enforce); addEdge(branchB_enforce, bEnforce);

  const b1 = addNode('question', 'B1. Type of Support', {
    question: 'Are you looking for child support, spousal maintenance, or both?',
  });
  addEdge(bNew, b1); addEdge(bMod, b1); addEdge(bEnforce, b1);

  const b2 = addNode('question', 'B2. Arrears Period (if enforcement)', {
    question: "How long has it been since you last received the support payments you're owed?",
    note: 'Over 1 year = flag significant arrears, possible CSEA referral / income execution',
  });
  const b1_child   = response('Child support only');
  const b1_spousal = response('Spousal maintenance only');
  const b1_both    = response('Both');
  addEdge(b1, b1_child);   addEdge(b1_child, b2);
  addEdge(b1, b1_spousal); addEdge(b1_spousal, b2);
  addEdge(b1, b1_both);    addEdge(b1_both, b2);

  const b3 = addNode('question', 'B3. Party Role', {
    question: 'Are you the one receiving support, or being asked to pay?',
    note: 'Respondent = respondent-side representation',
  });
  const b2_lt3  = response('Less than 3 months');
  const b2_3to12 = response('3 to 12 months');
  const b2_gt1  = response('Over 1 year', 'Flag significant arrears - possible CSEA referral / income execution.');
  addEdge(b2, b2_lt3);   addEdge(b2_lt3, b3);
  addEdge(b2, b2_3to12); addEdge(b2_3to12, b3);
  addEdge(b2, b2_gt1);   addEdge(b2_gt1, b3);

  // ── BRANCH C - FAMILY OFFENSE / ORDER OF PROTECTION ─────────────────────
  const cSafety = addNode('question', 'Branch C - Safety Check', {
    question: 'First, I need to ask - are you in a safe place right now?',
    note: 'SAFETY-FIRST PROTOCOL - caller safety must be confirmed before proceeding',
  });
  const q5_c = response('A family member is threatening or hurting me');
  addEdge(q5, q5_c);
  addEdge(q5_c, cSafety);

  const cEmergency = addNode('action', 'EMERGENCY - Advise 911', {
    actionType: 'set_flag', flagName: 'urgencyFlag', flagValue: 'safety_first',
    petitionType: 'O-Petition - emergency order of protection',
    note: 'EMERGENCY PROTOCOL: Advise caller to call 911 immediately. Offer immediate attorney transfer.',
  });
  const c1 = addNode('question', 'C1. Nature of Conduct', {
    question: 'Can you tell me a little about what has been happening?',
  });

  const cSafety_unsafe = response("No, or I'm not sure", 'EMERGENCY: Advise caller to call 911 immediately. Offer immediate attorney transfer.');
  const cSafety_safe   = response('Yes, I am safe');
  addEdge(cSafety, cSafety_unsafe); addEdge(cSafety_unsafe, cEmergency);
  addEdge(cSafety, cSafety_safe);   addEdge(cSafety_safe, c1);

  const c2 = addNode('question', 'C2. Relationship to Respondent', {
    question: 'What is your relationship to the person who is doing this?',
  });
  const c1_physical   = response('Physical violence or threats');
  const c1_harassment = response('Harassment, stalking, or intimidation');
  const c1_emotional  = response('Emotional / psychological abuse');
  const c1_sexual     = response('Sexual abuse');
  addEdge(c1, c1_physical);   addEdge(c1_physical, c2);
  addEdge(c1, c1_harassment); addEdge(c1_harassment, c2);
  addEdge(c1, c1_emotional);  addEdge(c1_emotional, c2);
  addEdge(c1, c1_sexual);     addEdge(c1_sexual, c2);

  // ── BRANCH D - CHILD WELFARE / ACS ──────────────────────────────────────
  const branchDRouting = addNode('question', 'Branch D - ACS / Child Welfare', {
    note: "Can you tell me more about the situation? Did ACS come to your home, are you concerned about a child elsewhere, or is this a foster care matter?",
  });
  const q5_d = response("A child's safety or welfare concern");
  addEdge(q5, q5_d);
  addEdge(q5_d, branchDRouting);

  const d1 = addNode('question', 'D1. Stage of ACS Involvement', {
    question: 'Has ACS come to your home? And is there a court date scheduled?',
    note: 'If court date imminent, flag URGENT',
  });
  const d2 = addNode('question', 'D2. Foster Care Sub-Branch', {
    question: 'What kind of foster care matter is this?',
  });

  const branchD_acs     = response('ACS came to my home');
  const branchD_child   = response('Concerned about a child elsewhere');
  const branchD_foster  = response('Foster parent legal matter');
  addEdge(branchDRouting, branchD_acs);    addEdge(branchD_acs, d1);
  addEdge(branchDRouting, branchD_child);
  addEdge(branchDRouting, branchD_foster); addEdge(branchD_foster, d2);

  const d1_investigation = response('ACS at investigation stage - no court date yet');
  const d1_court         = response('Petition filed - court date scheduled', 'FLAG URGENT - court date imminent.');
  // both d1 responses lead to connectOrSchedule (added below)

  const d2_placement = response('Extension of placement / permanency hearing');
  const d2_adopt     = response('Foster-to-adopt');
  const d2_dispute   = response('Dispute with agency');
  addEdge(d1, d1_investigation);
  addEdge(d1, d1_court);
  addEdge(d2, d2_placement);
  addEdge(d2, d2_adopt);
  addEdge(d2, d2_dispute);

  // ── BRANCH E - PATERNITY ─────────────────────────────────────────────────
  const branchERouting = addNode('question', 'Branch E - Paternity', {
    note: 'Are you a mother looking to establish paternity, a father seeking parental rights, or someone disputing paternity?',
  });
  const q5_e = response('Paternity - establishing who the father is');
  addEdge(q5, q5_e);
  addEdge(q5_e, branchERouting);

  const branchE_mother = response('Mother seeking to establish');
  const branchE_father = response('Father seeking rights', 'May need to establish paternity first before custody petition.');
  const branchE_dispute = response('Alleged father disputing', 'DNA challenge / Respondent representation.');
  addEdge(branchERouting, branchE_mother);
  addEdge(branchERouting, branchE_father);
  addEdge(branchERouting, branchE_dispute);

  // ── BRANCH F - ADOPTION & GUARDIANSHIP ──────────────────────────────────
  const branchFRouting = addNode('question', 'Branch F - Adoption / Guardianship', {
    note: 'What type of adoption or guardianship matter do you need help with? For example: stepparent adoption, foster-to-adopt, private adoption, kinship adoption, guardianship of a minor, or guardianship of an adult with a disability?',
  });
  const q5_f = response('Adoption or guardianship');
  addEdge(q5, q5_f);
  addEdge(q5_f, branchFRouting);

  const branchF_any = response('Any type');
  addEdge(branchFRouting, branchF_any);

  // ── BRANCH G - JUVENILE ──────────────────────────────────────────────────
  const branchGRouting = addNode('question', 'Branch G - Juvenile Matter', {
    note: 'Can you tell me more about the juvenile matter? Is this about an alleged crime or delinquent act, or about truancy or a child beyond parental control?',
  });
  const q5_g = response('A juvenile matter');
  addEdge(q5, q5_g);
  addEdge(q5_g, branchGRouting);

  const branchG_any = response('Any type');
  addEdge(branchGRouting, branchG_any);

  // ── BRANCH H - OTHER ────────────────────────────────────────────────────
  const branchHRouting = addNode('question', 'Branch H - Other Legal Matter', {
    note: 'Can you tell me what kind of legal matter you need help with? For example: name change, termination of parental rights, Special Immigrant Juvenile Status (SIJS), or something else?',
  });
  const q5_h = response('Something else');
  addEdge(q5, q5_h);
  addEdge(q5_h, branchHRouting);

  const branchH_any = response('Any type');
  addEdge(branchHRouting, branchH_any);

  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSFER PROTOCOL - HANDOFF TO ATTORNEY (node declared at top of function)
  // ═══════════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCH ENDPOINTS → all route directly to Transfer
  // ═══════════════════════════════════════════════════════════════════════════

  // A4 urgency: both paths go to transfer (urgent is flagged, routine checks availability)
  const a4_urgent  = response('Yes - immediate safety concern', 'FLAG URGENT. Say: "I understand - your safety is the priority. Let me get you connected with an attorney right away."');
  const a4_routine = response('No - routine matter');
  addEdge(a4, a4_urgent);  addEdge(a4_urgent, transferId);
  addEdge(a4, a4_routine); addEdge(a4_routine, transferId);

  // Emergency (Branch C) - direct transfer
  addEdge(cEmergency, transferId);

  // C2 responses
  const c2_spouse   = response('Spouse or former spouse');
  const c2_coparent = response('Co-parent or parent of my child');
  const c2_family   = response('Parent or sibling (family member)');
  const c2_partner  = response('Intimate partner / boyfriend / girlfriend');
  addEdge(c2, c2_spouse);   addEdge(c2_spouse, transferId);
  addEdge(c2, c2_coparent); addEdge(c2_coparent, transferId);
  addEdge(c2, c2_family);   addEdge(c2_family, transferId);
  addEdge(c2, c2_partner);  addEdge(c2_partner, transferId);

  // B3 responses
  const b3_petitioner  = response('Receiving support (Petitioner)');
  const b3_respondent  = response('Being asked to pay (Respondent)', 'Note: respondent-side representation.');
  addEdge(b3, b3_petitioner);  addEdge(b3_petitioner, transferId);
  addEdge(b3, b3_respondent);  addEdge(b3_respondent, transferId);

  // D1 responses
  addEdge(d1_investigation, transferId);
  addEdge(d1_court, transferId);

  // D2 responses
  addEdge(d2_placement, transferId);
  addEdge(d2_adopt, transferId);
  addEdge(d2_dispute, transferId);

  // Branch D "concerned about child elsewhere"
  addEdge(branchD_child, transferId);

  // Branch E responses
  addEdge(branchE_mother, transferId);
  addEdge(branchE_father, transferId);
  addEdge(branchE_dispute, transferId);

  // Branch F, G, H
  addEdge(branchF_any, transferId);
  addEdge(branchG_any, transferId);
  addEdge(branchH_any, transferId);

  return {
    name: 'Family Court Intake',
    description: 'Complete AI intake script for prospective family law clients. Uses {firm} and {name} variables. Covers custody, support, family offense, child welfare, paternity, adoption, juvenile, and miscellaneous matters.',
    isTemplate: true,
    nodes,
    edges,
  };
}
