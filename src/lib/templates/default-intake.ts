/**
 * Default Reception Intake Template
 *
 * A simpler, highly visual all-practice-areas flow that mirrors the app's
 * default receptionist behavior:
 * - collect contact info
 * - identify current vs new callers
 * - let new callers describe the issue
 * - route across all 13 practice areas at a high level
 * - either schedule or send the matter to the right lawyer or team member for follow-up
 */

let nc = 0;
function nodeId() { return `di-node-${++nc}`; }
let ec = 0;
function edgeId() { return `di-edge-${++ec}`; }

export function createDefaultIntakeTemplate() {
  nc = 0;
  ec = 0;

  const nodes: any[] = [];
  const edges: any[] = [];

  function addNode(type: string, label: string, config: any) {
    const id = nodeId();
    nodes.push({ id, type, label, config, positionX: 0, positionY: nodes.length * 120, sortOrder: nodes.length });
    return id;
  }

  function addEdge(sourceNodeId: string, targetNodeId: string) {
    edges.push({ id: edgeId(), sourceNodeId, targetNodeId, label: null, condition: null, sortOrder: edges.length });
  }

  function response(label: string, instruction = '') {
    return addNode('response', label, { response: label, instruction });
  }

  function setPracticeArea(label: string, practiceArea: string) {
    return addNode('action', label, {
      actionType: 'set_flag',
      flagName: 'practice_area',
      flagValue: practiceArea,
    });
  }

  const transferCurrentClient = addNode('transfer', 'Current Client Team Transfer', {
    transferTarget: 'paralegal',
    handoffMode: 'live_transfer',
    callbackMessage: "Welcome back. I've sent this to our team, and the right lawyer will reach out to you shortly.",
  });

  const transferUrgent = addNode('transfer', 'Urgent Attorney Review', {
    transferTarget: 'attorney',
    handoffMode: 'summary_only',
    callbackMessage: 'Thank you. I wrote down everything you shared with me today so I can pass this to the right lawyer for your case, and I am marking it as urgent. They will review it and call you back at the best callback number I have for you.',
    includeNotes: true,
    transferData: ['caller_name', 'phone', 'email', 'issue_summary', 'practice_area', 'urgency_flag'],
  });

  const startId = addNode('start', 'Opening Greeting', {
    greeting: 'Thank you for calling {firm}. I am the AI assistant, {name}, and I\'ll ask you a few questions to figure out how we can best help you. You may request to get transferred to a paralegal at any time.',
  });

  const q1 = addNode('question', 'Q1. Caller Name', {
    question: 'Could I start with your first and last name?',
    collectFields: [{ name: 'caller_name', label: 'First and last name', type: 'text', required: true }],
  });
  addEdge(startId, q1);

  const q2 = addNode('question', 'Q2. Best Phone Number', {
    question: "Is the number you're calling from the best number to reach you if we get disconnected?",
  });
  addEdge(q1, q2);

  const q2Yes = response('Yes, this number is fine', "Use the caller's current phone number.");
  const q2No = response('No, use a different number', 'Ask for the best callback number and store it.');
  addEdge(q2, q2Yes);
  addEdge(q2, q2No);

  const q2b = addNode('question', 'Q2b. Callback Number', {
    question: 'What is the best callback number for you?',
    collectFields: [{ name: 'callback_phone', label: 'Best callback number', type: 'text', required: true }],
  });

  const q3 = addNode('question', 'Q3. Email Address', {
    question: 'What email address should the attorney use to follow up with you?',
    collectFields: [{ name: 'email', label: 'Email address', type: 'text', required: true }],
    note: 'When confirming it back, spell only the part before the @ sign letter by letter. Say common domains normally.',
  });
  addEdge(q2Yes, q3);
  addEdge(q2No, q2b);
  addEdge(q2b, q3);

  const checkClient = addNode('action', 'Check Existing Client', {
    actionType: 'call_tool',
    toolName: 'checkClient',
    note: 'Pass the caller name and best phone number to check whether they are already a current client.',
  });
  addEdge(q3, checkClient);

  const q4 = addNode('question', 'Q4. New or Existing Client', {
    question: 'Have you worked with our firm before, or is this your first time reaching out to us?',
    note: 'Use the checkClient result to guide this step. If the tool shows they are a current client, prefer the existing-client path.',
  });
  addEdge(checkClient, q4);

  const q4Existing = response('Existing client');
  const q4New = response('New or prospective client');
  addEdge(q4, q4Existing);
  addEdge(q4, q4New);
  addEdge(q4Existing, transferCurrentClient);

  const q5 = addNode('question', 'Q5. Tell Me What Is Going On', {
    question: 'Sure, tell me a little about what is going on.',
    collectFields: [{ name: 'issue_summary', label: 'Caller issue summary', type: 'text', required: true }],
    note: 'Let the caller explain in their own words. Listen patiently and do not rush them.',
  });
  addEdge(q4New, q5);

  const q6 = addNode('question', 'Q6. Emergency or Immediate Deadline', {
    question: 'Is there a hearing, arrest, lockout, active threat, shutdown, or other serious deadline in the next 72 hours?',
    note: 'If yes, flag it as urgent and send it for immediate attorney review.',
  });
  addEdge(q5, q6);

  const q6Urgent = response('Yes - urgent deadline or emergency', 'Reassure the caller that you are escalating this right away.');
  const q6Routine = response('No - not urgent');
  addEdge(q6, q6Urgent);
  addEdge(q6, q6Routine);

  const urgentFlag = addNode('action', 'Flag: Urgent Matter', {
    actionType: 'set_flag',
    flagName: 'urgency_flag',
    flagValue: 'urgent_review',
    note: 'This matter needs same-day attorney review.',
  });
  addEdge(q6Urgent, urgentFlag);
  addEdge(urgentFlag, transferUrgent);

  const q7 = addNode('question', 'Q7. Broad Legal Category', {
    question: 'Which of these broad categories best fits the caller’s issue?',
    note: 'Do not read a list unless needed. Route based on the caller description. Use the closest fit.',
  });
  addEdge(q6Routine, q7);

  const q7Family = response('Family, status, or criminal-type matter');
  const q7Rights = response('Injury, work, or rights problem');
  const q7Business = response('Business, property, tax, or IP matter');
  const q7Planning = response('Bankruptcy, estate planning, environmental, or something else');
  addEdge(q7, q7Family);
  addEdge(q7, q7Rights);
  addEdge(q7, q7Business);
  addEdge(q7, q7Planning);

  const familyAreas = addNode('question', 'Group A. Family, Immigration, or Criminal', {
    question: 'Which specific area fits best: family law, immigration, or criminal defense?',
  });
  const rightsAreas = addNode('question', 'Group B. Injury, Employment, or Civil Rights', {
    question: 'Which specific area fits best: personal injury, employment, or civil rights?',
  });
  const businessAreas = addNode('question', 'Group C. Business, Property, Tax, or IP', {
    question: 'Which specific area fits best: corporate, real estate, tax, or intellectual property?',
  });
  const planningAreas = addNode('question', 'Group D. Bankruptcy, Estate, Environmental, or Other', {
    question: 'Which specific area fits best: bankruptcy, estate planning, environmental, or another general legal issue?',
  });
  addEdge(q7Family, familyAreas);
  addEdge(q7Rights, rightsAreas);
  addEdge(q7Business, businessAreas);
  addEdge(q7Planning, planningAreas);

  function buildAreaPath(parentQuestionId: string, areaLabel: string, practiceArea: string) {
    const areaResponse = response(areaLabel);
    addEdge(parentQuestionId, areaResponse);

    const practiceAreaFlag = setPracticeArea(`Flag: ${practiceArea}`, practiceArea);
    addEdge(areaResponse, practiceAreaFlag);

    const nextStep = addNode('question', `${practiceArea} - Preferred Next Step`, {
      question: 'Would you like to schedule a consultation now, have the right lawyer review this and call you back, or have our team follow up with you?',
      note: 'Only choose the scheduling path if the caller explicitly asks to schedule.',
    });
    addEdge(practiceAreaFlag, nextStep);

    const scheduleNow = response('Schedule a consultation now');
    const callback = response('Have the right lawyer review this and call me');
    const talkNow = response('Have your team follow up with me');
    addEdge(nextStep, scheduleNow);
    addEdge(nextStep, callback);
    addEdge(nextStep, talkNow);

    const whenWorks = addNode('question', `${practiceArea} - Preferred Consultation Time`, {
      question: 'What day and time usually works best for a consultation?',
      collectFields: [
        { name: 'preferred_date', label: 'Preferred consultation date', type: 'text', required: true },
        { name: 'preferred_time', label: 'Preferred consultation time', type: 'text', required: true },
      ],
    });
    addEdge(scheduleNow, whenWorks);

    const identifyLawyer = addNode('action', `${practiceArea} - Identify Attorney`, {
      actionType: 'call_tool',
      toolName: 'identifyLawyer',
      note: 'Pass a concise summary of the caller issue together with the selected practice_area.',
    });
    addEdge(whenWorks, identifyLawyer);

    const bookConsult = addNode('action', `${practiceArea} - Book Consultation`, {
      actionType: 'book_appointment',
      note: 'Use the caller name, phone, preferred date/time, and practice area when scheduling.',
    });
    addEdge(identifyLawyer, bookConsult);

    const scheduleEnd = addNode('end', `${practiceArea} - Consultation Requested`, {
      closingMessage: 'You are all set. We will send this over and follow up with the consultation details. Thank you for calling. Goodbye!',
    });
    addEdge(bookConsult, scheduleEnd);

    const reviewTransfer = addNode('transfer', `${practiceArea} - Attorney Review`, {
      transferTarget: 'attorney',
      handoffMode: 'summary_only',
      callbackMessage: 'Thank you. I wrote down everything you shared with me today so I can pass this to the right lawyer for your case. They will review it and call you back at the best callback number I have for you.',
      includeNotes: true,
      transferData: ['caller_name', 'phone', 'email', 'issue_summary', 'practice_area'],
    });
    addEdge(callback, reviewTransfer);

    const teamTransfer = addNode('transfer', `${practiceArea} - Team Transfer`, {
      transferTarget: 'paralegal',
      handoffMode: 'summary_only',
      callbackMessage: "I've sent this to our team, and the right lawyer will reach out to you shortly.",
    });
    addEdge(talkNow, teamTransfer);
  }

  buildAreaPath(familyAreas, 'Family Law', 'Family Law');
  buildAreaPath(familyAreas, 'Immigration', 'Immigration');
  buildAreaPath(familyAreas, 'Criminal Defense', 'Criminal Defense');

  buildAreaPath(rightsAreas, 'Personal Injury', 'Personal Injury');
  buildAreaPath(rightsAreas, 'Employment', 'Employment');
  buildAreaPath(rightsAreas, 'Civil Rights', 'Civil Rights');

  buildAreaPath(businessAreas, 'Corporate / Business', 'Corporate');
  buildAreaPath(businessAreas, 'Real Estate', 'Real Estate');
  buildAreaPath(businessAreas, 'Tax', 'Tax');
  buildAreaPath(businessAreas, 'Intellectual Property', 'Intellectual Property');

  buildAreaPath(planningAreas, 'Bankruptcy', 'Bankruptcy');
  buildAreaPath(planningAreas, 'Estate Planning', 'Estate Planning');
  buildAreaPath(planningAreas, 'Environmental', 'Environmental');
  buildAreaPath(planningAreas, 'Other / Not Sure Yet', 'General Legal Inquiry');

  return {
    name: 'Default Reception Intake - All Practice Areas',
    description: 'Simple visual intake template for all 13 practice areas. Collects contact details, checks for existing clients, screens for urgent matters, routes to a broad practice area, and then either schedules or sends the matter for lawyer follow-up.',
    isTemplate: true,
    nodes,
    edges,
  };
}
