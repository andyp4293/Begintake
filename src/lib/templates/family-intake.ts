/**
 * Family Court Intake Template
 *
 * Mirrors the main intake structure while keeping routing focused on family-law matters.
 * It also includes explicit fallback paths when the caller describes a legal issue that
 * sounds outside family law, so the shared runner can direct them back to the firm's
 * main line without forcing the caller into the wrong branch.
 */

let nc = 0;
function nodeId() { return `fi-node-${++nc}`; }
let ec = 0;
function edgeId() { return `fi-edge-${++ec}`; }

const FAMILY_INTAKE_ALWAYS_EXPANDED_QUESTION_LABELS = new Set([
  'Q1. Shall we get started?',
  'Q1b. New or Existing Client?',
  'Q2. Caller Name',
  'Q3. Best Phone Number',
  'Q4. Self or On Behalf Of',
  "Q5. Tell Me What's Going On",
]);

export function createFamilyIntakeTemplate() {
  nc = 0;
  ec = 0;

  const nodes: any[] = [];
  const edges: any[] = [];

  function addNode(type: string, label: string, config: any) {
    const resolvedConfig = type === 'question' && !FAMILY_INTAKE_ALWAYS_EXPANDED_QUESTION_LABELS.has(label)
      ? { ...config, defaultCollapsed: config?.defaultCollapsed ?? true }
      : config;
    const id = nodeId();
    nodes.push({
      id,
      type,
      label,
      config: resolvedConfig,
      positionX: 0,
      positionY: nodes.length * 120,
      sortOrder: nodes.length,
    });
    return id;
  }

  function addEdge(sourceNodeId: string, targetNodeId: string) {
    edges.push({
      id: edgeId(),
      sourceNodeId,
      targetNodeId,
      label: null,
      condition: null,
      sortOrder: edges.length,
    });
  }

  function resp(label: string, instruction = '') {
    return addNode('response', label, { response: label, instruction });
  }

  function q5r(shortLabel: string, fullResponse: string, instruction: string) {
    return addNode('response', shortLabel, { response: fullResponse, instruction });
  }

  const transferId = addNode('transfer', 'Transfer to Attorney', {
    transferTarget: 'attorney',
    handoffMode: 'summary_only',
    callbackMessage: 'Thank you. I wrote down everything you shared with me today so I can pass this to the right lawyer for your case. They will review it and call you back at the best callback number I have for you.',
    message: 'Thank you. I wrote down everything you shared with me today so I can pass this to the right lawyer for your case. They will review it and call you back at the best callback number I have for you.',
    includeNotes: true,
    transferData: ['caller_name', 'phone', 'party_role', 'practice_area', 'matter_type', 'petition_type', 'urgency_flag', 'all_collected_fields'],
  });

  const transferParalegalId = addNode('transfer', 'Transfer to Paralegal', {
    transferTarget: 'paralegal',
    handoffMode: 'live_transfer',
    callbackMessage: "Welcome back. I've sent this to our team, and the right lawyer will reach out to you shortly.",
  });

  const outsideFamilyScopeId = addNode('action', 'Flag: Outside Family Scope', {
    actionType: 'set_flag',
    flagName: 'practiceArea',
    flagValue: 'outside_family_scope',
    note: 'Caller described a legal issue that sounds outside family law, such as criminal charges, immigration, personal injury, employment, real estate, business, bankruptcy, tax, estate planning, intellectual property, civil rights, or environmental matters. Do not force it into a family branch. Tell them this line is for family law only and direct them to the main line.',
  });
  const outsideFamilyLineEndId = addNode('end', 'Family Line Only - Call Main Line', {
    closingMessage: 'This line is for family law only, please call the main line.',
  });
  addEdge(outsideFamilyScopeId, outsideFamilyLineEndId);

  const startId = addNode('start', 'Opening Greeting', {
    greeting: "Thank you for calling {firm}. I am the AI assistant, {name}, and I'll ask you a few questions to figure out how we can best help you. You may request to get transferred to a paralegal at any time.",
  });

  const q1 = addNode('question', 'Q1. Shall we get started?', { question: 'Shall we get started?' });
  addEdge(startId, q1);

  const q1b = addNode('question', 'Q1b. New or Existing Client?', {
    question: 'Have you worked with our firm before, or is this your first time reaching out to us?',
    note: 'This helps us route you correctly. Listen for any indication they are a returning client.',
  });

  const q1_yes = resp("Yes, let's begin");
  const q1_what = resp('What is this for?', 'Briefly explain: "I\'ll collect some basic information about your situation so the right lawyer can review it. After that, they\'ll reach out to you about next steps. It only takes a few minutes."');
  addEdge(q1, q1_yes);
  addEdge(q1_yes, q1b);
  addEdge(q1, q1_what);
  addEdge(q1_what, q1b);

  const q1b_existing = resp('Existing client - worked with firm before');
  const q1b_new = resp('New client - first time calling');
  addEdge(q1b, q1b_existing);
  addEdge(q1b_existing, transferParalegalId);
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
  const q3_no = resp('No, use a different number', 'Ask: "What\'s the best number to reach you?" Collect and note it.');
  addEdge(q3, q3_yes);
  addEdge(q3_yes, q4);
  addEdge(q3, q3_no);
  addEdge(q3_no, q3a);
  addEdge(q3a, q4);

  const q5 = addNode('question', "Q5. Tell Me What's Going On", {
    note: 'Ask the caller to describe their situation in their own words. Be warm and inviting - say something like "Thanks. Can you tell me a little about what\'s been going on?" Do NOT read a list of family categories. Listen carefully, ask gentle follow-up questions if needed, and figure out whether this sounds like custody, support, protection, child welfare, paternity, adoption, juvenile, divorce, another family-law issue, or a different practice area entirely. If it does not sound like family law, do not force it into a family branch. The caller should feel heard, not processed.',
  });
  const q4_self = resp('For myself');
  const q4_other = resp('On behalf of someone else', 'Ask: "What is your relationship to them?" Note it.');
  addEdge(q4, q4_self);
  addEdge(q4_self, q5);
  addEdge(q4, q4_other);
  addEdge(q4_other, q5);

  const famTriage = addNode('question', 'Family Law - Matter Triage', {
    note: 'What brings you to us today regarding your family matter?',
  });
  const q5_fam = q5r(
    'Family Law',
    "Caller's situation involves family law",
    'Route here only when you know the caller needs family law help but the specific family matter is still unclear.',
  );
  addEdge(q5, q5_fam);
  addEdge(q5_fam, famTriage);

  const q5_outside = q5r(
    'Different practice area / not family law',
    "Caller's situation sounds like a non-family legal matter or a different practice area",
    'Use this when the caller is describing a legal issue that sounds outside family law, such as a DUI, arrest, criminal charge, probation issue, green card or visa problem, immigration case, car accident or injury claim, employment discrimination, wrongful termination, real estate dispute, property problem, business or contract dispute, bankruptcy, IRS or tax matter, will or trust issue, trademark or copyright issue, police misconduct, civil rights matter, or environmental problem. Do not force it into a family branch. Route to the family-line-only closing instead.',
  );
  addEdge(q5, q5_outside);
  addEdge(q5_outside, outsideFamilyScopeId);

  const famOutside = resp(
    'Different practice area / not family law',
    'Use this when the caller clarifies that the matter actually sounds outside family law, such as a DUI, arrest, criminal charge, probation issue, green card or visa problem, immigration case, car accident or injury claim, employment discrimination, wrongful termination, real estate dispute, property problem, business or contract dispute, bankruptcy, IRS or tax matter, will or trust issue, trademark or copyright issue, police misconduct, civil rights matter, or environmental problem. Route to the family-line-only closing instead of continuing family intake.',
  );
  addEdge(famTriage, famOutside);
  addEdge(famOutside, outsideFamilyScopeId);

  const famACustodyRouting = addNode('question', 'FA - Custody Order Status', {
    note: 'Is there currently a custody order in place?',
  });
  const famA_q5 = resp('Custody or visitation of my children');
  addEdge(famTriage, famA_q5);
  addEdge(famA_q5, famACustodyRouting);

  const famA_new = addNode('action', 'Flag: V-Petition - new', { actionType: 'set_flag', flagName: 'petitionType', flagValue: 'V-Petition (Custody) - new' });
  const famA_mod = addNode('action', 'Flag: V-Petition - modification', { actionType: 'set_flag', flagName: 'petitionType', flagValue: 'V-Petition - modification', note: 'Substantial change in circumstances required' });
  const famA_viol = addNode('action', 'Flag: V-Petition - enforcement', { actionType: 'set_flag', flagName: 'petitionType', flagValue: 'V-Petition - violation/enforcement', note: 'Flag potential contempt' });

  const famAR_new = resp('No order exists - new petition');
  const famAR_mod = resp('Order exists - want to modify');
  const famAR_viol = resp('Order exists - being violated');
  addEdge(famACustodyRouting, famAR_new);
  addEdge(famAR_new, famA_new);
  addEdge(famACustodyRouting, famAR_mod);
  addEdge(famAR_mod, famA_mod);
  addEdge(famACustodyRouting, famAR_viol);
  addEdge(famAR_viol, famA_viol);

  const famA1 = addNode('question', 'FA1. Marital / Relationship Status', {
    question: 'What is your marital or relationship status with the other parent?',
    note: 'Married/divorcing may need Supreme Court referral',
  });
  addEdge(famA_new, famA1);
  addEdge(famA_mod, famA1);
  addEdge(famA_viol, famA1);

  const famA2 = addNode('question', 'FA2. Type of Custody Sought', {
    question: 'Are you seeking physical custody, legal custody, or both?',
  });
  const famA1_married = resp('Married or divorcing', 'Note: may need Supreme Court referral for divorce.');
  const famA1_never = resp('Never married');
  const famA1_sep = resp('Separated or divorced');
  addEdge(famA1, famA1_married);
  addEdge(famA1_married, famA2);
  addEdge(famA1, famA1_never);
  addEdge(famA1_never, famA2);
  addEdge(famA1, famA1_sep);
  addEdge(famA1_sep, famA2);

  const famA3 = addNode('question', 'FA3. Children - Number and Ages', {
    question: 'How many children are involved, and how old are they?',
    collectFields: [
      { name: 'num_children', label: 'Number of children involved', type: 'text', required: true },
      { name: 'children_ages', label: 'Ages of each child', type: 'text', required: true },
    ],
    note: 'If teenager 13-17, court may consider child preference',
  });
  const famA2_phys = resp('Physical custody (residence)');
  const famA2_legal = resp('Legal custody (decision-making)');
  const famA2_both = resp('Both / unsure');
  addEdge(famA2, famA2_phys);
  addEdge(famA2_phys, famA3);
  addEdge(famA2, famA2_legal);
  addEdge(famA2_legal, famA3);
  addEdge(famA2, famA2_both);
  addEdge(famA2_both, famA3);

  const famA4 = addNode('question', 'FA4. Urgency / Safety Screen', {
    question: 'Is there an immediate safety concern for you or the children right now?',
    note: 'CRITICAL - determines whether emergency application is needed',
  });
  addEdge(famA3, famA4);
  const famA4_urgent = resp('Yes - immediate safety concern', 'FLAG URGENT. Say: "Your safety is the priority. I am sending this to the right lawyer for immediate review now." Proceed immediately to the follow-up step.');
  const famA4_routine = resp('No - routine matter');
  addEdge(famA4, famA4_urgent);
  addEdge(famA4_urgent, transferId);
  addEdge(famA4, famA4_routine);
  addEdge(famA4_routine, transferId);

  const famBSupportRouting = addNode('question', 'FB - Support Filing Status', {
    note: 'Is this a new support matter, a modification, or enforcement?',
  });
  const famB_q5 = resp('Child support or spousal support');
  addEdge(famTriage, famB_q5);
  addEdge(famB_q5, famBSupportRouting);

  const famB_new = addNode('action', 'Flag: F-Petition - new', { actionType: 'set_flag', flagName: 'petitionType', flagValue: 'F-Petition (Support) - new' });
  const famB_mod = addNode('action', 'Flag: F-Petition - modification', { actionType: 'set_flag', flagName: 'petitionType', flagValue: 'F-Petition - modification', note: 'Substantial change in circumstances required' });
  const famB_enf = addNode('action', 'Flag: F-Petition - enforcement', { actionType: 'set_flag', flagName: 'petitionType', flagValue: 'F-Petition - violation/enforcement' });

  const famBR_new = resp('New - first time');
  const famBR_mod = resp('Modify existing order');
  const famBR_enf = resp('Enforce - not being paid');
  addEdge(famBSupportRouting, famBR_new);
  addEdge(famBR_new, famB_new);
  addEdge(famBSupportRouting, famBR_mod);
  addEdge(famBR_mod, famB_mod);
  addEdge(famBSupportRouting, famBR_enf);
  addEdge(famBR_enf, famB_enf);

  const famB1 = addNode('question', 'FB1. Type of Support', {
    question: 'Are you looking for child support, spousal maintenance, or both?',
  });
  addEdge(famB_new, famB1);
  addEdge(famB_mod, famB1);
  addEdge(famB_enf, famB1);

  const famB2 = addNode('question', 'FB2. Arrears Period', {
    question: 'If someone owes you support, how long has it been since you last received a payment?',
    note: 'Ask this only when the caller is the one receiving support. Over 1 year = flag significant arrears - possible CSEA referral.',
  });
  const famB1_child = resp('Child support only');
  const famB1_sp = resp('Spousal maintenance only');
  const famB1_both = resp('Both');

  const famB3 = addNode('question', 'FB3. Party Role', {
    question: 'Are you the one receiving support, or being asked to pay?',
    note: 'Respondent = respondent-side representation',
  });
  addEdge(famB1, famB1_child);
  addEdge(famB1_child, famB3);
  addEdge(famB1, famB1_sp);
  addEdge(famB1_sp, famB3);
  addEdge(famB1, famB1_both);
  addEdge(famB1_both, famB3);

  const famB2_lt3 = resp('Less than 3 months');
  const famB2_mid = resp('3 to 12 months');
  const famB2_gt1 = resp('Over 1 year', 'Flag significant arrears.');
  addEdge(famB2, famB2_lt3);
  addEdge(famB2_lt3, transferId);
  addEdge(famB2, famB2_mid);
  addEdge(famB2_mid, transferId);
  addEdge(famB2, famB2_gt1);
  addEdge(famB2_gt1, transferId);

  const famB3_pet = resp('Receiving support (Petitioner)');
  const famB3_res = resp('Being asked to pay (Respondent)', 'Note: respondent-side representation.');
  addEdge(famB3, famB3_pet);
  addEdge(famB3_pet, famB2);
  addEdge(famB3, famB3_res);
  addEdge(famB3_res, transferId);

  const famCSafety = addNode('question', 'FC - Safety Check', {
    question: 'First, I need to ask - are you in a safe place right now?',
    note: 'SAFETY-FIRST PROTOCOL - confirm caller safety before proceeding',
  });
  const famC_q5 = resp('A family member is threatening or hurting me');
  addEdge(famTriage, famC_q5);
  addEdge(famC_q5, famCSafety);

  const famCEmergency = addNode('action', 'EMERGENCY - Advise 911', {
    actionType: 'set_flag',
    flagName: 'urgencyFlag',
    flagValue: 'safety_first',
    petitionType: 'O-Petition - emergency order of protection',
    note: 'EMERGENCY: Advise caller to call 911. Let them know you are flagging this for immediate lawyer review.',
  });
  const famC1 = addNode('question', 'FC1. Nature of Conduct', {
    question: 'Can you tell me a little about what has been happening?',
  });

  const famCS_unsafe = resp("No, or I'm not sure", 'EMERGENCY: Advise 911 immediately. Let them know you are flagging this for immediate lawyer review.');
  const famCS_safe = resp('Yes, I am safe');
  addEdge(famCSafety, famCS_unsafe);
  addEdge(famCS_unsafe, famCEmergency);
  addEdge(famCEmergency, transferId);
  addEdge(famCSafety, famCS_safe);
  addEdge(famCS_safe, famC1);

  const famC2 = addNode('question', 'FC2. Relationship to Respondent', {
    question: 'What is your relationship to the person doing this?',
  });
  const famC1_phys = resp('Physical violence or threats');
  const famC1_har = resp('Harassment, stalking, or intimidation');
  const famC1_emo = resp('Emotional or psychological abuse');
  const famC1_sex = resp('Sexual abuse');
  addEdge(famC1, famC1_phys);
  addEdge(famC1_phys, famC2);
  addEdge(famC1, famC1_har);
  addEdge(famC1_har, famC2);
  addEdge(famC1, famC1_emo);
  addEdge(famC1_emo, famC2);
  addEdge(famC1, famC1_sex);
  addEdge(famC1_sex, famC2);

  const famC2_sp = resp('Spouse or former spouse');
  const famC2_co = resp('Co-parent or parent of my child');
  const famC2_fam = resp('Parent or sibling (family member)');
  const famC2_par = resp('Intimate partner / boyfriend / girlfriend');
  addEdge(famC2, famC2_sp);
  addEdge(famC2_sp, transferId);
  addEdge(famC2, famC2_co);
  addEdge(famC2_co, transferId);
  addEdge(famC2, famC2_fam);
  addEdge(famC2_fam, transferId);
  addEdge(famC2, famC2_par);
  addEdge(famC2_par, transferId);

  const famDRouting = addNode('question', 'FD - ACS / Child Welfare', {
    note: 'Did ACS come to your home, are you concerned about a child elsewhere, or is this a foster care matter?',
  });
  const famD_q5 = resp("A child's safety or welfare concern");
  addEdge(famTriage, famD_q5);
  addEdge(famD_q5, famDRouting);

  const famD1 = addNode('question', 'FD1. Stage of ACS Involvement', {
    question: 'Has ACS come to your home? Is there a court date scheduled?',
    note: 'If court date imminent, flag URGENT',
  });
  const famD2 = addNode('question', 'FD2. Foster Care Sub-Branch', {
    question: 'What kind of foster care matter is this?',
  });

  const famDR_acs = resp('ACS came to my home');
  const famDR_child = resp('Concerned about a child elsewhere');
  const famDR_fos = resp('Foster parent legal matter');
  addEdge(famDRouting, famDR_acs);
  addEdge(famDR_acs, famD1);
  addEdge(famDRouting, famDR_child);
  addEdge(famDR_child, transferId);
  addEdge(famDRouting, famDR_fos);
  addEdge(famDR_fos, famD2);

  const famD1_inv = resp('Investigation stage - no court date yet');
  const famD1_court = resp('Petition filed - court date scheduled', 'FLAG URGENT.');
  addEdge(famD1, famD1_inv);
  addEdge(famD1_inv, transferId);
  addEdge(famD1, famD1_court);
  addEdge(famD1_court, transferId);

  const famD2_pl = resp('Extension of placement / permanency hearing');
  const famD2_ad = resp('Foster-to-adopt');
  const famD2_disp = resp('Dispute with agency');
  addEdge(famD2, famD2_pl);
  addEdge(famD2_pl, transferId);
  addEdge(famD2, famD2_ad);
  addEdge(famD2_ad, transferId);
  addEdge(famD2, famD2_disp);
  addEdge(famD2_disp, transferId);

  const famERouting = addNode('question', 'FE - Paternity', {
    note: 'Are you a mother seeking to establish paternity, a father seeking parental rights, or disputing paternity?',
  });
  const famE_q5 = resp('Paternity - establishing who the father is');
  addEdge(famTriage, famE_q5);
  addEdge(famE_q5, famERouting);

  const famER_mom = resp('Mother seeking to establish');
  const famER_dad = resp('Father seeking parental rights', 'May need to establish paternity before custody.');
  const famER_disp = resp('Disputing paternity', 'DNA challenge / Respondent representation.');
  addEdge(famERouting, famER_mom);
  addEdge(famER_mom, transferId);
  addEdge(famERouting, famER_dad);
  addEdge(famER_dad, transferId);
  addEdge(famERouting, famER_disp);
  addEdge(famER_disp, transferId);

  const famFRouting = addNode('question', 'FF - Adoption / Guardianship', {
    note: 'What type of adoption or guardianship matter? (stepparent, foster-to-adopt, private, kinship, guardianship of minor or adult)',
  });
  const famF_q5 = resp('Adoption or guardianship');
  addEdge(famTriage, famF_q5);
  addEdge(famF_q5, famFRouting);
  const famFR_any = resp('Any type');
  addEdge(famFRouting, famFR_any);
  addEdge(famFR_any, transferId);

  const famGRouting = addNode('question', 'FG - Juvenile Matter', {
    note: 'Is this about an alleged crime / delinquent act, or truancy / child beyond parental control?',
  });
  const famG_q5 = resp('A juvenile matter');
  addEdge(famTriage, famG_q5);
  addEdge(famG_q5, famGRouting);
  const famGR_any = resp('Any type');
  addEdge(famGRouting, famGR_any);
  addEdge(famGR_any, transferId);

  const famDivRouting = addNode('question', 'FH - Divorce / Separation', {
    note: 'Is this an uncontested divorce, contested divorce, or legal separation?',
  });
  const famH_q5 = resp('Divorce or legal separation');
  addEdge(famTriage, famH_q5);
  addEdge(famH_q5, famDivRouting);

  const famDiv1 = addNode('question', 'FH1. Divorce Issues Involved', {
    question: 'What are the main issues in the divorce or separation right now?',
  });
  const famDivR_uncon = resp('Uncontested - we agree on everything');
  const famDivR_con = resp('Contested - we disagree on key issues');
  const famDivR_sep = resp('Legal separation only');
  addEdge(famDivRouting, famDivR_uncon);
  addEdge(famDivR_uncon, famDiv1);
  addEdge(famDivRouting, famDivR_con);
  addEdge(famDivR_con, famDiv1);
  addEdge(famDivRouting, famDivR_sep);
  addEdge(famDivR_sep, famDiv1);

  const famDiv2 = addNode('question', 'FH2. Filing Status / Court Dates', {
    question: 'Has anything already been filed, and is there any court date or deadline coming up?',
    note: 'If there is already a case or a court date, capture that clearly for the lawyer review.',
  });
  const famDiv1_prop = resp('Property division and assets');
  const famDiv1_sup = resp('Spousal support / alimony');
  const famDiv1_child = resp('Child custody and support');
  const famDiv1_all = resp('All of the above');
  addEdge(famDiv1, famDiv1_prop);
  addEdge(famDiv1_prop, famDiv2);
  addEdge(famDiv1, famDiv1_sup);
  addEdge(famDiv1_sup, famDiv2);
  addEdge(famDiv1, famDiv1_child);
  addEdge(famDiv1_child, famDiv2);
  addEdge(famDiv1, famDiv1_all);
  addEdge(famDiv1_all, famDiv2);

  const famDiv3 = addNode('question', 'FH3. Children Involved', {
    question: 'Are there minor children involved in this matter?',
  });
  const famDiv2_notFiled = resp('Nothing filed yet');
  const famDiv2_filed = resp('Filed already - no court date yet');
  const famDiv2_court = resp('Filed already - court date or deadline coming up', 'FLAG URGENT. Make sure the notes clearly mention the upcoming date or deadline.');
  addEdge(famDiv2, famDiv2_notFiled);
  addEdge(famDiv2_notFiled, famDiv3);
  addEdge(famDiv2, famDiv2_filed);
  addEdge(famDiv2_filed, famDiv3);
  addEdge(famDiv2, famDiv2_court);
  addEdge(famDiv2_court, famDiv3);

  const famDiv4 = addNode('question', 'FH4. Other Side Representation', {
    question: 'Does your spouse or partner already have a lawyer?',
  });
  const famDiv3_yes = resp('Yes - minor children are involved');
  const famDiv3_no = resp('No - no minor children involved');
  addEdge(famDiv3, famDiv3_yes);
  addEdge(famDiv3_yes, famDiv4);
  addEdge(famDiv3, famDiv3_no);
  addEdge(famDiv3_no, famDiv4);

  const famDiv5 = addNode('question', 'FH5. Immediate Divorce Urgency', {
    question: 'Is there anything urgent right now, like a safety issue, being locked out of finances or the home, or a deadline coming up?',
  });
  const famDiv4_yes = resp('Yes - the other side already has a lawyer');
  const famDiv4_no = resp('No - the other side does not have a lawyer');
  const famDiv4_unsure = resp('I am not sure if they have a lawyer');
  addEdge(famDiv4, famDiv4_yes);
  addEdge(famDiv4_yes, famDiv5);
  addEdge(famDiv4, famDiv4_no);
  addEdge(famDiv4_no, famDiv5);
  addEdge(famDiv4, famDiv4_unsure);
  addEdge(famDiv4_unsure, famDiv5);

  const famDivUrgent = addNode('action', 'Flag: Divorce - Urgent', {
    actionType: 'set_flag',
    flagName: 'urgencyFlag',
    flagValue: 'divorce_urgent',
    note: 'Caller reported an urgent divorce issue like safety, access to finances, or an imminent deadline.',
  });
  const famDiv5_urgent = resp('Yes - there is an urgent divorce issue', 'FLAG URGENT. Capture the urgency details before handoff.');
  const famDiv5_routine = resp('No - no immediate urgency');
  addEdge(famDiv5, famDiv5_urgent);
  addEdge(famDiv5_urgent, famDivUrgent);
  addEdge(famDivUrgent, transferId);
  addEdge(famDiv5, famDiv5_routine);
  addEdge(famDiv5_routine, transferId);

  const famOther_q5 = resp('Other family law matter');
  addEdge(famTriage, famOther_q5);
  addEdge(famOther_q5, transferId);

  addEdge(q5, famA_q5);
  addEdge(q5, famB_q5);
  addEdge(q5, famC_q5);
  addEdge(q5, famD_q5);
  addEdge(q5, famE_q5);
  addEdge(q5, famF_q5);
  addEdge(q5, famG_q5);
  addEdge(q5, famH_q5);
  addEdge(q5, famOther_q5);

  return {
    name: 'Family Court Intake',
    description: 'Family-law-first intake template built on the same main intake structure as the general flow. Covers custody, support, family offense, child welfare, paternity, adoption, guardianship, juvenile matters, divorce, and includes an outside-family fallback that directs callers to the main line.',
    isTemplate: true,
    nodes,
    edges,
  };
}
