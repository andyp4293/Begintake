import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizePhoneNumber } from '@/lib/phone';
import { verifyVapiSecret, parseToolArguments } from '@/lib/vapi';
import { identifyLegalArea, findBestLawyer } from '@/lib/lawyer-matcher';
import { createCalendarEvent } from '@/lib/google-calendar';
import { sendCallSummaryEmail } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── System prompt for the AI paralegal ──────────────────────────────────────

async function buildSystemPrompt(): Promise<string> {
  const lawyers = await prisma.lawyer.findMany({
    where: { available: true },
    select: { id: true, name: true, specialties: true, phone: true, email: true },
  });

  const lawyerList = lawyers
    .map((l) => `- ${l.name}: ${l.specialties.join(', ')} (ID: ${l.id})`)
    .join('\n');

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `You are the AI paralegal receptionist for a law firm.
Today is ${today}.

Available attorneys (use the ID field when calling tools, never say the ID aloud):
${lawyerList}

Your job:
- Greet callers warmly and ask for their name.
- Then ask: "Is the number you're calling from the best number to reach you?" If yes, use that number. If no, ask for their preferred callback number.
- Also ask for their email address so the attorney can follow up. When spelling it back, say each letter slowly and individually — e.g. "So that's A... N... D... Y... at gmail dot com, is that right?"
- Once you have their name, phone, and email, call checkClient to look them up.

IF CURRENT CLIENT (checkClient returns isCurrentClient: true):
- Say: "Welcome back! Let me connect you with your attorney right away."
- Call transferCall with the assigned lawyer's phone number.

IF PROSPECTIVE CLIENT (not in our system):
- Say: "Sure, tell me a little about what's going on."
- Listen and let them talk. Do NOT rush them. Do NOT offer to schedule a consultation unless THEY ask.
- Respond naturally — acknowledge what they're saying with varied responses. NEVER say "I'm sorry to hear that" more than once in an entire call. Use natural phrases like "I understand", "That sounds tough", "I hear you", "Okay, got it", "That makes sense" — vary them every time.
- Do NOT push them toward scheduling. Just listen and take notes.
- Then determine which path BASED ON WHAT THE CALLER ASKS FOR:

  PATH A — ONLY if the caller explicitly asks to schedule, meet, consult, or make an appointment:
  - Call identifyLawyer with a summary of their legal issue to find the right attorney.
  - Ask what day and time works for them (format: YYYY-MM-DD for date, "2 PM" for time).
  - When mentioning an attorney, ALWAYS include only the RELEVANT specialty for the caller's issue — e.g. "Andy Pham, our family law attorney" not all their specialties.
  - Once you have attorney, date, time, name, and phone: read back a summary — e.g. "Got it — a consultation with Andy Pham, our family law attorney, on Friday at 2 PM. Shall I go ahead and book that?"
  - Wait for confirmation before calling scheduleConsultation.
  - After booking: relay confirmation and ask "Is there anything else I can help you with?"

  PATH B — DEFAULT for callers who are just explaining their situation:
  - This is the default path. If someone is talking about their problem and has NOT asked to schedule, go with this path.
  - Listen patiently. Take mental notes of their situation.
  - When the conversation reaches a natural pause or they say they're done:
  - STEP 1: Say: "I really appreciate you sharing all of that with me. Let me put together notes from our call and get them to the right attorney."
  - STEP 2: Call generateSummary with the caller's name, phone, email, a summary of their issue, and detailed notes. Say "One moment" before calling the tool.
  - STEP 3: After the tool returns, say: "I've sent everything over to our [specialty] attorney along with your contact info. They'll reach out to you directly to discuss next steps."
  - STEP 4: Then ask: "Is there anything else I can help you with?" and WAIT for their response.
  - STEP 5: If they say no, say the closing phrase and call endCall. Do NOT combine steps — wait for their answer.

WHEN TO TRANSFER TO A REAL PERSON:
- If the caller says "talk to a person", "real person", "human", "paralegal", "manager", "transfer", "connect me", or similar — IMMEDIATELY say "Sure, let me connect you with someone now." The system will automatically forward the call. Do NOT ask any more questions.
- If the situation sounds like an emergency — say "Let me connect you with someone right away." The call will be forwarded automatically.
- If you cannot determine the appropriate response — say "Let me connect you with our team." The call will be forwarded automatically.

ENDING THE CALL:
- When the caller says "no", "nope", "nothing else", "that's all", "I'm good", "goodbye", "bye", or anything similar indicating they're done:
  1. Say: "Thank you for calling! Have a wonderful day. Goodbye!"
  2. Immediately call the endCall tool. Do NOT keep talking after saying goodbye.
- You MUST call endCall after saying goodbye. The call will NOT end unless you call endCall.
- Never combine the goodbye with other information — keep it as its own separate message.

IMPORTANT RULES:
- NEVER give legal advice. You are a paralegal, not an attorney.
- Be empathetic. People calling a law firm are often stressed or scared.
- Keep ALL responses under 2 sentences — this is a phone call, be brief.
- Before calling a tool, say one short natural phrase like "Let me check that." or "One moment." — vary it each time.
- Never read IDs aloud; they are internal references only.
- If you don't know the answer, say "Let me connect you with our team for that."`;
}

// ─── Tool definitions for VAPI assistant config ──────────────────────────────

function getToolDefinitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'checkClient',
        description: 'Check if a caller is an existing client by their phone number',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Caller name' },
            phone: { type: 'string', description: 'Caller phone number' },
          },
          required: ['phone'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'identifyLawyer',
        description: 'Identify the best lawyer for a legal issue based on description',
        parameters: {
          type: 'object',
          properties: {
            legalIssueDescription: { type: 'string', description: 'Description of the legal issue' },
          },
          required: ['legalIssueDescription'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'scheduleConsultation',
        description: 'Schedule a consultation appointment on Google Calendar',
        parameters: {
          type: 'object',
          properties: {
            clientName: { type: 'string', description: 'Client name' },
            clientPhone: { type: 'string', description: 'Client phone number' },
            clientEmail: { type: 'string', description: 'Client email (optional)' },
            lawyerId: { type: 'string', description: 'Lawyer ID to schedule with' },
            preferredDate: { type: 'string', description: 'Preferred date (YYYY-MM-DD)' },
            preferredTime: { type: 'string', description: 'Preferred time (e.g. "2 PM", "14:00")' },
          },
          required: ['clientName', 'clientPhone', 'lawyerId', 'preferredDate', 'preferredTime'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'generateSummary',
        description: 'Generate a call summary and email it to the appropriate lawyer',
        parameters: {
          type: 'object',
          properties: {
            callerName: { type: 'string', description: 'Caller name' },
            callerPhone: { type: 'string', description: 'Caller phone number' },
            callerEmail: { type: 'string', description: 'Caller email address' },
            issue: { type: 'string', description: 'Summary of the legal issue discussed' },
            notes: { type: 'string', description: 'Detailed notes from the conversation' },
          },
          required: ['callerName', 'callerPhone', 'issue'],
        },
      },
    },
  ];
}

// ─── Helper: update most recent call session ─────────────────────────────────

async function updateLatestCallSession(callerPhone: string | null, data: Record<string, any>) {
  if (!callerPhone) return;
  const session = await prisma.callSession.findFirst({
    where: { callerPhone },
    orderBy: { createdAt: 'desc' },
  });
  if (session) {
    await prisma.callSession.update({
      where: { id: session.id },
      data,
    });
  }
}

// ─── Tool handlers ───────────────────────────────────────────────────────────

async function handleCheckClient(args: Record<string, unknown>) {
  const phone = typeof args.phone === 'string' ? normalizePhoneNumber(args.phone) : null;
  const name = typeof args.name === 'string' ? args.name : null;

  if (!phone) {
    return { isCurrentClient: false, message: 'No phone number provided' };
  }

  const client = await prisma.client.findUnique({
    where: { phone },
    include: { assignedLawyer: true },
  });

  if (client?.isCurrentClient) {
    await updateLatestCallSession(phone, { clientType: 'current', clientId: client.id });
    return {
      isCurrentClient: true,
      clientId: client.id,
      clientName: client.name,
      assignedLawyerName: client.assignedLawyer?.name || null,
      assignedLawyerPhone: client.assignedLawyer?.phone || process.env.TRANSFER_PHONE_NUMBER || null,
    };
  }

  await updateLatestCallSession(phone, { clientType: 'prospective' });
  return {
    isCurrentClient: false,
    clientId: client?.id || null,
    message: 'Caller is not a current client',
  };
}

async function handleIdentifyLawyer(args: Record<string, unknown>) {
  const description = typeof args.legalIssueDescription === 'string' ? args.legalIssueDescription : '';
  const legalArea = identifyLegalArea(description);
  const lawyer = await findBestLawyer(legalArea);

  if (!lawyer) {
    return {
      found: false,
      legalArea,
      message: 'No available lawyer found for this area. Please transfer to the main office.',
    };
  }

  return {
    found: true,
    legalArea,
    lawyerId: lawyer.id,
    lawyerName: lawyer.name,
    specialties: lawyer.specialties,
    available: lawyer.available,
    phone: lawyer.phone,
  };
}

function parseTimeString(timeStr: string): { hour: number; minute: number } | null {
  const normalized = timeStr.trim().toUpperCase().replace(/\./g, '');
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2] ?? '0', 10);
  const meridiem = match[3];
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

async function handleScheduleConsultation(args: Record<string, unknown>) {
  const clientName = typeof args.clientName === 'string' ? args.clientName : 'Unknown';
  const clientPhone = typeof args.clientPhone === 'string' ? normalizePhoneNumber(args.clientPhone) : '';
  const clientEmail = typeof args.clientEmail === 'string' ? args.clientEmail : undefined;
  const lawyerId = typeof args.lawyerId === 'string' ? args.lawyerId : '';
  const preferredDate = typeof args.preferredDate === 'string' ? args.preferredDate : '';
  const preferredTime = typeof args.preferredTime === 'string' ? args.preferredTime : '';

  // Find lawyer
  const lawyer = await prisma.lawyer.findUnique({ where: { id: lawyerId } });
  if (!lawyer) {
    return { success: false, message: 'Lawyer not found' };
  }

  // Parse time
  const parsedTime = parseTimeString(preferredTime);
  if (!parsedTime) {
    return { success: false, message: 'Could not understand the time. Please try again with a format like "2 PM" or "14:00".' };
  }

  // Build start/end times
  const startTime = new Date(`${preferredDate}T00:00:00`);
  startTime.setHours(parsedTime.hour, parsedTime.minute, 0, 0);
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1-hour consultation

  // Create or find client
  let client = await prisma.client.findUnique({ where: { phone: clientPhone } });
  if (!client) {
    client = await prisma.client.create({
      data: {
        name: clientName,
        phone: clientPhone,
        email: clientEmail || null,
        isCurrentClient: false,
      },
    });
  }

  // Create Google Calendar event
  let googleEventId: string | null = null;
  try {
    googleEventId = await createCalendarEvent({
      calendarId: lawyer.googleCalendarId || 'primary',
      summary: `Consultation: ${clientName}`,
      description: `Phone consultation with ${clientName} (${clientPhone})`,
      startTime,
      endTime,
      attendeeEmail: clientEmail,
    });
  } catch (error) {
    console.error('Google Calendar error:', error);
  }

  // Create appointment in DB
  const appointment = await prisma.appointment.create({
    data: {
      clientId: client.id,
      lawyerId: lawyer.id,
      startTime,
      endTime,
      status: 'scheduled',
      googleCalendarEventId: googleEventId,
      notes: `Scheduled via AI Paralegal call`,
    },
  });

  const dateStr = startTime.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = startTime.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  // Tag the call session
  await updateLatestCallSession(clientPhone, {
    callOutcome: 'consultation_scheduled',
    legalArea: lawyer.specialties[0] || null,
    lawyerId: lawyer.id,
  });

  return {
    success: true,
    appointmentId: appointment.id,
    lawyerName: lawyer.name,
    date: dateStr,
    time: timeStr,
    message: `Consultation scheduled with ${lawyer.name} on ${dateStr} at ${timeStr}.`,
  };
}

async function handleTransferCall(args: Record<string, unknown>) {
  const reason = typeof args.reason === 'string' ? args.reason : 'Client requested transfer';

  // Try the provided number first, then look up the user's configured transfer number
  let phoneNumber = typeof args.phoneNumber === 'string' ? args.phoneNumber : null;

  if (!phoneNumber) {
    // Get the first user's transfer number (single-tenant demo)
    const user = await prisma.user.findFirst({
      where: { transferPhoneNumber: { not: null } },
      select: { transferPhoneNumber: true },
    });
    phoneNumber = user?.transferPhoneNumber || process.env.TRANSFER_PHONE_NUMBER || null;
  }

  if (!phoneNumber) {
    return {
      message: 'No transfer number is configured. Please ask the caller to call back during business hours.',
    };
  }

  // We don't have callerPhone here, but the status-update will catch it
  return {
    type: 'transfer',
    callOutcome: 'transferred',
    destination: {
      type: 'number',
      number: phoneNumber,
      message: `Transferring the call. Reason: ${reason}`,
    },
  };
}

async function handleGenerateSummary(args: Record<string, unknown>) {
  const callerName = typeof args.callerName === 'string' ? args.callerName : 'Unknown';
  const callerPhone = typeof args.callerPhone === 'string' ? normalizePhoneNumber(args.callerPhone) : '';
  const callerEmail = typeof args.callerEmail === 'string' ? args.callerEmail : '';
  const issue = typeof args.issue === 'string' ? args.issue : '';
  const notes = typeof args.notes === 'string' ? args.notes : '';

  // Identify the right lawyer
  const legalArea = identifyLegalArea(issue);
  const lawyer = await findBestLawyer(legalArea);

  // Create or find client
  let client = await prisma.client.findUnique({ where: { phone: callerPhone } });
  if (!client && callerPhone) {
    client = await prisma.client.create({
      data: { name: callerName, phone: callerPhone, email: callerEmail || null, isCurrentClient: false },
    });
  }

  // Update existing call session or create new one
  const existing = callerPhone ? await prisma.callSession.findFirst({
    where: { callerPhone },
    orderBy: { createdAt: 'desc' },
  }) : null;

  const callSession = existing
    ? await prisma.callSession.update({
        where: { id: existing.id },
        data: {
          clientId: client?.id,
          clientType: 'prospective',
          callOutcome: 'summary_sent',
          legalArea,
          summary: issue,
          notes,
          lawyerId: lawyer?.id,
        },
      })
    : await prisma.callSession.create({
        data: {
          callId: `summary-${Date.now()}`,
          callerPhone,
          clientId: client?.id,
          clientType: 'prospective',
          callOutcome: 'summary_sent',
          legalArea,
          status: 'completed',
          summary: issue,
          notes,
          lawyerId: lawyer?.id,
        },
      });

  // Email the summary to the lawyer
  if (lawyer) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    await sendCallSummaryEmail({
      lawyerEmail: lawyer.email,
      lawyerName: lawyer.name,
      callerName,
      callerPhone,
      callerEmail,
      summary: issue,
      notes,
      legalArea,
      availabilityLink: `${appUrl}?tab=appointments`,
    });
  }

  return {
    success: true,
    callSessionId: callSession.id,
    lawyerName: lawyer?.name || 'No lawyer assigned',
    legalArea,
    message: `Summary has been sent to ${lawyer?.name || 'the team'}. They will review your situation and reach out to you.`,
  };
}

// ─── Main POST handler ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // Verify secret — warn only (matching ClientFlow pattern)
    const secret = req.headers.get('x-vapi-secret');
    if (!verifyVapiSecret(secret)) {
      console.warn('[vapi] secret mismatch — expected:', process.env.VAPI_WEBHOOK_SECRET ? 'SET' : 'NOT SET', 'received:', secret ? 'present' : 'missing');
    }

    const rawBody = await req.text();
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      console.error('VAPI webhook: invalid JSON body');
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const messageType = body?.message?.type;

    // Log EVERYTHING for debugging
    console.log(`[vapi] msgType=${messageType}`);
    console.log(`[vapi] body=${rawBody.slice(0, 400)}`);

    // Handle assistant-request: return assistant config
    if (messageType === 'assistant-request') {
      const t0 = Date.now();
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
      const serverUrl = `${appUrl}/api/webhooks/vapi`;
      // Get transfer number from DB (user-configured) or env fallback
      let transferPhone: string | null = process.env.TRANSFER_PHONE_NUMBER || null;
      try {
        const users = await prisma.$queryRaw<Array<{ transferPhoneNumber: string }>>`
          SELECT "transferPhoneNumber" FROM "User" WHERE "transferPhoneNumber" IS NOT NULL LIMIT 1
        `;
        if (users.length > 0) transferPhone = users[0].transferPhoneNumber;
      } catch { /* field may not exist yet */ }

      let systemPrompt: string;
      try {
        systemPrompt = await buildSystemPrompt();
      } catch (err) {
        console.error('[vapi] buildSystemPrompt failed:', err);
        // Fallback prompt if DB is slow
        systemPrompt = `You are a warm, professional AI paralegal receptionist for a law firm. Listen empathetically, ask for the caller's name and phone number, and help them schedule a consultation or take notes on their situation. Never give legal advice.`;
      }
      console.log(`[vapi] assistant-request prompt built in ${Date.now() - t0}ms`);
      const assistant: any = {
        name: 'AI Paralegal Receptionist',
        firstMessage: 'Thank you for calling our law firm. How can I help you today?',
        model: {
          provider: 'openai',
          model: 'gpt-5.2',
          temperature: 0.4,
          messages: [{ role: 'system', content: systemPrompt }],
          tools: [
            ...getToolDefinitions(),
            { type: 'endCall' },
          ],
        },
        server: {
          url: serverUrl,
        },
        transcriber: {
          provider: 'deepgram',
          model: 'nova-2',
          language: 'en',
        },
        voice: {
          provider: '11labs',
          voiceId: 'NDjuUGBKZhdOwAYMSat7',
          stability: 0.45,
          similarityBoost: 0.75,
        },
        startSpeakingPlan: {
          waitSeconds: 0.4,
        },
        stopSpeakingPlan: {
          numWords: 0,
          voiceSeconds: 0.2,
          backoffSeconds: 1,
        },
        voicemailDetection: {
          provider: 'vapi',
        },
        voicemailMessage: "Hi, you've reached our law firm. We missed your call but we'll get back to you as soon as possible. Please leave a message or call back during business hours.",
        silenceTimeoutSeconds: 60,
      };

      if (transferPhone) {
        assistant.forwardingPhoneNumber = transferPhone;
      }

      // Log full response (minus system prompt to save space)
      const logAssistant = { ...assistant, model: { ...assistant.model, messages: ['[system prompt]'] } };
      console.log(`[vapi] RETURNING in ${Date.now() - t0}ms: ${JSON.stringify(logAssistant)}`);
      return NextResponse.json({ assistant });
    }

    // Handle tool-calls
    if (messageType === 'tool-calls') {
      const toolCalls = body?.message?.toolCallList || body?.message?.toolCalls || [];
      const results = [];

      for (const toolCall of toolCalls) {
        const name = toolCall?.function?.name;
        const args = parseToolArguments(toolCall?.function?.arguments);
        const toolCallId = toolCall?.id;

        let result;
        switch (name) {
          case 'checkClient':
            result = await handleCheckClient(args);
            break;
          case 'identifyLawyer':
            result = await handleIdentifyLawyer(args);
            break;
          case 'scheduleConsultation':
            result = await handleScheduleConsultation(args);
            break;
          case 'transferCall':
            result = await handleTransferCall(args);
            break;
          case 'generateSummary':
            result = await handleGenerateSummary(args);
            break;
          default:
            result = { error: `Unknown tool: ${name}` };
        }

        results.push({ toolCallId, result: JSON.stringify(result) });
      }

      return NextResponse.json({ results });
    }

    // Handle status-update — create or update call session
    if (messageType === 'status-update') {
      const status = body?.message?.status;
      const callId = body?.message?.call?.id;
      const callerPhone = body?.message?.call?.customer?.number;
      const endedReason = body?.message?.endedReason;

      if (callId) {
        await prisma.callSession.upsert({
          where: { callId },
          create: {
            callId,
            callerPhone: callerPhone ? normalizePhoneNumber(callerPhone) : null,
            status: status === 'ended' ? 'completed' : 'active',
            endedAt: status === 'ended' ? new Date() : null,
            notes: endedReason ? `Ended: ${endedReason}` : null,
          },
          update: {
            ...(status === 'ended' && { status: 'completed', endedAt: new Date() }),
            ...(endedReason && { notes: `Ended: ${endedReason}` }),
          },
        });
      }

      return NextResponse.json({ received: true });
    }

    // Handle end-of-call-report — always create/update
    if (messageType === 'end-of-call-report') {
      const callId = body?.message?.call?.id;
      const callerPhone = body?.message?.call?.customer?.number;
      const summary = body?.message?.summary;
      const transcript = body?.message?.transcript;

      if (callId) {
        const transcriptText = Array.isArray(transcript)
          ? transcript.map((t: any) => `${t.role}: ${t.content}`).join('\n')
          : typeof transcript === 'string'
          ? transcript
          : '';

        // Infer labels from summary if not already set by tools
        const inferredLegalArea = summary ? identifyLegalArea(summary) : null;
        const inferredOutcome = summary
          ? summary.toLowerCase().includes('schedul') ? 'consultation_scheduled'
          : summary.toLowerCase().includes('summary') || summary.toLowerCase().includes('notes') ? 'summary_sent'
          : summary.toLowerCase().includes('transfer') ? 'transferred'
          : 'general_inquiry'
          : null;

        await prisma.callSession.upsert({
          where: { callId },
          create: {
            callId,
            callerPhone: callerPhone ? normalizePhoneNumber(callerPhone) : null,
            summary: summary || null,
            notes: transcriptText || null,
            clientType: 'prospective',
            callOutcome: inferredOutcome,
            legalArea: inferredLegalArea !== 'other' ? inferredLegalArea : null,
            status: 'completed',
            endedAt: new Date(),
          },
          update: {
            summary: summary || undefined,
            notes: transcriptText || undefined,
            status: 'completed',
            endedAt: new Date(),
          },
        });

        // Fill in missing labels from summary if tools didn't set them
        if (summary) {
          try {
            await prisma.$executeRaw`
              UPDATE "CallSession"
              SET "callOutcome" = COALESCE("callOutcome", ${inferredOutcome || 'general_inquiry'}),
                  "legalArea" = COALESCE("legalArea", ${inferredLegalArea !== 'other' ? inferredLegalArea : null}),
                  "clientType" = COALESCE("clientType", 'prospective')
              WHERE "callId" = ${callId}
            `;
          } catch { /* fields may not exist yet */ }
        }
      }

      return NextResponse.json({ received: true });
    }

    // Handle call start — create session
    if (messageType === 'call-start' || messageType === 'call_started') {
      const callId = body?.message?.call?.id || body?.call?.id;
      const callerPhone = body?.message?.call?.customer?.number || body?.call?.customer?.number;

      if (callId) {
        await prisma.callSession.upsert({
          where: { callId },
          create: {
            callId,
            callerPhone: callerPhone ? normalizePhoneNumber(callerPhone) : null,
            status: 'active',
          },
          update: {},
        });
      }

      return NextResponse.json({ received: true });
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('VAPI webhook error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
