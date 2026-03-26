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

  return `You are a warm, professional, and empathetic AI paralegal receptionist for a law firm.
Today is ${today}.

YOUR PRIMARY ROLE:
You are a filter and assistant — NOT a replacement for real attorneys. You help route callers to the right person and handle scheduling.

CALL FLOW — FOLLOW THIS EXACTLY:

STEP 1: Greet the caller warmly.
Say: "Thank you for calling [Law Firm]. My name is Alex, I'm the AI paralegal assistant. How can I help you today?"

STEP 2: Ask for their name and phone number.
Say: "May I have your name and a callback number please?"

STEP 3: Once you have their name and phone, call the checkClient tool to look them up.

STEP 4: BASED ON THE RESULT:

IF CURRENT CLIENT:
- Say: "Welcome back, [name]! Let me connect you with your attorney right away."
- Call the transferCall tool to transfer them to their assigned lawyer's number.
- If no assigned lawyer, transfer to the main office number.

IF PROSPECTIVE CLIENT (not in our system):
- Say: "Thank you, [name]. I'd love to help you. Could you tell me a little about what's going on?"
- Listen empathetically. Let them talk. Do NOT rush them.
- Then determine which path:

  PATH A — They know they want a consultation:
  - If they mention wanting to "schedule", "meet", "consult", or "appointment":
  - Call identifyLawyer with their description to find the right attorney.
  - Ask what day and time works for them.
  - Call scheduleConsultation to book it on Google Calendar.
  - Confirm the appointment details.

  PATH B — They just want to talk / vent / don't know what they need:
  - Listen patiently and empathetically. Take mental notes.
  - When the conversation reaches a natural pause or they're done:
  - Say: "Thank you for sharing that with me. Let me put together a summary and have the right attorney review your situation. They'll reach out to you."
  - Call generateSummary with the caller info and your notes.
  - The attorney will receive an email with the summary and a link to see their availability.

WHEN TO TRANSFER TO A REAL PERSON:
- The caller explicitly asks for a human, real person, manager, or supervisor
- The situation sounds like an emergency (threats, immediate danger)
- You cannot determine the legal area or appropriate response
- A current client's assigned lawyer is available
- The caller is upset and not responding to your assistance

IMPORTANT RULES:
- NEVER give legal advice. You are a paralegal, not an attorney.
- Be empathetic. People calling a law firm are often stressed or scared.
- Keep responses concise but warm.
- If unsure, err on the side of transferring to a human.

AVAILABLE LAWYERS:
${lawyerList}`;
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
        name: 'transferCall',
        description: 'Transfer the call to a real person (lawyer or office)',
        parameters: {
          type: 'object',
          properties: {
            phoneNumber: { type: 'string', description: 'Phone number to transfer to' },
            reason: { type: 'string', description: 'Reason for transfer' },
          },
          required: ['phoneNumber'],
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
            issue: { type: 'string', description: 'Summary of the legal issue discussed' },
            notes: { type: 'string', description: 'Detailed notes from the conversation' },
          },
          required: ['callerName', 'callerPhone', 'issue'],
        },
      },
    },
  ];
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
    return {
      isCurrentClient: true,
      clientId: client.id,
      clientName: client.name,
      assignedLawyerName: client.assignedLawyer?.name || null,
      assignedLawyerPhone: client.assignedLawyer?.phone || process.env.TRANSFER_PHONE_NUMBER || null,
    };
  }

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

  return {
    type: 'transfer',
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
  const issue = typeof args.issue === 'string' ? args.issue : '';
  const notes = typeof args.notes === 'string' ? args.notes : '';

  // Identify the right lawyer
  const legalArea = identifyLegalArea(issue);
  const lawyer = await findBestLawyer(legalArea);

  // Create or find client
  let client = await prisma.client.findUnique({ where: { phone: callerPhone } });
  if (!client && callerPhone) {
    client = await prisma.client.create({
      data: { name: callerName, phone: callerPhone, isCurrentClient: false },
    });
  }

  // Save call session
  const callSession = await prisma.callSession.create({
    data: {
      callId: `summary-${Date.now()}`,
      callerPhone,
      clientId: client?.id,
      clientType: 'prospective',
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
    // Verify secret
    const secret = req.headers.get('x-vapi-secret');
    if (!verifyVapiSecret(secret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

    // Log for debugging
    console.log('VAPI webhook received:', JSON.stringify({
      messageType,
      bodyKeys: Object.keys(body),
      messageKeys: body?.message ? Object.keys(body.message) : [],
      bodyPreview: rawBody.slice(0, 500),
    }));

    // Handle assistant-request: return assistant config
    if (messageType === 'assistant-request') {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
      const serverUrl = `${appUrl}/api/webhooks/vapi`;
      const transferPhone = process.env.TRANSFER_PHONE_NUMBER || null;

      const systemPrompt = await buildSystemPrompt();
      const assistant: any = {
        name: 'AI Paralegal Receptionist',
        firstMessage: 'Thank you for calling our law firm. My name is Alex, the AI paralegal assistant. How can I help you today?',
        model: {
          provider: 'openai',
          model: 'gpt-5.2',
          temperature: 0.4,
          messages: [{ role: 'system', content: systemPrompt }],
          tools: getToolDefinitions(),
        },
        voice: {
          provider: '11labs',
          voiceId: 'NDjuUGBKZhdOwAYMSat7',
          stability: 0.45,
          similarityBoost: 0.75,
        },
        transcriber: {
          provider: 'deepgram',
          model: 'nova-2',
          language: 'en',
        },
        server: { url: serverUrl },
        startSpeakingPlan: { waitSeconds: 0.4 },
        stopSpeakingPlan: { numWords: 0, voiceSeconds: 0.2, backoffSeconds: 1 },
        silenceTimeoutSeconds: 60,
        voicemailDetection: { provider: 'vapi' },
        voicemailMessage: "Hi, you've reached our law firm. We missed your call but we'll get back to you as soon as possible. Please leave a message or call back during business hours.",
        endCallPhrases: ['goodbye', 'bye', 'end call', 'hang up'],
      };

      if (transferPhone) {
        assistant.forwardingPhoneNumber = transferPhone;
      }

      console.log('VAPI returning assistant config:', JSON.stringify({ name: assistant.name, model: assistant.model.model, voice: assistant.voice.voiceId, serverUrl: assistant.server.url }));
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

    // Handle status-update (call ended)
    if (messageType === 'status-update') {
      const status = body?.message?.status;
      const callId = body?.message?.call?.id;

      if (status === 'ended' && callId) {
        await prisma.callSession.updateMany({
          where: { callId },
          data: { status: 'completed', endedAt: new Date() },
        });
      }

      return NextResponse.json({ received: true });
    }

    // Handle end-of-call-report
    if (messageType === 'end-of-call-report') {
      const callId = body?.message?.call?.id;
      const summary = body?.message?.summary;
      const transcript = body?.message?.transcript;

      if (callId) {
        const transcriptText = Array.isArray(transcript)
          ? transcript.map((t: any) => `${t.role}: ${t.content}`).join('\n')
          : typeof transcript === 'string'
          ? transcript
          : '';

        await prisma.callSession.updateMany({
          where: { callId },
          data: {
            summary: summary || null,
            notes: transcriptText || null,
            status: 'completed',
            endedAt: new Date(),
          },
        });
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
