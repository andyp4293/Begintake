/**
 * General Legal Intake Template
 * Covers all 13 practice areas:
 * Family, Criminal, Immigration, Personal Injury, Corporate,
 * Real Estate, Employment, Bankruptcy, Tax, Estate Planning,
 * Intellectual Property, Civil Rights, Environmental
 */

let nc = 0;
function nodeId() { return `gi-node-${++nc}`; }
let ec = 0;
function edgeId() { return `gi-edge-${++ec}`; }

const GENERAL_INTAKE_ALWAYS_EXPANDED_QUESTION_LABELS = new Set([
  'Q1. Shall we get started?',
  'Q1b. New or Existing Client?',
  'Q2. Caller Name',
  'Q3. Best Phone Number',
  'Q4. Self or On Behalf Of',
  "Q5. Tell Me What's Going On",
]);

export function createGeneralIntakeTemplate() {
  nc = 0; ec = 0;
  const nodes: any[] = [];
  const edges: any[] = [];

  function addNode(type: string, label: string, config: any) {
    const id = nodeId();
    const resolvedConfig = type === 'question' && !GENERAL_INTAKE_ALWAYS_EXPANDED_QUESTION_LABELS.has(label)
      ? { ...config, defaultCollapsed: config?.defaultCollapsed ?? true }
      : config;
    nodes.push({ id, type, label, config: resolvedConfig, positionX: 0, positionY: nodes.length * 120, sortOrder: nodes.length });
    return id;
  }
  function addEdge(src: string, tgt: string) {
    edges.push({ id: edgeId(), sourceNodeId: src, targetNodeId: tgt, label: null, condition: null, sortOrder: edges.length });
  }
  function resp(label: string, instruction = '') {
    return addNode('response', label, { response: label, instruction });
  }
  // Q5 triage responses: short label for the card title, full text in config.response for the AI
  function q5r(shortLabel: string, fullResponse: string, instruction: string) {
    return addNode('response', shortLabel, { response: fullResponse, instruction });
  }

  // ═══════════════════════════════════════════════════════════════
  // SHARED ENDPOINTS (created first so all branches can reference)
  // ═══════════════════════════════════════════════════════════════

  const transferId = addNode('transfer', 'Transfer to Attorney', {
    transferTarget: 'attorney',
    handoffMode: 'summary_only',
    callbackMessage: 'Thank you. I wrote down everything you shared with me today so I can pass this to the right lawyer for your case. They will review it and call you back at the best callback number I have for you.',
    message: 'Thank you. I wrote down everything you shared with me today so I can pass this to the right lawyer for your case. They will review it and call you back at the best callback number I have for you.',
    includeNotes: true,
    transferData: ['caller_name', 'phone', 'party_role', 'practice_area', 'matter_type', 'urgency_flag', 'all_collected_fields'],
  });

  // Separate paralegal transfer for existing clients (bypasses full intake)
  const transferParalegalId = addNode('transfer', 'Transfer to Paralegal', {
    transferTarget: 'paralegal',
    handoffMode: 'live_transfer',
    callbackMessage: "Welcome back. I've sent this to our team, and the right lawyer will reach out to you shortly.",
  });

  // ═══════════════════════════════════════════════════════════════
  // OPENING & CALLER IDENTIFICATION
  // ═══════════════════════════════════════════════════════════════

  const startId = addNode('start', 'Opening Greeting', {
    greeting: "Thank you for calling {firm}. I am the AI assistant, {name}, and I'll ask you a few questions to figure out how we can best help you. You may request to get transferred to a paralegal at any time.",
  });

  const q1 = addNode('question', 'Q1. Shall we get started?', { question: 'Shall we get started?' });
  addEdge(startId, q1);

  // Q1b. New or existing client
  const q1b = addNode('question', 'Q1b. New or Existing Client?', {
    question: 'Have you worked with our firm before, or is this your first time reaching out to us?',
    note: "This helps us route you correctly. Listen for any indication they are a returning client.",
  });

  const q1_yes  = resp("Yes, let's begin");
  const q1_what = resp('What is this for?', "Briefly explain: \"I'll collect some basic information about your situation so the right lawyer can review it. After that, they'll reach out to you about next steps. It only takes a few minutes.\"");
  addEdge(q1, q1_yes);  addEdge(q1_yes, q1b);
  addEdge(q1, q1_what); addEdge(q1_what, q1b);

  // Q1b responses
  const q1b_existing = resp('Existing client - worked with firm before');
  const q1b_new      = resp('New client - first time calling');
  addEdge(q1b, q1b_existing); addEdge(q1b_existing, transferParalegalId);
  addEdge(q1b, q1b_new);

  const q2 = addNode('question', 'Q2. Caller Name', {
    question: 'Could I start with your first and last name?',
    collectFields: [{ name: 'caller_name', label: 'First and last name', type: 'text', required: true }],
  });
  addEdge(q1b_new, q2);

  const q3 = addNode('question', 'Q3. Best Phone Number', {
    question: "Is the number you're calling from the best number to reach you if we get disconnected?",
  });
  addEdge(q2, q3);

  const q3a = addNode('question', 'Q3A. Callback Number', {
    question: 'What is the best callback number for you?',
    collectFields: [{ name: 'callback_phone', label: 'Best callback number', type: 'text', required: true }],
  });

  const q4 = addNode('question', 'Q4. Self or On Behalf Of', {
    question: 'Are you calling for yourself, or on behalf of someone else?',
  });
  const q3_yes = resp('Yes, this number is fine', "Note the caller's phone number from the call.");
  const q3_no = resp('No, use a different number', "Ask: \"What's the best number to reach you?\" Collect and note it.");
  addEdge(q3, q3_yes); addEdge(q3_yes, q4);
  addEdge(q3, q3_no); addEdge(q3_no, q3a); addEdge(q3a, q4);

  const q5 = addNode('question', 'Q5. Tell Me What\'s Going On', {
    note: 'Ask the caller to describe their situation in their own words. Be warm and inviting - say something like "Thanks. Can you tell me a little about what\'s been going on?" Do NOT read a list of legal categories. Listen carefully, ask gentle follow-up questions if needed ("How long has this been going on?" or "Can you tell me a little more about that?"). Once you understand the situation, silently route to the correct practice area branch. The caller should feel heard, not processed.',
  });
  const q4_self = resp('For myself');
  const q4_other = resp('On behalf of someone else', 'Ask: "What is your relationship to them?" Note it.');
  addEdge(q4, q4_self); addEdge(q4_self, q5);
  addEdge(q4, q4_other); addEdge(q4_other, q5);

  // ═══════════════════════════════════════════════════════════════
  // BRANCH 1 — FAMILY LAW
  // ═══════════════════════════════════════════════════════════════

  const famTriage = addNode('question', 'Family Law - Matter Triage', {
    note: 'What brings you to us today regarding your family matter?',
  });
  // AI routes here when caller describes: custody, divorce, child support, alimony,
  // domestic violence, child welfare, adoption, guardianship, paternity, or juvenile matters.
  const q5_fam = q5r(
    'Family Law',
    "Caller's situation involves family law",
    'Route here only when you know the caller needs family law help but the specific family matter is still unclear.',
  );
  addEdge(q5, q5_fam); addEdge(q5_fam, famTriage);

  // --- Custody & Visitation ---
  const famACustodyRouting = addNode('question', 'FA - Custody Order Status', {
    note: 'Is there currently a custody order in place?',
  });
  const famA_q5 = resp('Custody or visitation of my children');
  addEdge(famTriage, famA_q5); addEdge(famA_q5, famACustodyRouting);

  const famA_new   = addNode('action', 'Flag: V-Petition - new',          { actionType: 'set_flag', flagName: 'petitionType', flagValue: 'V-Petition (Custody) - new' });
  const famA_mod   = addNode('action', 'Flag: V-Petition - modification',  { actionType: 'set_flag', flagName: 'petitionType', flagValue: 'V-Petition - modification', note: 'Substantial change in circumstances required' });
  const famA_viol  = addNode('action', 'Flag: V-Petition - enforcement',   { actionType: 'set_flag', flagName: 'petitionType', flagValue: 'V-Petition - violation/enforcement', note: 'Flag potential contempt' });

  const famAR_new  = resp('No order exists - new petition');
  const famAR_mod  = resp('Order exists - want to modify');
  const famAR_viol = resp('Order exists - being violated');
  addEdge(famACustodyRouting, famAR_new);  addEdge(famAR_new,  famA_new);
  addEdge(famACustodyRouting, famAR_mod);  addEdge(famAR_mod,  famA_mod);
  addEdge(famACustodyRouting, famAR_viol); addEdge(famAR_viol, famA_viol);

  const famA1 = addNode('question', 'FA1. Marital / Relationship Status', {
    question: 'What is your marital or relationship status with the other parent?',
    note: 'Married/divorcing may need Supreme Court referral',
  });
  addEdge(famA_new, famA1); addEdge(famA_mod, famA1); addEdge(famA_viol, famA1);

  const famA2 = addNode('question', 'FA2. Type of Custody Sought', {
    question: 'Are you seeking physical custody, legal custody, or both?',
  });
  const famA1_married = resp('Married or divorcing', 'Note: may need Supreme Court referral for divorce.');
  const famA1_never   = resp('Never married');
  const famA1_sep     = resp('Separated or divorced');
  addEdge(famA1, famA1_married); addEdge(famA1_married, famA2);
  addEdge(famA1, famA1_never);   addEdge(famA1_never,   famA2);
  addEdge(famA1, famA1_sep);     addEdge(famA1_sep,     famA2);

  const famA3 = addNode('question', 'FA3. Children - Number and Ages', {
    question: 'How many children are involved, and how old are they?',
    collectFields: [
      { name: 'num_children',   label: 'Number of children involved', type: 'text', required: true },
      { name: 'children_ages',  label: 'Ages of each child',          type: 'text', required: true },
    ],
    note: 'If teenager 13-17, court may consider child preference',
  });
  const famA2_phys = resp('Physical custody (residence)');
  const famA2_legal = resp('Legal custody (decision-making)');
  const famA2_both  = resp('Both / unsure');
  addEdge(famA2, famA2_phys);  addEdge(famA2_phys,  famA3);
  addEdge(famA2, famA2_legal); addEdge(famA2_legal, famA3);
  addEdge(famA2, famA2_both);  addEdge(famA2_both,  famA3);

  const famA4 = addNode('question', 'FA4. Urgency / Safety Screen', {
    question: 'Is there an immediate safety concern for you or the children right now?',
    note: 'CRITICAL - determines whether emergency application is needed',
  });
  addEdge(famA3, famA4);
  const famA4_urgent  = resp('Yes - immediate safety concern', 'FLAG URGENT. Say: "Your safety is the priority. I am sending this to the right lawyer for immediate review now." Proceed immediately to the follow-up step.');
  const famA4_routine = resp('No - routine matter');
  addEdge(famA4, famA4_urgent);  addEdge(famA4_urgent,  transferId);
  addEdge(famA4, famA4_routine); addEdge(famA4_routine, transferId);

  // --- Support ---
  const famBSupportRouting = addNode('question', 'FB - Support Filing Status', {
    note: 'Is this a new support matter, a modification, or enforcement?',
  });
  const famB_q5 = resp('Child support or spousal support');
  addEdge(famTriage, famB_q5); addEdge(famB_q5, famBSupportRouting);

  const famB_new    = addNode('action', 'Flag: F-Petition - new',         { actionType: 'set_flag', flagName: 'petitionType', flagValue: 'F-Petition (Support) - new' });
  const famB_mod    = addNode('action', 'Flag: F-Petition - modification', { actionType: 'set_flag', flagName: 'petitionType', flagValue: 'F-Petition - modification', note: 'Substantial change in circumstances required' });
  const famB_enf    = addNode('action', 'Flag: F-Petition - enforcement',  { actionType: 'set_flag', flagName: 'petitionType', flagValue: 'F-Petition - violation/enforcement' });

  const famBR_new = resp('New - first time'); const famBR_mod = resp('Modify existing order'); const famBR_enf = resp('Enforce - not being paid');
  addEdge(famBSupportRouting, famBR_new); addEdge(famBR_new, famB_new);
  addEdge(famBSupportRouting, famBR_mod); addEdge(famBR_mod, famB_mod);
  addEdge(famBSupportRouting, famBR_enf); addEdge(famBR_enf, famB_enf);

  const famB1 = addNode('question', 'FB1. Type of Support', { question: 'Are you looking for child support, spousal maintenance, or both?' });
  addEdge(famB_new, famB1); addEdge(famB_mod, famB1); addEdge(famB_enf, famB1);

  const famB2 = addNode('question', 'FB2. Arrears Period', {
    question: 'If someone owes you support, how long has it been since you last received a payment?',
    note: 'Ask this only when the caller is the one receiving support. Over 1 year = flag significant arrears - possible CSEA referral.',
  });
  const famB1_child = resp('Child support only'); const famB1_sp = resp('Spousal maintenance only'); const famB1_both = resp('Both');

  const famB3 = addNode('question', 'FB3. Party Role', {
    question: 'Are you the one receiving support, or being asked to pay?',
    note: 'Respondent = respondent-side representation',
  });
  addEdge(famB1, famB1_child); addEdge(famB1_child, famB3);
  addEdge(famB1, famB1_sp);    addEdge(famB1_sp,    famB3);
  addEdge(famB1, famB1_both);  addEdge(famB1_both,  famB3);
  const famB2_lt3 = resp('Less than 3 months'); const famB2_mid = resp('3 to 12 months'); const famB2_gt1 = resp('Over 1 year', 'Flag significant arrears.');
  addEdge(famB2, famB2_lt3); addEdge(famB2_lt3, transferId);
  addEdge(famB2, famB2_mid); addEdge(famB2_mid, transferId);
  addEdge(famB2, famB2_gt1); addEdge(famB2_gt1, transferId);
  const famB3_pet = resp('Receiving support (Petitioner)'); const famB3_res = resp('Being asked to pay (Respondent)', 'Note: respondent-side representation.');
  addEdge(famB3, famB3_pet); addEdge(famB3_pet, famB2);
  addEdge(famB3, famB3_res); addEdge(famB3_res, transferId);

  // --- Family Offense ---
  const famCSafety = addNode('question', 'FC - Safety Check', {
    question: 'First, I need to ask - are you in a safe place right now?',
    note: 'SAFETY-FIRST PROTOCOL - confirm caller safety before proceeding',
  });
  const famC_q5 = resp('A family member is threatening or hurting me');
  addEdge(famTriage, famC_q5); addEdge(famC_q5, famCSafety);

  const famCEmergency = addNode('action', 'EMERGENCY - Advise 911', {
    actionType: 'set_flag', flagName: 'urgencyFlag', flagValue: 'safety_first',
    petitionType: 'O-Petition - emergency order of protection',
    note: 'EMERGENCY: Advise caller to call 911. Let them know you are flagging this for immediate lawyer review.',
  });
  const famC1 = addNode('question', 'FC1. Nature of Conduct', { question: 'Can you tell me a little about what has been happening?' });

  const famCS_unsafe = resp("No, or I'm not sure", 'EMERGENCY: Advise 911 immediately. Let them know you are flagging this for immediate lawyer review.');
  const famCS_safe   = resp('Yes, I am safe');
  addEdge(famCSafety, famCS_unsafe); addEdge(famCS_unsafe, famCEmergency); addEdge(famCEmergency, transferId);
  addEdge(famCSafety, famCS_safe);   addEdge(famCS_safe,   famC1);

  const famC2 = addNode('question', 'FC2. Relationship to Respondent', { question: 'What is your relationship to the person doing this?' });
  const famC1_phys = resp('Physical violence or threats'); const famC1_har = resp('Harassment, stalking, or intimidation');
  const famC1_emo  = resp('Emotional or psychological abuse'); const famC1_sex = resp('Sexual abuse');
  addEdge(famC1, famC1_phys); addEdge(famC1_phys, famC2);
  addEdge(famC1, famC1_har);  addEdge(famC1_har,  famC2);
  addEdge(famC1, famC1_emo);  addEdge(famC1_emo,  famC2);
  addEdge(famC1, famC1_sex);  addEdge(famC1_sex,  famC2);
  const famC2_sp = resp('Spouse or former spouse'); const famC2_co = resp('Co-parent or parent of my child');
  const famC2_fam = resp('Parent or sibling (family member)'); const famC2_par = resp('Intimate partner / boyfriend / girlfriend');
  addEdge(famC2, famC2_sp);  addEdge(famC2_sp,  transferId);
  addEdge(famC2, famC2_co);  addEdge(famC2_co,  transferId);
  addEdge(famC2, famC2_fam); addEdge(famC2_fam, transferId);
  addEdge(famC2, famC2_par); addEdge(famC2_par, transferId);

  // --- Child Welfare / ACS ---
  const famDRouting = addNode('question', 'FD - ACS / Child Welfare', {
    note: "Did ACS come to your home, are you concerned about a child elsewhere, or is this a foster care matter?",
  });
  const famD_q5 = resp("A child's safety or welfare concern");
  addEdge(famTriage, famD_q5); addEdge(famD_q5, famDRouting);

  const famD1 = addNode('question', 'FD1. Stage of ACS Involvement', {
    question: 'Has ACS come to your home? Is there a court date scheduled?',
    note: 'If court date imminent, flag URGENT',
  });
  const famD2 = addNode('question', 'FD2. Foster Care Sub-Branch', { question: 'What kind of foster care matter is this?' });

  const famDR_acs   = resp('ACS came to my home');
  const famDR_child = resp('Concerned about a child elsewhere');
  const famDR_fos   = resp('Foster parent legal matter');
  addEdge(famDRouting, famDR_acs);   addEdge(famDR_acs,   famD1);
  addEdge(famDRouting, famDR_child); addEdge(famDR_child, transferId);
  addEdge(famDRouting, famDR_fos);   addEdge(famDR_fos,   famD2);

  const famD1_inv = resp('Investigation stage - no court date yet'); const famD1_court = resp('Petition filed - court date scheduled', 'FLAG URGENT.');
  addEdge(famD1, famD1_inv); addEdge(famD1_inv, transferId);
  addEdge(famD1, famD1_court); addEdge(famD1_court, transferId);

  const famD2_pl = resp('Extension of placement / permanency hearing'); const famD2_ad = resp('Foster-to-adopt'); const famD2_disp = resp('Dispute with agency');
  addEdge(famD2, famD2_pl); addEdge(famD2_pl, transferId);
  addEdge(famD2, famD2_ad); addEdge(famD2_ad, transferId);
  addEdge(famD2, famD2_disp); addEdge(famD2_disp, transferId);

  // --- Paternity ---
  const famERouting = addNode('question', 'FE - Paternity', {
    note: 'Are you a mother seeking to establish paternity, a father seeking parental rights, or disputing paternity?',
  });
  const famE_q5 = resp('Paternity - establishing who the father is');
  addEdge(famTriage, famE_q5); addEdge(famE_q5, famERouting);
  const famER_mom = resp('Mother seeking to establish'); const famER_dad = resp('Father seeking parental rights', 'May need to establish paternity before custody.'); const famER_disp = resp('Disputing paternity', 'DNA challenge / Respondent representation.');
  addEdge(famERouting, famER_mom); addEdge(famER_mom, transferId);
  addEdge(famERouting, famER_dad); addEdge(famER_dad, transferId);
  addEdge(famERouting, famER_disp); addEdge(famER_disp, transferId);

  // --- Adoption & Guardianship ---
  const famFRouting = addNode('question', 'FF - Adoption / Guardianship', {
    note: 'What type of adoption or guardianship matter? (stepparent, foster-to-adopt, private, kinship, guardianship of minor or adult)',
  });
  const famF_q5 = resp('Adoption or guardianship');
  addEdge(famTriage, famF_q5); addEdge(famF_q5, famFRouting);
  const famFR_any = resp('Any type');
  addEdge(famFRouting, famFR_any); addEdge(famFR_any, transferId);

  // --- Juvenile ---
  const famGRouting = addNode('question', 'FG - Juvenile Matter', {
    note: 'Is this about an alleged crime / delinquent act, or truancy / child beyond parental control?',
  });
  const famG_q5 = resp('A juvenile matter');
  addEdge(famTriage, famG_q5); addEdge(famG_q5, famGRouting);
  const famGR_any = resp('Any type');
  addEdge(famGRouting, famGR_any); addEdge(famGR_any, transferId);

  // --- Divorce ---
  const famDivRouting = addNode('question', 'FH - Divorce / Separation', {
    note: 'Is this an uncontested divorce, contested divorce, or legal separation?',
  });
  const famH_q5 = resp('Divorce or legal separation');
  addEdge(famTriage, famH_q5); addEdge(famH_q5, famDivRouting);

  const famDiv1 = addNode('question', 'FH1. Divorce Issues Involved', {
    question: 'What are the main issues in the divorce or separation right now?',
  });
  const famDivR_uncon = resp('Uncontested - we agree on everything');
  const famDivR_con   = resp('Contested - we disagree on key issues');
  const famDivR_sep   = resp('Legal separation only');
  addEdge(famDivRouting, famDivR_uncon); addEdge(famDivR_uncon, famDiv1);
  addEdge(famDivRouting, famDivR_con);   addEdge(famDivR_con,   famDiv1);
  addEdge(famDivRouting, famDivR_sep);   addEdge(famDivR_sep,   famDiv1);

  const famDiv2 = addNode('question', 'FH2. Filing Status / Court Dates', {
    question: 'Has anything already been filed, and is there any court date or deadline coming up?',
    note: 'If there is already a case or a court date, capture that clearly for the lawyer review.',
  });
  const famDiv1_prop = resp('Property division and assets');
  const famDiv1_sup = resp('Spousal support / alimony');
  const famDiv1_child = resp('Child custody and support');
  const famDiv1_all = resp('All of the above');
  addEdge(famDiv1, famDiv1_prop);  addEdge(famDiv1_prop,  famDiv2);
  addEdge(famDiv1, famDiv1_sup);   addEdge(famDiv1_sup,   famDiv2);
  addEdge(famDiv1, famDiv1_child); addEdge(famDiv1_child, famDiv2);
  addEdge(famDiv1, famDiv1_all);   addEdge(famDiv1_all,   famDiv2);

  const famDiv3 = addNode('question', 'FH3. Children Involved', {
    question: 'Are there minor children involved in this matter?',
  });
  const famDiv2_notFiled = resp('Nothing filed yet');
  const famDiv2_filed = resp('Filed already - no court date yet');
  const famDiv2_court = resp('Filed already - court date or deadline coming up', 'FLAG URGENT. Make sure the notes clearly mention the upcoming date or deadline.');
  addEdge(famDiv2, famDiv2_notFiled); addEdge(famDiv2_notFiled, famDiv3);
  addEdge(famDiv2, famDiv2_filed);    addEdge(famDiv2_filed,    famDiv3);
  addEdge(famDiv2, famDiv2_court);    addEdge(famDiv2_court,    famDiv3);

  const famDiv4 = addNode('question', 'FH4. Other Side Representation', {
    question: 'Does your spouse or partner already have a lawyer?',
  });
  const famDiv3_yes = resp('Yes - minor children are involved');
  const famDiv3_no = resp('No - no minor children involved');
  addEdge(famDiv3, famDiv3_yes); addEdge(famDiv3_yes, famDiv4);
  addEdge(famDiv3, famDiv3_no);  addEdge(famDiv3_no,  famDiv4);

  const famDiv5 = addNode('question', 'FH5. Immediate Divorce Urgency', {
    question: 'Is there anything urgent right now, like a safety issue, being locked out of finances or the home, or a deadline coming up?',
  });
  const famDiv4_yes = resp('Yes - the other side already has a lawyer');
  const famDiv4_no = resp('No - the other side does not have a lawyer');
  const famDiv4_unsure = resp('I am not sure if they have a lawyer');
  addEdge(famDiv4, famDiv4_yes);    addEdge(famDiv4_yes,    famDiv5);
  addEdge(famDiv4, famDiv4_no);     addEdge(famDiv4_no,     famDiv5);
  addEdge(famDiv4, famDiv4_unsure); addEdge(famDiv4_unsure, famDiv5);

  const famDivUrgent = addNode('action', 'Flag: Divorce - Urgent', {
    actionType: 'set_flag',
    flagName: 'urgencyFlag',
    flagValue: 'divorce_urgent',
    note: 'Caller reported an urgent divorce issue like safety, access to finances, or an imminent deadline.',
  });
  const famDiv5_urgent = resp('Yes - there is an urgent divorce issue', 'FLAG URGENT. Capture the urgency details before handoff.');
  const famDiv5_routine = resp('No - no immediate urgency');
  addEdge(famDiv5, famDiv5_urgent);  addEdge(famDiv5_urgent,  famDivUrgent);
  addEdge(famDivUrgent, transferId);
  addEdge(famDiv5, famDiv5_routine); addEdge(famDiv5_routine, transferId);

  // --- Other Family ---
  const famOther_q5 = resp('Other family law matter');
  addEdge(famTriage, famOther_q5); addEdge(famOther_q5, transferId);

  // Let callers who already named a specific family issue skip the generic
  // family triage question and route directly from the open-ended intake.
  addEdge(q5, famA_q5);
  addEdge(q5, famB_q5);
  addEdge(q5, famC_q5);
  addEdge(q5, famD_q5);
  addEdge(q5, famE_q5);
  addEdge(q5, famF_q5);
  addEdge(q5, famG_q5);
  addEdge(q5, famH_q5);
  addEdge(q5, famOther_q5);

  // ═══════════════════════════════════════════════════════════════
  // BRANCH 2 — CRIMINAL DEFENSE
  // ═══════════════════════════════════════════════════════════════

  const crimRouting = addNode('question', 'Criminal - Matter Type', {
    note: 'Do you know what type of criminal charge this is, or what the police said it was?',
  });
  const q5_crim = q5r('Criminal Defense', "Caller's situation involves criminal defense", 'Route here when the caller describes: being arrested, facing criminal charges, someone pressing charges against them, a DUI, drug offense, assault, theft, a bar fight, domestic violence charge, sex offense, weapons charge, probation violation, warrant, or any criminal investigation or prosecution.');
  addEdge(q5, q5_crim); addEdge(q5_crim, crimRouting);

  const crim_dui   = addNode('action', 'Flag: Criminal - DUI',       { actionType: 'set_flag', flagName: 'criminal_matter', flagValue: 'DUI / drunk driving' });
  const crim_drug  = addNode('action', 'Flag: Criminal - Drug',      { actionType: 'set_flag', flagName: 'criminal_matter', flagValue: 'Drug offense' });
  const crim_viol  = addNode('action', 'Flag: Criminal - Violent',   { actionType: 'set_flag', flagName: 'criminal_matter', flagValue: 'Assault / violent crime' });
  const crim_theft = addNode('action', 'Flag: Criminal - Theft',     { actionType: 'set_flag', flagName: 'criminal_matter', flagValue: 'Theft / property crime' });
  const crim_dv    = addNode('action', 'Flag: Criminal - Dom. Violence', { actionType: 'set_flag', flagName: 'criminal_matter', flagValue: 'Domestic violence charge (respondent)' });
  const crim_sex   = addNode('action', 'Flag: Criminal - Sex Offense', { actionType: 'set_flag', flagName: 'criminal_matter', flagValue: 'Sex offense charge' });
  const crim_wc    = addNode('action', 'Flag: Criminal - White Collar', { actionType: 'set_flag', flagName: 'criminal_matter', flagValue: 'White collar / financial crime' });
  const crim_juv   = addNode('action', 'Flag: Criminal - Juvenile',  { actionType: 'set_flag', flagName: 'criminal_matter', flagValue: 'Juvenile delinquency matter' });
  const crim_other = addNode('action', 'Flag: Criminal - Other',     { actionType: 'set_flag', flagName: 'criminal_matter', flagValue: 'Other criminal charge' });

  const crimR_dui   = resp('DUI or drunk driving');
  const crimR_drug  = resp('Drug offense (possession, distribution, trafficking)');
  const crimR_viol  = resp('Assault or violent crime');
  const crimR_theft = resp('Theft, robbery, or property crime');
  const crimR_dv    = resp('Domestic violence charge (I am the accused)');
  const crimR_sex   = resp('Sex offense charge');
  const crimR_wc    = resp('White collar or financial crime (fraud, embezzlement)');
  const crimR_juv   = resp('Juvenile delinquency (for a minor)');
  const crimR_other = resp('Other criminal charge');

  addEdge(crimRouting, crimR_dui);   addEdge(crimR_dui,   crim_dui);
  addEdge(crimRouting, crimR_drug);  addEdge(crimR_drug,  crim_drug);
  addEdge(crimRouting, crimR_viol);  addEdge(crimR_viol,  crim_viol);
  addEdge(crimRouting, crimR_theft); addEdge(crimR_theft, crim_theft);
  addEdge(crimRouting, crimR_dv);    addEdge(crimR_dv,    crim_dv);
  addEdge(crimRouting, crimR_sex);   addEdge(crimR_sex,   crim_sex);
  addEdge(crimRouting, crimR_wc);    addEdge(crimR_wc,    crim_wc);
  addEdge(crimRouting, crimR_juv);   addEdge(crimR_juv,   crim_juv);
  addEdge(crimRouting, crimR_other); addEdge(crimR_other, crim_other);

  const crimB1 = addNode('question', 'Crim B1. Stage of Case', {
    question: 'What stage is this at right now? For example, are police still investigating, have charges been filed, or do you already have a court date?',
  });
  [crim_dui, crim_drug, crim_viol, crim_theft, crim_dv, crim_sex, crim_wc, crim_juv, crim_other].forEach(n => addEdge(n, crimB1));

  const crimB2 = addNode('question', 'Crim B2. Custody Status', {
    question: 'Are you currently in custody or detained?',
    note: 'CRITICAL - determines emergency arraignment / bail hearing need',
  });
  const crimB1_arr  = resp('Just arrested or under investigation - no charges filed');
  const crimB1_chg  = resp('Charges filed - awaiting trial');
  const crimB1_trial = resp('Currently on trial');
  const crimB1_post = resp('Post-conviction - seeking appeal, parole, or expungement');
  addEdge(crimB1, crimB1_arr);  addEdge(crimB1_arr,  crimB2);
  addEdge(crimB1, crimB1_chg);  addEdge(crimB1_chg,  crimB2);
  addEdge(crimB1, crimB1_trial); addEdge(crimB1_trial, crimB2);
  addEdge(crimB1, crimB1_post); addEdge(crimB1_post, crimB2);

  const crimUrgent = addNode('action', 'Flag: URGENT - Detained', {
    actionType: 'set_flag', flagName: 'urgencyFlag', flagValue: 'detained_emergency',
    note: 'EMERGENCY: Caller in custody. Needs immediate arraignment / bail attorney.',
  });
  const crimB3 = addNode('question', 'Crim B3. Prior Record & Details', {
    question: 'Do you have any prior criminal record?',
    collectFields: [
      { name: 'charge_description', label: 'Description of charges',     type: 'text', required: true },
      { name: 'jurisdiction',       label: 'County / state of charges',   type: 'text', required: true },
      { name: 'court_date',         label: 'Court date (if scheduled)',    type: 'text', required: false },
    ],
  });
  const crimB2_yes = resp('Yes - I am currently in custody', 'EMERGENCY: Immediate bail/arraignment needed.');
  const crimB2_bail = resp('No - released on bail or bond');
  const crimB2_ror  = resp('No - released on own recognizance');
  const crimB2_no   = resp('No - not in custody');
  addEdge(crimB2, crimB2_yes);  addEdge(crimB2_yes,  crimUrgent); addEdge(crimUrgent, transferId);
  addEdge(crimB2, crimB2_bail); addEdge(crimB2_bail, crimB3);
  addEdge(crimB2, crimB2_ror);  addEdge(crimB2_ror,  crimB3);
  addEdge(crimB2, crimB2_no);   addEdge(crimB2_no,   crimB3);

  const crimB3_none = resp('No prior record'); const crimB3_misd = resp('Prior misdemeanors'); const crimB3_fel = resp('Prior felonies');
  addEdge(crimB3, crimB3_none); addEdge(crimB3_none, transferId);
  addEdge(crimB3, crimB3_misd); addEdge(crimB3_misd, transferId);
  addEdge(crimB3, crimB3_fel);  addEdge(crimB3_fel,  transferId);

  // ═══════════════════════════════════════════════════════════════
  // BRANCH 3 — IMMIGRATION
  // ═══════════════════════════════════════════════════════════════

  const immRouting = addNode('question', 'Immigration - Matter Type', {
    note: 'What type of immigration matter do you need help with?',
  });
  const q5_imm = q5r('Immigration', "Caller's situation involves immigration", 'Route here when the caller describes: visa issues, deportation or removal, citizenship or naturalization, asylum, green card, work permits, sponsoring a family member, DACA, or any immigration status concern.');
  addEdge(q5, q5_imm); addEdge(q5_imm, immRouting);

  const imm_visa   = addNode('action', 'Flag: Immigration - Visa',       { actionType: 'set_flag', flagName: 'immigration_matter', flagValue: 'Visa application or extension' });
  const imm_remov  = addNode('action', 'Flag: Immigration - Removal',    { actionType: 'set_flag', flagName: 'immigration_matter', flagValue: 'Deportation / removal proceedings' });
  const imm_cit    = addNode('action', 'Flag: Immigration - Citizenship', { actionType: 'set_flag', flagName: 'immigration_matter', flagValue: 'Citizenship / naturalization' });
  const imm_asylum = addNode('action', 'Flag: Immigration - Asylum',     { actionType: 'set_flag', flagName: 'immigration_matter', flagValue: 'Asylum application' });
  const imm_gc     = addNode('action', 'Flag: Immigration - Green Card', { actionType: 'set_flag', flagName: 'immigration_matter', flagValue: 'Green card / permanent residence' });
  const imm_work   = addNode('action', 'Flag: Immigration - Work Auth',  { actionType: 'set_flag', flagName: 'immigration_matter', flagValue: 'Work authorization / work permit' });
  const imm_fam    = addNode('action', 'Flag: Immigration - Family Pet.', { actionType: 'set_flag', flagName: 'immigration_matter', flagValue: 'Family petition / sponsorship' });
  const imm_daca   = addNode('action', 'Flag: Immigration - DACA',       { actionType: 'set_flag', flagName: 'immigration_matter', flagValue: 'DACA or other deferred action' });
  const imm_other  = addNode('action', 'Flag: Immigration - Other',      { actionType: 'set_flag', flagName: 'immigration_matter', flagValue: 'Other immigration matter' });

  const immR_visa   = resp('Visa application, renewal, or change of status');
  const immR_remov  = resp('Deportation or removal proceedings');
  const immR_cit    = resp('Citizenship or naturalization');
  const immR_asylum = resp('Asylum application or refugee status');
  const immR_gc     = resp('Green card or permanent residence');
  const immR_work   = resp('Work authorization or work permit (EAD)');
  const immR_fam    = resp('Sponsoring a family member to come to the US');
  const immR_daca   = resp('DACA, TPS, or other deferred action');
  const immR_other  = resp('Other immigration matter');

  addEdge(immRouting, immR_visa);   addEdge(immR_visa,   imm_visa);
  addEdge(immRouting, immR_remov);  addEdge(immR_remov,  imm_remov);
  addEdge(immRouting, immR_cit);    addEdge(immR_cit,    imm_cit);
  addEdge(immRouting, immR_asylum); addEdge(immR_asylum, imm_asylum);
  addEdge(immRouting, immR_gc);     addEdge(immR_gc,     imm_gc);
  addEdge(immRouting, immR_work);   addEdge(immR_work,   imm_work);
  addEdge(immRouting, immR_fam);    addEdge(immR_fam,    imm_fam);
  addEdge(immRouting, immR_daca);   addEdge(immR_daca,   imm_daca);
  addEdge(immRouting, immR_other);  addEdge(immR_other,  imm_other);

  const immC1 = addNode('question', 'Imm C1. Current Immigration Status', {
    question: 'What is your current immigration status?',
    collectFields: [
      { name: 'country_of_origin', label: 'Country of origin',         type: 'text', required: true },
      { name: 'time_in_us',        label: 'How long have you been in the US?', type: 'text', required: true },
    ],
  });
  [imm_visa, imm_remov, imm_cit, imm_asylum, imm_gc, imm_work, imm_fam, imm_daca, imm_other].forEach(n => addEdge(n, immC1));

  const immC2 = addNode('question', 'Imm C2. Removal / Hearing Urgency', {
    question: 'Is there an active removal order or immigration court hearing scheduled?',
    note: 'CRITICAL - imminent hearings require emergency motions',
  });
  const immC1_cit  = resp('US citizen or permanent resident (green card)');
  const immC1_visa = resp('Valid visa holder');
  const immC1_undoc = resp('Undocumented / no legal status');
  const immC1_daca  = resp('DACA recipient');
  const immC1_asylum = resp('Asylum seeker or refugee');
  const immC1_unsure = resp('Unsure of my status');
  [immC1_cit, immC1_visa, immC1_undoc, immC1_daca, immC1_asylum, immC1_unsure].forEach(r => { addEdge(immC1, r); addEdge(r, immC2); });

  const immUrgent = addNode('action', 'Flag: URGENT - Removal Order', {
    actionType: 'set_flag', flagName: 'urgencyFlag', flagValue: 'deportation_emergency',
    note: 'EMERGENCY: Active removal / hearing within 2 weeks. Emergency motion may be needed.',
  });
  const immC3 = addNode('question', 'Imm C3. Prior Application History', {
    question: 'Have you had any prior immigration applications or court proceedings?',
  });
  const immC2_2wk  = resp('Yes - hearing within 2 weeks', 'EMERGENCY: Advise caller this is urgent.');
  const immC2_gt2  = resp('Yes - hearing more than 2 weeks away');
  const immC2_no   = resp('No active order or hearing');
  addEdge(immC2, immC2_2wk);  addEdge(immC2_2wk,  immUrgent); addEdge(immUrgent, transferId);
  addEdge(immC2, immC2_gt2);  addEdge(immC2_gt2,  immC3);
  addEdge(immC2, immC2_no);   addEdge(immC2_no,   immC3);

  const immC3_first = resp('First-time application'); const immC3_denied = resp('Prior application denied'); const immC3_pend = resp('Application currently pending'); const immC3_prev = resp('Previously in removal proceedings');
  [immC3_first, immC3_denied, immC3_pend, immC3_prev].forEach(r => { addEdge(immC3, r); addEdge(r, transferId); });

  // ═══════════════════════════════════════════════════════════════
  // BRANCH 4 — PERSONAL INJURY
  // ═══════════════════════════════════════════════════════════════

  const piRouting = addNode('question', 'Personal Injury - Incident Type', {
    note: 'What type of accident or injury occurred?',
  });
  const q5_pi = q5r('Personal Injury', "Caller's situation involves personal injury or accident", 'Route here when the caller describes: being hurt in a car accident, slip and fall, medical malpractice, workplace injury, a defective product causing harm, a dog bite, or the wrongful death of a family member due to someone else\'s negligence.');
  addEdge(q5, q5_pi); addEdge(q5_pi, piRouting);

  const pi_car   = addNode('action', 'Flag: PI - Vehicle Accident',    { actionType: 'set_flag', flagName: 'injury_type', flagValue: 'Vehicle accident' });
  const pi_slip  = addNode('action', 'Flag: PI - Slip and Fall',       { actionType: 'set_flag', flagName: 'injury_type', flagValue: 'Slip / trip and fall' });
  const pi_mal   = addNode('action', 'Flag: PI - Medical Malpractice', { actionType: 'set_flag', flagName: 'injury_type', flagValue: 'Medical malpractice / negligence' });
  const pi_work  = addNode('action', 'Flag: PI - Workplace Injury',    { actionType: 'set_flag', flagName: 'injury_type', flagValue: 'Workplace injury / workers comp' });
  const pi_prod  = addNode('action', 'Flag: PI - Product Liability',   { actionType: 'set_flag', flagName: 'injury_type', flagValue: 'Defective product / product liability' });
  const pi_dog   = addNode('action', 'Flag: PI - Animal Attack',       { actionType: 'set_flag', flagName: 'injury_type', flagValue: 'Dog bite / animal attack' });
  const pi_wd    = addNode('action', 'Flag: PI - Wrongful Death',      { actionType: 'set_flag', flagName: 'injury_type', flagValue: 'Wrongful death', note: 'Flag for wrongful death specialist' });
  const pi_other = addNode('action', 'Flag: PI - Other Injury',        { actionType: 'set_flag', flagName: 'injury_type', flagValue: 'Other accident / injury' });

  const piR_car   = resp('Car, truck, or motorcycle accident');
  const piR_slip  = resp('Slip, trip, or fall on someone else\'s property');
  const piR_mal   = resp('Medical malpractice or surgical error');
  const piR_work  = resp('Workplace injury or workers compensation');
  const piR_prod  = resp('Defective product caused injury');
  const piR_dog   = resp('Dog bite or animal attack');
  const piR_wd    = resp('Wrongful death of a family member');
  const piR_other = resp('Other accident or injury');

  addEdge(piRouting, piR_car);   addEdge(piR_car,   pi_car);
  addEdge(piRouting, piR_slip);  addEdge(piR_slip,  pi_slip);
  addEdge(piRouting, piR_mal);   addEdge(piR_mal,   pi_mal);
  addEdge(piRouting, piR_work);  addEdge(piR_work,  pi_work);
  addEdge(piRouting, piR_prod);  addEdge(piR_prod,  pi_prod);
  addEdge(piRouting, piR_dog);   addEdge(piR_dog,   pi_dog);
  addEdge(piRouting, piR_wd);    addEdge(piR_wd,    pi_wd);
  addEdge(piRouting, piR_other); addEdge(piR_other, pi_other);

  const piD1 = addNode('question', 'PI D1. Date of Incident', {
    question: 'Approximately when did the incident occur?',
    collectFields: [
      { name: 'incident_date',   label: 'Date of incident (approximate)', type: 'text', required: true },
      { name: 'injury_description', label: 'Brief description of injuries', type: 'text', required: true },
    ],
    note: 'Statute of limitations screening - critical for case viability',
  });
  [pi_car, pi_slip, pi_mal, pi_work, pi_prod, pi_dog, pi_wd, pi_other].forEach(n => addEdge(n, piD1));

  const piD2 = addNode('question', 'PI D2. Medical Treatment Status', {
    question: 'Are you currently receiving medical treatment for your injuries?',
  });
  const piD1_30d  = resp('Within the last 30 days');
  const piD1_1yr  = resp('1 to 12 months ago');
  const piD1_3yr  = resp('1 to 3 years ago');
  const piD1_old  = resp('More than 3 years ago', 'Note: statutes of limitations may apply - flag for attorney review.');
  [piD1_30d, piD1_1yr, piD1_3yr, piD1_old].forEach(r => { addEdge(piD1, r); addEdge(r, piD2); });

  const piD3 = addNode('question', 'PI D3. Insurance and Representation', {
    question: 'Has an insurance claim been filed, or do you have existing legal representation?',
  });
  const piD2_active = resp('Yes - still in active treatment');
  const piD2_done   = resp('Treatment completed');
  const piD2_none   = resp('I have not received medical treatment', 'Note: lack of treatment may affect claim value - flag for attorney.');
  const piD2_death  = resp('This involves the death of a family member');
  [piD2_active, piD2_done, piD2_none, piD2_death].forEach(r => { addEdge(piD2, r); addEdge(r, piD3); });

  const piD3_none    = resp('No claim filed yet'); const piD3_inprog = resp('Insurance claim in progress'); const piD3_denied = resp('Insurance claim was denied'); const piD3_atty = resp('I had an attorney but am seeking new representation');
  [piD3_none, piD3_inprog, piD3_denied, piD3_atty].forEach(r => { addEdge(piD3, r); addEdge(r, transferId); });

  // ═══════════════════════════════════════════════════════════════
  // BRANCH 5 — CORPORATE / BUSINESS
  // ═══════════════════════════════════════════════════════════════

  const corpRouting = addNode('question', 'Corporate - Matter Type', {
    note: 'What type of business or corporate matter do you need help with?',
  });
  const q5_corp = q5r('Corporate / Business', "Caller's situation involves business or corporate law", 'Route here when the caller describes: a contract dispute, starting or dissolving a business, a business partnership conflict, merger or acquisition, corporate compliance, or a commercial dispute.');
  addEdge(q5, q5_corp); addEdge(q5_corp, corpRouting);

  const corp_contract = addNode('action', 'Flag: Corp - Contract',       { actionType: 'set_flag', flagName: 'business_matter', flagValue: 'Contract dispute or drafting' });
  const corp_form     = addNode('action', 'Flag: Corp - Formation',      { actionType: 'set_flag', flagName: 'business_matter', flagValue: 'Business formation (LLC, corp, partnership)' });
  const corp_litig    = addNode('action', 'Flag: Corp - Litigation',     { actionType: 'set_flag', flagName: 'business_matter', flagValue: 'Business dispute / commercial litigation' });
  const corp_ma       = addNode('action', 'Flag: Corp - M&A',            { actionType: 'set_flag', flagName: 'business_matter', flagValue: 'Merger, acquisition, or business sale' });
  const corp_comp     = addNode('action', 'Flag: Corp - Compliance',     { actionType: 'set_flag', flagName: 'business_matter', flagValue: 'Regulatory compliance' });
  const corp_other    = addNode('action', 'Flag: Corp - Other Business', { actionType: 'set_flag', flagName: 'business_matter', flagValue: 'Other corporate / business matter' });

  const corpR_contract = resp('Contract dispute, review, or drafting');
  const corpR_form     = resp('Starting a business (LLC, corporation, partnership)');
  const corpR_litig    = resp('Business dispute or commercial litigation');
  const corpR_ma       = resp('Mergers, acquisitions, or selling a business');
  const corpR_comp     = resp('Regulatory compliance or corporate governance');
  const corpR_other    = resp('Other business or corporate matter');

  addEdge(corpRouting, corpR_contract); addEdge(corpR_contract, corp_contract);
  addEdge(corpRouting, corpR_form);     addEdge(corpR_form,     corp_form);
  addEdge(corpRouting, corpR_litig);    addEdge(corpR_litig,    corp_litig);
  addEdge(corpRouting, corpR_ma);       addEdge(corpR_ma,       corp_ma);
  addEdge(corpRouting, corpR_comp);     addEdge(corpR_comp,     corp_comp);
  addEdge(corpRouting, corpR_other);    addEdge(corpR_other,    corp_other);

  const corpE1 = addNode('question', 'Corp E1. Role and Business Type', {
    question: 'Are you the business owner, a partner, or a shareholder?',
    collectFields: [
      { name: 'business_name', label: 'Business name (if applicable)', type: 'text', required: false },
      { name: 'business_type', label: 'Type of business / industry',   type: 'text', required: false },
    ],
  });
  [corp_contract, corp_form, corp_litig, corp_ma, corp_comp, corp_other].forEach(n => addEdge(n, corpE1));

  const corpE2 = addNode('question', 'Corp E2. Urgency - Active Litigation', {
    question: 'Is there an active lawsuit, court date, or imminent contract deadline?',
    note: 'Active litigation or contract deadlines require immediate attention',
  });
  const corpE1_owner = resp('I am the sole owner / sole member'); const corpE1_partner = resp('I am a partner or co-founder'); const corpE1_shareholder = resp('I am a shareholder or investor'); const corpE1_exec = resp('I am an executive or officer');
  [corpE1_owner, corpE1_partner, corpE1_shareholder, corpE1_exec].forEach(r => { addEdge(corpE1, r); addEdge(r, corpE2); });

  const corpUrgent = addNode('action', 'Flag: Corp - Urgent', { actionType: 'set_flag', flagName: 'urgencyFlag', flagValue: 'business_litigation_urgent', note: 'Active lawsuit or imminent deadline.' });
  const corpE3 = addNode('question', 'Corp E3. Matter Description', {
    question: 'Can you briefly describe the core issue or what outcome you are seeking?',
    collectFields: [{ name: 'matter_description', label: 'Brief description of the matter', type: 'text', required: true }],
  });
  const corpE2_active = resp('Yes - active lawsuit or court date', 'Flag as urgent business litigation.');
  const corpE2_dead   = resp('Yes - contract or filing deadline approaching');
  const corpE2_no     = resp('No - planning or advisory matter');
  addEdge(corpE2, corpE2_active); addEdge(corpE2_active, corpUrgent); addEdge(corpUrgent, corpE3);
  addEdge(corpE2, corpE2_dead);   addEdge(corpE2_dead,   corpE3);
  addEdge(corpE2, corpE2_no);     addEdge(corpE2_no,     corpE3);
  const corpE3_pla = resp('I am initiating a claim (plaintiff)'); const corpE3_def = resp('I am responding to a claim (defendant)'); const corpE3_adv = resp('I need advice or document review');
  [corpE3_pla, corpE3_def, corpE3_adv].forEach(r => { addEdge(corpE3, r); addEdge(r, transferId); });

  // ═══════════════════════════════════════════════════════════════
  // BRANCH 6 — REAL ESTATE
  // ═══════════════════════════════════════════════════════════════

  const reRouting = addNode('question', 'Real Estate - Matter Type', {
    note: 'What type of real estate matter do you need help with?',
  });
  const q5_re = q5r('Real Estate', "Caller's situation involves real estate", 'Route here when the caller describes: buying or selling property, a landlord-tenant dispute, eviction, foreclosure, a title dispute, zoning issues, a construction defect, or a real estate contract problem.');
  addEdge(q5, q5_re); addEdge(q5_re, reRouting);

  const re_buy    = addNode('action', 'Flag: RE - Purchase',      { actionType: 'set_flag', flagName: 're_matter', flagValue: 'Property purchase / closing' });
  const re_sell   = addNode('action', 'Flag: RE - Sale',          { actionType: 'set_flag', flagName: 're_matter', flagValue: 'Property sale / closing' });
  const re_lease  = addNode('action', 'Flag: RE - Lease Dispute', { actionType: 'set_flag', flagName: 're_matter', flagValue: 'Lease or landlord-tenant dispute' });
  const re_fore   = addNode('action', 'Flag: RE - Foreclosure',   { actionType: 'set_flag', flagName: 're_matter', flagValue: 'Foreclosure defense', note: 'Foreclosure may require urgent action' });
  const re_title  = addNode('action', 'Flag: RE - Title',         { actionType: 'set_flag', flagName: 're_matter', flagValue: 'Title dispute or cloud on title' });
  const re_zon    = addNode('action', 'Flag: RE - Zoning',        { actionType: 'set_flag', flagName: 're_matter', flagValue: 'Zoning, permits, or land use' });
  const re_const  = addNode('action', 'Flag: RE - Construction',  { actionType: 'set_flag', flagName: 're_matter', flagValue: 'Construction dispute or defect' });
  const re_other  = addNode('action', 'Flag: RE - Other',         { actionType: 'set_flag', flagName: 're_matter', flagValue: 'Other real estate matter' });

  const reR_buy   = resp('Buying a property (purchase or closing)');
  const reR_sell  = resp('Selling a property (sale or closing)');
  const reR_lease = resp('Landlord / tenant dispute or lease issue');
  const reR_fore  = resp('Foreclosure or mortgage default');
  const reR_title = resp('Title dispute or ownership issue');
  const reR_zon   = resp('Zoning, building permits, or land use');
  const reR_const = resp('Construction dispute or contractor defect');
  const reR_other = resp('Other real estate matter');

  addEdge(reRouting, reR_buy);   addEdge(reR_buy,   re_buy);
  addEdge(reRouting, reR_sell);  addEdge(reR_sell,  re_sell);
  addEdge(reRouting, reR_lease); addEdge(reR_lease, re_lease);
  addEdge(reRouting, reR_fore);  addEdge(reR_fore,  re_fore);
  addEdge(reRouting, reR_title); addEdge(reR_title, re_title);
  addEdge(reRouting, reR_zon);   addEdge(reR_zon,   re_zon);
  addEdge(reRouting, reR_const); addEdge(reR_const, re_const);
  addEdge(reRouting, reR_other); addEdge(reR_other, re_other);

  const reF1 = addNode('question', 'RE F1. Property Type and Role', {
    question: 'Is this residential or commercial property, and what is your role?',
    collectFields: [
      { name: 'property_address', label: 'Property address or location', type: 'text', required: false },
      { name: 'property_type',    label: 'Residential or commercial',    type: 'text', required: true },
    ],
  });
  [re_buy, re_sell, re_lease, re_fore, re_title, re_zon, re_const, re_other].forEach(n => addEdge(n, reF1));

  const reF2 = addNode('question', 'RE F2. Urgency - Deadlines or Court Date', {
    question: 'Is there a closing date, eviction hearing, foreclosure date, or other deadline approaching?',
    note: 'Foreclosure sale dates and eviction hearings are time-critical',
  });
  const reF1_owner  = resp('Owner / seller'); const reF1_buyer = resp('Buyer'); const reF1_tenant = resp('Tenant / renter'); const reF1_landlord = resp('Landlord / property owner');
  [reF1_owner, reF1_buyer, reF1_tenant, reF1_landlord].forEach(r => { addEdge(reF1, r); addEdge(r, reF2); });

  const reUrgent = addNode('action', 'Flag: RE - Urgent Deadline', { actionType: 'set_flag', flagName: 'urgencyFlag', flagValue: 're_deadline_urgent', note: 'Time-sensitive real estate deadline.' });
  const reF2_imm  = resp('Yes - within 2 weeks', 'FLAG URGENT: Imminent real estate deadline.');
  const reF2_soon = resp('Yes - within 1 to 2 months');
  const reF2_no   = resp('No immediate deadline');
  addEdge(reF2, reF2_imm);  addEdge(reF2_imm,  reUrgent); addEdge(reUrgent, transferId);
  addEdge(reF2, reF2_soon); addEdge(reF2_soon, transferId);
  addEdge(reF2, reF2_no);   addEdge(reF2_no,   transferId);

  // ═══════════════════════════════════════════════════════════════
  // BRANCH 7 — EMPLOYMENT
  // ═══════════════════════════════════════════════════════════════

  const empRouting = addNode('question', 'Employment - Matter Type', {
    note: 'What type of employment or labor matter do you need help with?',
  });
  const q5_emp = q5r('Employment', "Caller's situation involves employment or labor law", 'Route here when the caller describes: being fired unfairly, workplace discrimination or harassment, unpaid wages, a non-compete or severance agreement, retaliation for whistleblowing, FMLA denial, or any employer-employee dispute.');
  addEdge(q5, q5_emp); addEdge(q5_emp, empRouting);

  const emp_term  = addNode('action', 'Flag: Emp - Wrongful Term.',   { actionType: 'set_flag', flagName: 'emp_matter', flagValue: 'Wrongful termination' });
  const emp_disc  = addNode('action', 'Flag: Emp - Discrimination',   { actionType: 'set_flag', flagName: 'emp_matter', flagValue: 'Workplace discrimination or harassment' });
  const emp_wage  = addNode('action', 'Flag: Emp - Wage/Hour',        { actionType: 'set_flag', flagName: 'emp_matter', flagValue: 'Wage and hour dispute / unpaid wages' });
  const emp_nc    = addNode('action', 'Flag: Emp - Non-Compete',      { actionType: 'set_flag', flagName: 'emp_matter', flagValue: 'Non-compete, severance, or employment agreement' });
  const emp_retaliation = addNode('action', 'Flag: Emp - Retaliation', { actionType: 'set_flag', flagName: 'emp_matter', flagValue: 'Workplace retaliation or whistleblower' });
  const emp_fmla  = addNode('action', 'Flag: Emp - FMLA/Leave',       { actionType: 'set_flag', flagName: 'emp_matter', flagValue: 'FMLA / medical leave dispute' });
  const emp_ind   = addNode('action', 'Flag: Emp - Independent Contractor', { actionType: 'set_flag', flagName: 'emp_matter', flagValue: 'Independent contractor misclassification' });
  const emp_other = addNode('action', 'Flag: Emp - Other',            { actionType: 'set_flag', flagName: 'emp_matter', flagValue: 'Other employment matter' });

  const empR_term  = resp('Wrongful termination or unfair firing');
  const empR_disc  = resp('Discrimination, harassment, or hostile work environment');
  const empR_wage  = resp('Unpaid wages, overtime, or wage theft');
  const empR_nc    = resp('Non-compete clause, severance, or employment contract');
  const empR_ret   = resp('Retaliation for reporting wrongdoing (whistleblower)');
  const empR_fmla  = resp('FMLA, disability, or medical leave dispute');
  const empR_ind   = resp('Independent contractor misclassification');
  const empR_other = resp('Other employment or HR matter');

  addEdge(empRouting, empR_term);  addEdge(empR_term,  emp_term);
  addEdge(empRouting, empR_disc);  addEdge(empR_disc,  emp_disc);
  addEdge(empRouting, empR_wage);  addEdge(empR_wage,  emp_wage);
  addEdge(empRouting, empR_nc);    addEdge(empR_nc,    emp_nc);
  addEdge(empRouting, empR_ret);   addEdge(empR_ret,   emp_retaliation);
  addEdge(empRouting, empR_fmla);  addEdge(empR_fmla,  emp_fmla);
  addEdge(empRouting, empR_ind);   addEdge(empR_ind,   emp_ind);
  addEdge(empRouting, empR_other); addEdge(empR_other, emp_other);

  const empG1 = addNode('question', 'Emp G1. Employment Status', {
    question: 'What is your current employment status with this employer?',
    collectFields: [
      { name: 'employer_name', label: 'Employer name',         type: 'text', required: false },
      { name: 'job_title',     label: 'Job title or position', type: 'text', required: false },
    ],
  });
  [emp_term, emp_disc, emp_wage, emp_nc, emp_retaliation, emp_fmla, emp_ind, emp_other].forEach(n => addEdge(n, empG1));

  const empG2 = addNode('question', 'Emp G2. Protected Class / Basis', {
    question: 'If this involves discrimination or harassment, what is the basis?',
    note: 'Important for identifying applicable federal and state law protections',
  });
  const empG1_curr  = resp('Currently employed there'); const empG1_term = resp('Terminated or laid off'); const empG1_resign = resp('Resigned / constructively dismissed'); const empG1_never = resp('Was never employed / prospective employee');
  [empG1_curr, empG1_term, empG1_resign, empG1_never].forEach(r => { addEdge(empG1, r); addEdge(r, empG2); });

  const empG3 = addNode('question', 'Emp G3. Urgency and Documentation', {
    question: 'Is there a pending deadline - such as an EEOC filing deadline, unemployment appeal, or NLRB charge?',
    note: 'EEOC charges have 180/300-day filing deadlines from the discriminatory act',
    collectFields: [
      { name: 'incident_date', label: 'Date of the incident or termination', type: 'text', required: true },
      { name: 'documentation', label: 'Do you have any documentation (emails, contracts, etc.)?', type: 'text', required: false },
    ],
  });
  const empG2_race  = resp('Race or national origin'); const empG2_gender = resp('Gender or sex (including pregnancy)'); const empG2_age = resp('Age (40 or older)'); const empG2_dis = resp('Disability or medical condition'); const empG2_rel = resp('Religion'); const empG2_other = resp('Other protected class or not applicable');
  [empG2_race, empG2_gender, empG2_age, empG2_dis, empG2_rel, empG2_other].forEach(r => { addEdge(empG2, r); addEdge(r, empG3); });

  const empUrgent = addNode('action', 'Flag: Emp - Filing Deadline', { actionType: 'set_flag', flagName: 'urgencyFlag', flagValue: 'eeoc_deadline_urgent', note: 'EEOC or other administrative filing deadline may be approaching.' });
  const empG3_imm = resp('Yes - deadline within 30 days', 'FLAG URGENT: EEOC or filing deadline approaching.');
  const empG3_soon = resp('Yes - deadline within a few months');
  const empG3_no   = resp('No known deadline');
  addEdge(empG3, empG3_imm); addEdge(empG3_imm, empUrgent); addEdge(empUrgent, transferId);
  addEdge(empG3, empG3_soon); addEdge(empG3_soon, transferId);
  addEdge(empG3, empG3_no);   addEdge(empG3_no,   transferId);

  // ═══════════════════════════════════════════════════════════════
  // BRANCH 8 — BANKRUPTCY
  // ═══════════════════════════════════════════════════════════════

  const bankRouting = addNode('question', 'Bankruptcy - Type', {
    note: 'What type of bankruptcy are you considering or currently involved in?',
  });
  const q5_bank = q5r('Bankruptcy', "Caller's situation involves bankruptcy or debt", 'Route here when the caller describes: overwhelming debt, wage garnishment, creditor harassment, potential foreclosure due to inability to pay, or asking about Chapter 7, 11, or 13 bankruptcy.');
  addEdge(q5, q5_bank); addEdge(q5_bank, bankRouting);

  const bank_7  = addNode('action', 'Flag: Bankruptcy - Chapter 7',  { actionType: 'set_flag', flagName: 'bankruptcy_type', flagValue: 'Chapter 7 - Liquidation' });
  const bank_13 = addNode('action', 'Flag: Bankruptcy - Chapter 13', { actionType: 'set_flag', flagName: 'bankruptcy_type', flagValue: 'Chapter 13 - Individual Reorganization' });
  const bank_11 = addNode('action', 'Flag: Bankruptcy - Chapter 11', { actionType: 'set_flag', flagName: 'bankruptcy_type', flagValue: 'Chapter 11 - Business Reorganization' });
  const bank_unk = addNode('action', 'Flag: Bankruptcy - Unsure',    { actionType: 'set_flag', flagName: 'bankruptcy_type', flagValue: 'Chapter unknown - needs assessment' });

  const bankR_7   = resp('Chapter 7 - wipe out most debts (liquidation)');
  const bankR_13  = resp('Chapter 13 - repayment plan to keep assets');
  const bankR_11  = resp('Chapter 11 - business reorganization');
  const bankR_unk = resp('Not sure - I need guidance on which type is right for me');

  addEdge(bankRouting, bankR_7);   addEdge(bankR_7,   bank_7);
  addEdge(bankRouting, bankR_13);  addEdge(bankR_13,  bank_13);
  addEdge(bankRouting, bankR_11);  addEdge(bankR_11,  bank_11);
  addEdge(bankRouting, bankR_unk); addEdge(bankR_unk, bank_unk);

  const bankH1 = addNode('question', 'Bank H1. Primary Debt Type', {
    question: 'What is the primary type of debt you are struggling with?',
    collectFields: [
      { name: 'total_debt_estimate', label: 'Approximate total debt amount',     type: 'text', required: false },
      { name: 'monthly_income',      label: 'Approximate monthly household income', type: 'text', required: false },
    ],
  });
  [bank_7, bank_13, bank_11, bank_unk].forEach(n => addEdge(n, bankH1));

  const bankH2 = addNode('question', 'Bank H2. Urgency - Garnishment or Foreclosure', {
    question: 'Are you facing wage garnishment, bank levies, repossession, or an imminent foreclosure?',
    note: 'Active garnishments and foreclosures may require emergency bankruptcy filing',
  });
  const bankH1_med  = resp('Medical bills'); const bankH1_cc = resp('Credit card debt'); const bankH1_mort = resp('Mortgage or home equity loan'); const bankH1_bus = resp('Business debts'); const bankH1_tax = resp('Tax debt'); const bankH1_mix = resp('A mix of several types');
  [bankH1_med, bankH1_cc, bankH1_mort, bankH1_bus, bankH1_tax, bankH1_mix].forEach(r => { addEdge(bankH1, r); addEdge(r, bankH2); });

  const bankUrgent = addNode('action', 'Flag: Bankruptcy - Urgent', { actionType: 'set_flag', flagName: 'urgencyFlag', flagValue: 'bankruptcy_emergency', note: 'Active garnishment, foreclosure, or repossession may require emergency filing.' });
  const bankH3 = addNode('question', 'Bank H3. Prior Bankruptcy History', {
    question: 'Have you filed for bankruptcy before?',
    collectFields: [{ name: 'assets_summary', label: 'Key assets (home, car, retirement accounts)', type: 'text', required: false }],
  });
  const bankH2_garn = resp('Yes - active wage garnishment or bank levy', 'FLAG URGENT: Auto-stay from filing would stop garnishment immediately.');
  const bankH2_fore = resp('Yes - imminent foreclosure or repossession', 'FLAG URGENT: Emergency filing may stop foreclosure.');
  const bankH2_no   = resp('No - planning ahead or exploring options');
  addEdge(bankH2, bankH2_garn); addEdge(bankH2_garn, bankUrgent); addEdge(bankUrgent, transferId);
  addEdge(bankH2, bankH2_fore); addEdge(bankH2_fore, bankUrgent);
  addEdge(bankH2, bankH2_no);   addEdge(bankH2_no,   bankH3);

  const bankH3_never = resp('No prior bankruptcy'); const bankH3_prev = resp('Filed before - more than 8 years ago'); const bankH3_rec = resp('Filed within the last 8 years', 'Note: prior recent filing may affect eligibility for certain chapters.');
  [bankH3_never, bankH3_prev, bankH3_rec].forEach(r => { addEdge(bankH3, r); addEdge(r, transferId); });

  // ═══════════════════════════════════════════════════════════════
  // BRANCH 9 — TAX LAW
  // ═══════════════════════════════════════════════════════════════

  const taxRouting = addNode('question', 'Tax Law - Matter Type', {
    note: 'What type of tax matter do you need legal help with?',
  });
  const q5_tax = q5r('Tax Law', "Caller's situation involves tax law or the IRS", 'Route here when the caller describes: an IRS audit, back taxes owed, a tax lien or levy on wages or bank account, a tax court appeal, suspected tax fraud, or needing help with tax planning or an IRS notice.');
  addEdge(q5, q5_tax); addEdge(q5_tax, taxRouting);

  const tax_audit  = addNode('action', 'Flag: Tax - Audit',         { actionType: 'set_flag', flagName: 'tax_matter', flagValue: 'IRS or state tax audit' });
  const tax_lien   = addNode('action', 'Flag: Tax - Lien/Levy',     { actionType: 'set_flag', flagName: 'tax_matter', flagValue: 'Tax lien or levy', note: 'Tax lien/levy is time-critical' });
  const tax_debt   = addNode('action', 'Flag: Tax - Back Taxes',    { actionType: 'set_flag', flagName: 'tax_matter', flagValue: 'Back taxes / tax debt resolution' });
  const tax_criml  = addNode('action', 'Flag: Tax - Criminal',      { actionType: 'set_flag', flagName: 'tax_matter', flagValue: 'Criminal tax investigation or charges' });
  const tax_appeal = addNode('action', 'Flag: Tax - Appeal',        { actionType: 'set_flag', flagName: 'tax_matter', flagValue: 'Tax court appeal or deficiency notice' });
  const tax_plan   = addNode('action', 'Flag: Tax - Planning',      { actionType: 'set_flag', flagName: 'tax_matter', flagValue: 'Tax planning or business structuring' });
  const tax_other  = addNode('action', 'Flag: Tax - Other',         { actionType: 'set_flag', flagName: 'tax_matter', flagValue: 'Other tax matter' });

  const taxR_audit  = resp('IRS or state tax audit');
  const taxR_lien   = resp('Tax lien, bank levy, or wage garnishment by IRS');
  const taxR_debt   = resp('Back taxes or unpaid tax debt resolution');
  const taxR_criml  = resp('Criminal tax investigation, tax fraud, or tax evasion charge');
  const taxR_appeal = resp('Tax court appeal or IRS deficiency notice');
  const taxR_plan   = resp('Tax planning, minimization, or business structuring');
  const taxR_other  = resp('Other tax law matter');

  addEdge(taxRouting, taxR_audit);  addEdge(taxR_audit,  tax_audit);
  addEdge(taxRouting, taxR_lien);   addEdge(taxR_lien,   tax_lien);
  addEdge(taxRouting, taxR_debt);   addEdge(taxR_debt,   tax_debt);
  addEdge(taxRouting, taxR_criml);  addEdge(taxR_criml,  tax_criml);
  addEdge(taxRouting, taxR_appeal); addEdge(taxR_appeal, tax_appeal);
  addEdge(taxRouting, taxR_plan);   addEdge(taxR_plan,   tax_plan);
  addEdge(taxRouting, taxR_other);  addEdge(taxR_other,  tax_other);

  const taxI1 = addNode('question', 'Tax I1. IRS or State Level', {
    question: 'Is this an IRS (federal) matter, a state tax matter, or both?',
    collectFields: [
      { name: 'tax_years',       label: 'Tax years involved',               type: 'text', required: false },
      { name: 'estimated_amount', label: 'Approximate amount owed or at issue', type: 'text', required: false },
    ],
  });
  [tax_audit, tax_lien, tax_debt, tax_criml, tax_appeal, tax_plan, tax_other].forEach(n => addEdge(n, taxI1));

  const taxI2 = addNode('question', 'Tax I2. Urgency - Active Action', {
    question: 'Is the IRS or state tax authority currently taking action (lien, levy, seizure, or criminal investigation)?',
    note: 'Active IRS enforcement requires immediate response - deadlines are strict',
  });
  const taxI1_fed = resp('Federal IRS only'); const taxI1_state = resp('State tax authority only'); const taxI1_both = resp('Both federal and state');
  [taxI1_fed, taxI1_state, taxI1_both].forEach(r => { addEdge(taxI1, r); addEdge(r, taxI2); });

  const taxUrgent = addNode('action', 'Flag: Tax - URGENT Active Enforcement', { actionType: 'set_flag', flagName: 'urgencyFlag', flagValue: 'irs_enforcement_urgent', note: 'Active IRS enforcement. Immediate attorney response required.' });
  const taxI3 = addNode('question', 'Tax I3. Prior Contact and Representation', {
    question: 'Have you received any notices, and have you responded or hired anyone before?',
  });
  const taxI2_lien   = resp('Yes - active lien or levy on bank/wages', 'FLAG URGENT: Active enforcement action.');
  const taxI2_criml  = resp('Yes - criminal investigation or summons',  'FLAG URGENT: Criminal tax matter.');
  const taxI2_notice = resp('Yes - notices received but no enforcement yet');
  const taxI2_no     = resp('No - proactive planning or early stage');
  addEdge(taxI2, taxI2_lien);   addEdge(taxI2_lien,   taxUrgent); addEdge(taxUrgent, transferId);
  addEdge(taxI2, taxI2_criml);  addEdge(taxI2_criml,  taxUrgent);
  addEdge(taxI2, taxI2_notice); addEdge(taxI2_notice, taxI3);
  addEdge(taxI2, taxI2_no);     addEdge(taxI2_no,     taxI3);

  const taxI3_none = resp('No prior contact or representation'); const taxI3_cpa = resp('Working with a CPA but need an attorney'); const taxI3_prev = resp('Had prior representation - seeking new attorney');
  [taxI3_none, taxI3_cpa, taxI3_prev].forEach(r => { addEdge(taxI3, r); addEdge(r, transferId); });

  // ═══════════════════════════════════════════════════════════════
  // BRANCH 10 — ESTATE PLANNING
  // ═══════════════════════════════════════════════════════════════

  const estRouting = addNode('question', 'Estate Planning - Matter Type', {
    note: 'What type of estate planning or probate matter do you need help with?',
  });
  const q5_est = q5r('Estate Planning', "Caller's situation involves estate planning or probate", 'Route here when the caller describes: wanting to write or update a will, setting up a trust, handling a deceased family member\'s estate, needing a power of attorney or healthcare directive, or contesting a will.');
  addEdge(q5, q5_est); addEdge(q5_est, estRouting);

  const est_will   = addNode('action', 'Flag: Estate - Will',         { actionType: 'set_flag', flagName: 'estate_matter', flagValue: 'Will drafting or updating' });
  const est_trust  = addNode('action', 'Flag: Estate - Trust',        { actionType: 'set_flag', flagName: 'estate_matter', flagValue: 'Trust creation or administration' });
  const est_prob   = addNode('action', 'Flag: Estate - Probate',      { actionType: 'set_flag', flagName: 'estate_matter', flagValue: 'Probate administration' });
  const est_poa    = addNode('action', 'Flag: Estate - POA/HC',       { actionType: 'set_flag', flagName: 'estate_matter', flagValue: 'Power of attorney or healthcare directive' });
  const est_guard  = addNode('action', 'Flag: Estate - Guardianship', { actionType: 'set_flag', flagName: 'estate_matter', flagValue: 'Guardianship or conservatorship (adult)' });
  const est_contest = addNode('action', 'Flag: Estate - Contest',     { actionType: 'set_flag', flagName: 'estate_matter', flagValue: 'Will or trust contest / estate dispute' });
  const est_other  = addNode('action', 'Flag: Estate - Other',        { actionType: 'set_flag', flagName: 'estate_matter', flagValue: 'Other estate or probate matter' });

  const estR_will   = resp('Drafting or updating a will');
  const estR_trust  = resp('Creating or administering a trust');
  const estR_prob   = resp('Probate - administering a deceased person\'s estate');
  const estR_poa    = resp('Power of attorney or advance healthcare directive');
  const estR_guard  = resp('Guardianship or conservatorship for an adult');
  const estR_contest = resp('Contesting or disputing a will or trust');
  const estR_other  = resp('Other estate planning or elder law matter');

  addEdge(estRouting, estR_will);    addEdge(estR_will,    est_will);
  addEdge(estRouting, estR_trust);   addEdge(estR_trust,   est_trust);
  addEdge(estRouting, estR_prob);    addEdge(estR_prob,    est_prob);
  addEdge(estRouting, estR_poa);     addEdge(estR_poa,     est_poa);
  addEdge(estRouting, estR_guard);   addEdge(estR_guard,   est_guard);
  addEdge(estRouting, estR_contest); addEdge(estR_contest, est_contest);
  addEdge(estRouting, estR_other);   addEdge(estR_other,   est_other);

  const estJ1 = addNode('question', 'Estate J1. Health and Urgency', {
    question: 'Is this matter urgent due to a health situation, a recent death, or an impending court date?',
    note: 'Probate deadlines and health crises may require expedited service',
  });
  [est_will, est_trust, est_prob, est_poa, est_guard, est_contest, est_other].forEach(n => addEdge(n, estJ1));

  const estJ2 = addNode('question', 'Estate J2. Estate Size and Assets', {
    question: 'Can you give me a general sense of the estate size and types of assets involved?',
    collectFields: [
      { name: 'estate_assets',  label: 'Types of assets (real estate, investments, business, etc.)', type: 'text', required: false },
      { name: 'estate_size',    label: 'Approximate estate value range',                              type: 'text', required: false },
      { name: 'state_of_assets', label: 'State(s) where assets are located',                          type: 'text', required: false },
    ],
  });
  const estJ1_urgent = resp('Yes - health crisis, recent death, or imminent probate deadline', 'FLAG: Time-sensitive estate matter.');
  const estJ1_soon   = resp('Yes - planning ahead due to age or illness');
  const estJ1_plan   = resp('No urgency - general planning or updating documents');
  addEdge(estJ1, estJ1_urgent); addEdge(estJ1_urgent, estJ2);
  addEdge(estJ1, estJ1_soon);   addEdge(estJ1_soon,   estJ2);
  addEdge(estJ1, estJ1_plan);   addEdge(estJ1_plan,   estJ2);

  const estJ2_sm = resp('Modest estate (under $500K)'); const estJ2_med = resp('Mid-size estate ($500K - $2M)'); const estJ2_lg = resp('Large estate (over $2M)'); const estJ2_unk = resp('Unsure of estate value');
  [estJ2_sm, estJ2_med, estJ2_lg, estJ2_unk].forEach(r => { addEdge(estJ2, r); addEdge(r, transferId); });

  // ═══════════════════════════════════════════════════════════════
  // BRANCH 11 — INTELLECTUAL PROPERTY
  // ═══════════════════════════════════════════════════════════════

  const ipRouting = addNode('question', 'IP - Matter Type', {
    note: 'What type of intellectual property matter do you need help with?',
  });
  const q5_ip = q5r('Intellectual Property', "Caller's situation involves intellectual property", 'Route here when the caller describes: someone copying their brand name or logo, protecting an invention, a copyright infringement, a stolen trade secret, or needing a licensing agreement for creative or technical work.');
  addEdge(q5, q5_ip); addEdge(q5_ip, ipRouting);

  const ip_tm   = addNode('action', 'Flag: IP - Trademark',   { actionType: 'set_flag', flagName: 'ip_matter', flagValue: 'Trademark registration or infringement' });
  const ip_copy = addNode('action', 'Flag: IP - Copyright',   { actionType: 'set_flag', flagName: 'ip_matter', flagValue: 'Copyright registration or infringement' });
  const ip_pat  = addNode('action', 'Flag: IP - Patent',      { actionType: 'set_flag', flagName: 'ip_matter', flagValue: 'Patent application or infringement' });
  const ip_ts   = addNode('action', 'Flag: IP - Trade Secret', { actionType: 'set_flag', flagName: 'ip_matter', flagValue: 'Trade secret misappropriation' });
  const ip_lic  = addNode('action', 'Flag: IP - Licensing',   { actionType: 'set_flag', flagName: 'ip_matter', flagValue: 'IP licensing or technology transfer' });
  const ip_other = addNode('action', 'Flag: IP - Other',      { actionType: 'set_flag', flagName: 'ip_matter', flagValue: 'Other intellectual property matter' });

  const ipR_tm   = resp('Trademark - registering or protecting a brand name or logo');
  const ipR_copy = resp('Copyright - protecting creative work or stopping infringement');
  const ipR_pat  = resp('Patent - protecting an invention or stopping patent infringement');
  const ipR_ts   = resp('Trade secret - confidential business information was stolen or misused');
  const ipR_lic  = resp('IP licensing, technology transfer, or joint development agreement');
  const ipR_other = resp('Other intellectual property or innovation matter');

  addEdge(ipRouting, ipR_tm);    addEdge(ipR_tm,    ip_tm);
  addEdge(ipRouting, ipR_copy);  addEdge(ipR_copy,  ip_copy);
  addEdge(ipRouting, ipR_pat);   addEdge(ipR_pat,   ip_pat);
  addEdge(ipRouting, ipR_ts);    addEdge(ipR_ts,    ip_ts);
  addEdge(ipRouting, ipR_lic);   addEdge(ipR_lic,   ip_lic);
  addEdge(ipRouting, ipR_other); addEdge(ipR_other, ip_other);

  const ipK1 = addNode('question', 'IP K1. Registration Status', {
    question: 'Has your IP been registered, or is this about stopping someone else from using it?',
    collectFields: [
      { name: 'ip_description', label: 'Brief description of the IP (name, invention, work)', type: 'text', required: true },
      { name: 'ip_registered',  label: 'Is it currently registered? (Yes / No / Applied)',    type: 'text', required: false },
    ],
  });
  [ip_tm, ip_copy, ip_pat, ip_ts, ip_lic, ip_other].forEach(n => addEdge(n, ipK1));

  const ipK2 = addNode('question', 'IP K2. Infringement Urgency', {
    question: 'Is someone currently infringing on your IP, or has a cease-and-desist or lawsuit been filed?',
    note: 'Active infringement or legal action requires immediate response',
  });
  const ipK1_reg  = resp('Already registered'); const ipK1_app = resp('Application pending'); const ipK1_unreg = resp('Not yet registered'); const ipK1_stop = resp('Trying to stop someone else / infringement');
  [ipK1_reg, ipK1_app, ipK1_unreg, ipK1_stop].forEach(r => { addEdge(ipK1, r); addEdge(r, ipK2); });

  const ipUrgent = addNode('action', 'Flag: IP - Urgent Infringement', { actionType: 'set_flag', flagName: 'urgencyFlag', flagValue: 'ip_infringement_urgent', note: 'Active infringement with legal action. Injunctive relief may be needed urgently.' });
  const ipK2_sue  = resp('Yes - lawsuit or cease-and-desist received or filed', 'FLAG URGENT: Active IP litigation.');
  const ipK2_inf  = resp('Yes - active infringement but no legal action yet');
  const ipK2_no   = resp('No infringement - registration or proactive protection');
  addEdge(ipK2, ipK2_sue); addEdge(ipK2_sue, ipUrgent); addEdge(ipUrgent, transferId);
  addEdge(ipK2, ipK2_inf); addEdge(ipK2_inf, transferId);
  addEdge(ipK2, ipK2_no);  addEdge(ipK2_no,  transferId);

  // ═══════════════════════════════════════════════════════════════
  // BRANCH 12 — CIVIL RIGHTS
  // ═══════════════════════════════════════════════════════════════

  const crRouting = addNode('question', 'Civil Rights - Matter Type', {
    note: 'What type of civil rights matter do you need help with?',
  });
  const q5_cr = q5r('Civil Rights', "Caller's situation involves a civil rights violation", 'Route here when the caller describes: police brutality or misconduct, an unlawful arrest or search, discrimination by a government agency, their free speech or religion being suppressed, or their rights being violated by a public institution.');
  addEdge(q5, q5_cr); addEdge(q5_cr, crRouting);

  const cr_police = addNode('action', 'Flag: CR - Police Misconduct',    { actionType: 'set_flag', flagName: 'cr_matter', flagValue: 'Police misconduct / excessive force' });
  const cr_1st    = addNode('action', 'Flag: CR - 1st Amendment',        { actionType: 'set_flag', flagName: 'cr_matter', flagValue: 'First Amendment violation (speech, religion, assembly)' });
  const cr_4th    = addNode('action', 'Flag: CR - 4th Amendment',        { actionType: 'set_flag', flagName: 'cr_matter', flagValue: 'Unlawful search and seizure (4th Amendment)' });
  const cr_disc   = addNode('action', 'Flag: CR - Gov Discrimination',   { actionType: 'set_flag', flagName: 'cr_matter', flagValue: 'Government / public discrimination (race, gender, disability)' });
  const cr_prison = addNode('action', 'Flag: CR - Prisoner Rights',      { actionType: 'set_flag', flagName: 'cr_matter', flagValue: 'Prisoner or detainee rights violation' });
  const cr_voting = addNode('action', 'Flag: CR - Voting Rights',        { actionType: 'set_flag', flagName: 'cr_matter', flagValue: 'Voting rights violation' });
  const cr_ada    = addNode('action', 'Flag: CR - ADA/Disability Access', { actionType: 'set_flag', flagName: 'cr_matter', flagValue: 'ADA / disability access violation' });
  const cr_other  = addNode('action', 'Flag: CR - Other',                { actionType: 'set_flag', flagName: 'cr_matter', flagValue: 'Other civil rights violation' });

  const crR_police = resp('Police misconduct, excessive force, or wrongful arrest');
  const crR_1st    = resp('First Amendment violation (free speech, religion, protest)');
  const crR_4th    = resp('Unlawful search, seizure, or surveillance');
  const crR_disc   = resp('Government or public entity discrimination based on race, gender, or identity');
  const crR_prison = resp('Prisoner or detainee rights (cruel treatment, due process)');
  const crR_voting = resp('Voting rights violation or election interference');
  const crR_ada    = resp('ADA or disability access violation by a public entity');
  const crR_other  = resp('Other civil rights violation');

  addEdge(crRouting, crR_police); addEdge(crR_police, cr_police);
  addEdge(crRouting, crR_1st);    addEdge(crR_1st,    cr_1st);
  addEdge(crRouting, crR_4th);    addEdge(crR_4th,    cr_4th);
  addEdge(crRouting, crR_disc);   addEdge(crR_disc,   cr_disc);
  addEdge(crRouting, crR_prison); addEdge(crR_prison, cr_prison);
  addEdge(crRouting, crR_voting); addEdge(crR_voting, cr_voting);
  addEdge(crRouting, crR_ada);    addEdge(crR_ada,    cr_ada);
  addEdge(crRouting, crR_other);  addEdge(crR_other,  cr_other);

  const crL1 = addNode('question', 'CR L1. Who Committed the Violation', {
    question: 'Was this committed by a government official, law enforcement, or a public institution?',
    collectFields: [
      { name: 'incident_date',     label: 'Date of the incident',                       type: 'text', required: true },
      { name: 'agency_or_entity',  label: 'Government agency or entity involved',        type: 'text', required: false },
      { name: 'incident_location', label: 'Location where the incident occurred',        type: 'text', required: false },
    ],
  });
  [cr_police, cr_1st, cr_4th, cr_disc, cr_prison, cr_voting, cr_ada, cr_other].forEach(n => addEdge(n, crL1));

  const crL2 = addNode('question', 'CR L2. Injuries and Documentation', {
    question: 'Were there physical injuries, financial losses, or other documented harms?',
    note: 'Section 1983 claims have strict notice and filing requirements - timing matters',
  });
  const crL1_police  = resp('Law enforcement officer or police department');
  const crL1_govt    = resp('Local, state, or federal government agency');
  const crL1_prison  = resp('Corrections officer or jail / prison facility');
  const crL1_school  = resp('Public school or university');
  const crL1_other   = resp('Other government or public entity');
  [crL1_police, crL1_govt, crL1_prison, crL1_school, crL1_other].forEach(r => { addEdge(crL1, r); addEdge(r, crL2); });

  const crL2_yes  = resp('Yes - physical injuries, medical treatment, or significant financial loss');
  const crL2_part = resp('Emotional distress, loss of liberty, or reputational harm');
  const crL2_no   = resp('No significant physical or financial harm - seeking injunctive relief');
  [crL2_yes, crL2_part, crL2_no].forEach(r => { addEdge(crL2, r); addEdge(r, transferId); });

  // ═══════════════════════════════════════════════════════════════
  // BRANCH 13 — ENVIRONMENTAL
  // ═══════════════════════════════════════════════════════════════

  const envRouting = addNode('question', 'Environmental - Matter Type', {
    note: 'What type of environmental or natural resources matter do you need legal help with?',
  });
  const q5_env = q5r('Environmental', "Caller's situation involves environmental law", 'Route here when the caller describes: contaminated water or soil near their property, an EPA or state agency enforcement action, a permit dispute, natural resource rights (water, minerals), illness from toxic exposure, or a Superfund cleanup liability.');
  addEdge(q5, q5_env); addEdge(q5_env, envRouting);

  const env_contam  = addNode('action', 'Flag: Env - Contamination',   { actionType: 'set_flag', flagName: 'env_matter', flagValue: 'Property or water contamination (toxic exposure)' });
  const env_reg     = addNode('action', 'Flag: Env - Regulatory',      { actionType: 'set_flag', flagName: 'env_matter', flagValue: 'Regulatory compliance or EPA violation' });
  const env_permit  = addNode('action', 'Flag: Env - Permit',          { actionType: 'set_flag', flagName: 'env_matter', flagValue: 'Environmental permit application or challenge' });
  const env_natural = addNode('action', 'Flag: Env - Natural Resources', { actionType: 'set_flag', flagName: 'env_matter', flagValue: 'Natural resources (water rights, mineral rights, land use)' });
  const env_injury  = addNode('action', 'Flag: Env - Toxic Tort',      { actionType: 'set_flag', flagName: 'env_matter', flagValue: 'Toxic tort - personal injury from environmental exposure' });
  const env_clean   = addNode('action', 'Flag: Env - Cleanup',         { actionType: 'set_flag', flagName: 'env_matter', flagValue: 'Superfund / brownfield cleanup liability' });
  const env_other   = addNode('action', 'Flag: Env - Other',           { actionType: 'set_flag', flagName: 'env_matter', flagValue: 'Other environmental matter' });

  const envR_contam  = resp('Property, soil, or water contamination from a neighbor or company');
  const envR_reg     = resp('EPA, state agency, or regulatory compliance violation or enforcement');
  const envR_permit  = resp('Environmental permit application, renewal, or challenge');
  const envR_natural = resp('Water rights, mineral rights, or natural resource dispute');
  const envR_injury  = resp('Personal injury or illness from toxic chemical or environmental exposure');
  const envR_clean   = resp('Superfund, brownfield, or hazardous waste cleanup liability');
  const envR_other   = resp('Other environmental or natural resources matter');

  addEdge(envRouting, envR_contam);  addEdge(envR_contam,  env_contam);
  addEdge(envRouting, envR_reg);     addEdge(envR_reg,     env_reg);
  addEdge(envRouting, envR_permit);  addEdge(envR_permit,  env_permit);
  addEdge(envRouting, envR_natural); addEdge(envR_natural, env_natural);
  addEdge(envRouting, envR_injury);  addEdge(envR_injury,  env_injury);
  addEdge(envRouting, envR_clean);   addEdge(envR_clean,   env_clean);
  addEdge(envRouting, envR_other);   addEdge(envR_other,   env_other);

  const envM1 = addNode('question', 'Env M1. Your Role in This Matter', {
    question: 'Are you a property owner, a business being regulated, or someone harmed by environmental contamination?',
    collectFields: [
      { name: 'location_description', label: 'Location or property involved', type: 'text', required: false },
      { name: 'contaminant',          label: 'Substance or pollutant involved (if known)', type: 'text', required: false },
    ],
  });
  [env_contam, env_reg, env_permit, env_natural, env_injury, env_clean, env_other].forEach(n => addEdge(n, envM1));

  const envM2 = addNode('question', 'Env M2. Regulatory Action or Enforcement', {
    question: 'Is there a pending enforcement action, cleanup order, or regulatory deadline from an agency?',
    note: 'EPA and state agency orders have strict response deadlines - non-response can waive rights',
  });
  const envM1_owner  = resp('Property owner or developer affected by regulations or contamination');
  const envM1_biz    = resp('Business subject to environmental regulations or enforcement');
  const envM1_person = resp('Individual harmed by toxic exposure or contamination');
  const envM1_ngo    = resp('Nonprofit or community group challenging a project or permit');
  [envM1_owner, envM1_biz, envM1_person, envM1_ngo].forEach(r => { addEdge(envM1, r); addEdge(r, envM2); });

  const envUrgent = addNode('action', 'Flag: Env - URGENT Enforcement', { actionType: 'set_flag', flagName: 'urgencyFlag', flagValue: 'env_enforcement_urgent', note: 'Active regulatory enforcement with imminent deadline. Immediate legal response required.' });
  const envM2_active = resp('Yes - enforcement order, cleanup demand, or deadline within 30 days', 'FLAG URGENT: Active regulatory enforcement.');
  const envM2_soon   = resp('Yes - agency action expected or pending but not yet formal');
  const envM2_no     = resp('No active enforcement - planning, permitting, or damages claim');
  addEdge(envM2, envM2_active); addEdge(envM2_active, envUrgent); addEdge(envUrgent, transferId);
  addEdge(envM2, envM2_soon);   addEdge(envM2_soon,   transferId);
  addEdge(envM2, envM2_no);     addEdge(envM2_no,     transferId);

  // ═══════════════════════════════════════════════════════════════
  // BRANCH 14 — SOMETHING ELSE (catch-all)
  // ═══════════════════════════════════════════════════════════════

  const otherFlag = addNode('action', 'Flag: General - Other Matter', {
    actionType: 'set_flag', flagName: 'practice_area', flagValue: 'General inquiry - attorney consultation required',
    note: 'Catch-all: attorney consultation needed to determine correct practice area',
  });
  const q5_other = q5r('Other', "Caller's situation does not clearly match a specific area", 'Route here only if the caller\'s situation genuinely does not fit any of the above categories after careful listening. Say: "That\'s helpful - I\'ll make sure this gets to the right lawyer so they can assess exactly what type of help you need."');
  addEdge(q5, q5_other); addEdge(q5_other, otherFlag); addEdge(otherFlag, transferId);

  return {
    name: 'General Legal Intake - All Practice Areas',
    description: 'Comprehensive AI intake covering all 13 practice areas: Family, Criminal, Immigration, Personal Injury, Corporate, Real Estate, Employment, Bankruptcy, Tax, Estate Planning, Intellectual Property, Civil Rights, and Environmental law. Each branch collects the right information and screens for urgency.',
    isTemplate: true,
    nodes,
    edges,
  };
}
