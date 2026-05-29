import { Resend } from 'resend';
import { jsPDF } from 'jspdf';
import { parseTranscriptLine } from '@/lib/transcript-speakers';

const resend = new Resend(process.env.RESEND_API_KEY);

interface SendEmailResult {
  success: boolean;
  error?: string;
  providerMessageId?: string;
}

interface CallSummaryEmailParams {
  callId?: string;
  lawyerEmail: string;
  lawyerName: string;
  backupEmail?: string;
  additionalEmails?: string[];
  assistantName?: string;
  callerName: string;
  callerPhone: string;
  callOriginPhone?: string;
  callerEmail?: string;
  summary: string;
  notes?: string;
  transcript?: string;
  recordingUrl?: string;
  legalArea: string;
  petitionType?: string;
  urgencyFlag?: string;
  matterCategory?: string;
  partyRole?: string;
}

function parseTranscriptEntries(
  transcript?: string,
  assistantName?: string
): Array<{ label: string; content: string; isAi: boolean }> {
  if (!transcript) return [];

  return transcript
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseTranscriptLine(line, assistantName));
}

function renderTranscriptHtml(transcript?: string, assistantName?: string): string {
  const entries = parseTranscriptEntries(transcript, assistantName);
  if (!entries.length) return '';

  return entries
    .map(
      (entry) => `
        <div style="margin: 0 0 14px; padding: 10px 12px; border-radius: 8px; background: ${entry.isAi ? '#eff6ff' : '#f8fafc'};">
          <p style="margin: 0 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${entry.isAi ? '#2563eb' : '#0f172a'};">
            ${entry.label}
          </p>
          <p style="margin: 0; line-height: 1.65; white-space: pre-wrap; color: #18181b;">${entry.content}</p>
        </div>
      `
    )
    .join('');
}

async function fetchRecordingAttachment(recordingUrl?: string): Promise<{
  filename: string;
  content: Buffer;
  content_type?: string;
} | null> {
  if (!recordingUrl) return null;

  try {
    const headers: HeadersInit = {};
    if (recordingUrl.includes('vapi') && process.env.VAPI_PRIVATE_KEY) {
      headers.Authorization = `Bearer ${process.env.VAPI_PRIVATE_KEY}`;
    }

    const response = await fetch(recordingUrl, { headers });
    if (!response.ok) {
      console.error(`[email] Recording download failed (${response.status}) for ${recordingUrl}`);
      return null;
    }

    const contentType = response.headers.get('content-type') || undefined;
    const arrayBuffer = await response.arrayBuffer();
    const content = Buffer.from(arrayBuffer);
    if (!content.length) {
      console.error(`[email] Recording download returned empty body for ${recordingUrl}`);
      return null;
    }

    const url = new URL(recordingUrl);
    const rawName = url.pathname.split('/').pop() || 'call-recording';
    const hasExtension = /\.[a-z0-9]+$/i.test(rawName);
    const extension = contentType?.includes('mpeg')
      ? '.mp3'
      : contentType?.includes('wav')
      ? '.wav'
      : contentType?.includes('mp4')
      ? '.mp4'
      : '';

    return {
      filename: hasExtension ? rawName : `${rawName}${extension || '.bin'}`,
      content,
      content_type: contentType,
    };
  } catch (error) {
    console.error('[email] Recording download failed:', error);
    return null;
  }
}

function extractRecordingUrlFromVapiCallPayload(payload: any): string | undefined {
  const candidates = [
    payload?.artifact?.recording?.mono?.combinedUrl,
    payload?.artifact?.recordingUrl,
    payload?.recordingUrl,
    payload?.artifact?.recording?.stereoUrl,
    payload?.artifact?.stereoRecordingUrl,
    payload?.stereoRecordingUrl,
    payload?.artifact?.recording?.url,
    payload?.artifact?.recording?.mp3Url,
    payload?.artifact?.recording?.wavUrl,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return undefined;
}

async function resolveRecordingUrl(recordingUrl?: string, callId?: string): Promise<string | undefined> {
  const normalizedUrl = recordingUrl?.trim();
  if (normalizedUrl) return normalizedUrl;

  if (!callId || !process.env.VAPI_PRIVATE_KEY) return undefined;

  try {
    const response = await fetch(`https://api.vapi.ai/call/${callId}`, {
      headers: {
        Authorization: `Bearer ${process.env.VAPI_PRIVATE_KEY}`,
      },
    });

    if (!response.ok) {
      console.error(`[email] Failed to fetch Vapi call artifact (${response.status}) for ${callId}`);
      return undefined;
    }

    const payload = await response.json();
    return extractRecordingUrlFromVapiCallPayload(payload);
  } catch (error) {
    console.error(`[email] Failed to resolve recording url for call ${callId}:`, error);
    return undefined;
  }
}

function generateTranscriptPdf(params: CallSummaryEmailParams): Buffer {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const maxWidth = pageWidth - margin * 2;
  let y = 20;

  const addText = (text: string, size: number, style: 'normal' | 'bold' = 'normal', color: [number, number, number] = [0, 0, 0]) => {
    doc.setFontSize(size);
    doc.setFont('helvetica', style);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, maxWidth);
    for (const line of lines) {
      if (y > 275) { doc.addPage(); y = 20; }
      doc.text(line, margin, y);
      y += size * 0.45;
    }
    y += 2;
  };

  const addLine = () => {
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;
  };

  // Header
  addText('ANDERSON BOWMAN PLLC', 14, 'bold');
  addText('Begintake - Call Transcript & Summary', 10, 'normal', [100, 100, 100]);
  y += 4;
  addLine();

  // Client info
  addText('CLIENT INFORMATION', 10, 'bold', [50, 50, 50]);
  y += 2;
  addText(`Name: ${params.callerName}`, 10);
  if (params.callOriginPhone) {
    addText(`Phone Used for Call: ${params.callOriginPhone}`, 10);
  }
  addText(`Best Callback Number: ${params.callerPhone}`, 10);
  if (params.callerEmail) addText(`Email: ${params.callerEmail}`, 10);
  addText(`Legal Area: ${params.legalArea}`, 10);
  addText(`Date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`, 10);
  y += 4;
  addLine();

  // Case flags
  if (params.petitionType || params.urgencyFlag || params.matterCategory || params.partyRole) {
    addText('CASE FLAGS', 10, 'bold', [50, 50, 50]);
    y += 2;
    if (params.petitionType)  addText(`Petition Type:    ${params.petitionType}`, 10);
    if (params.matterCategory) addText(`Matter Category:  ${params.matterCategory}`, 10);
    if (params.partyRole)     addText(`Party Role:       ${params.partyRole}`, 10);
    if (params.urgencyFlag)   addText(`Urgency:          ${params.urgencyFlag}`, 10, 'bold', [200, 0, 0]);
    y += 4;
    addLine();
  }

  // Summary
  addText('CALL SUMMARY', 10, 'bold', [50, 50, 50]);
  y += 2;
  addText(params.summary || 'No summary available.', 10);
  y += 4;
  addLine();

  // Intake notes
  if (params.notes) {
    addText('INTAKE NOTES', 10, 'bold', [50, 50, 50]);
    y += 2;
    addText(params.notes, 9);
    y += 4;
    addLine();
  }

  // Transcript
  if (params.transcript) {
    addText('CALL TRANSCRIPT', 10, 'bold', [50, 50, 50]);
    y += 2;
    const entries = parseTranscriptEntries(params.transcript, params.assistantName);
    for (const entry of entries) {
      addText(entry.label, 8, 'bold', entry.isAi ? [37, 99, 235] : [15, 23, 42]);
      addText(entry.content, 9);
      y += 2;
      if (y > 275) { doc.addPage(); y = 20; }
    }
    if (!entries.length) {
      const lines = params.transcript.split('\n').filter(Boolean);
      for (const line of lines) {
        addText(line, 9);
      }
    }
    y += 2;
    addLine();
  }

  if (params.recordingUrl) {
    addText('CALL RECORDING', 10, 'bold', [50, 50, 50]);
    y += 2;
    addText('The call recording is attached separately to the email.', 9);
  }

  // Footer
  y += 8;
  addText('Generated by Begintake - Privileged & Confidential', 8, 'normal', [150, 150, 150]);

  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}

function parseResendDelivery(result: unknown): SendEmailResult {
  if (!result || typeof result !== 'object') {
    return { success: false, error: 'Resend returned an empty response' };
  }

  const response = result as {
    id?: unknown;
    data?: { id?: unknown } | null;
    error?: { message?: unknown } | null;
  };

  if (typeof response.id === 'string' && response.id.length > 0) {
    return { success: true, providerMessageId: response.id };
  }

  if (response.data && typeof response.data.id === 'string' && response.data.id.length > 0) {
    return { success: true, providerMessageId: response.data.id };
  }

  if (response.error) {
    const message = typeof response.error.message === 'string'
      ? response.error.message
      : 'Resend returned an error response';
    return { success: false, error: message };
  }

  return { success: false, error: 'Resend did not return a message id' };
}

export async function sendCallSummaryEmail(params: CallSummaryEmailParams): Promise<SendEmailResult> {
  const fromEmail = (process.env.RESEND_FROM_EMAIL || 'noreply@example.com')
    .replace(/\\n/g, '')
    .trim();
  const recipients = Array.from(new Map(
    [params.lawyerEmail, params.backupEmail, ...(params.additionalEmails || [])]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean)
      .map((value) => [value.toLowerCase(), value] as const)
  ).values());

  try {
    const resolvedRecordingUrl = await resolveRecordingUrl(params.recordingUrl, params.callId);

    // Generate PDF transcript
    let pdfBuffer: Buffer | null = null;
    try {
      pdfBuffer = generateTranscriptPdf({
        ...params,
        recordingUrl: resolvedRecordingUrl,
      });
    } catch (err) {
      console.error('[email] PDF generation failed, sending without attachment:', err);
    }
    const recordingAttachment = await fetchRecordingAttachment(resolvedRecordingUrl);

    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const attachments = [];
    if (pdfBuffer) {
      attachments.push({
        filename: `${params.callerName.replace(/[^a-zA-Z0-9]/g, '_')}_Transcript_${date.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
        content: pdfBuffer,
      });
    }
    if (recordingAttachment) {
      attachments.push(recordingAttachment);
    }

    const resendResult = await resend.emails.send({
      from: `Begintake <${fromEmail}>`,
      to: recipients,
      subject: `New Prospective Client: ${params.callerName} - ${params.legalArea}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a1a1a;">New Prospective Client Inquiry</h2>

          <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p><strong>Client Name:</strong> ${params.callerName}</p>
            ${params.callOriginPhone ? `<p><strong>Phone Used for Call:</strong> <a href="tel:${params.callOriginPhone}">${params.callOriginPhone}</a></p>` : ''}
            <p><strong>Best Callback Number:</strong> <a href="tel:${params.callerPhone}">${params.callerPhone}</a></p>
            ${params.callerEmail ? `<p><strong>Email:</strong> <a href="mailto:${params.callerEmail}">${params.callerEmail}</a></p>` : ''}
            <p><strong>Legal Area:</strong> ${params.legalArea}</p>
          </div>

          ${(params.petitionType || params.urgencyFlag || params.matterCategory || params.partyRole) ? `
            <div style="background: #fff8f0; border-left: 4px solid #f97316; padding: 14px 16px; border-radius: 0 8px 8px 0; margin: 16px 0;">
              <p style="margin: 0 0 8px; font-weight: bold; font-size: 13px; color: #333;">Case Flags</p>
              ${params.petitionType   ? `<p style="margin: 4px 0; font-size: 13px;"><strong>Petition Type:</strong> ${params.petitionType}</p>` : ''}
              ${params.matterCategory ? `<p style="margin: 4px 0; font-size: 13px;"><strong>Matter Category:</strong> ${params.matterCategory}</p>` : ''}
              ${params.partyRole      ? `<p style="margin: 4px 0; font-size: 13px;"><strong>Party Role:</strong> ${params.partyRole}</p>` : ''}
              ${params.urgencyFlag    ? `<p style="margin: 4px 0; font-size: 13px; color: #dc2626;"><strong>⚠ Urgency:</strong> ${params.urgencyFlag}</p>` : ''}
            </div>
          ` : ''}

          <h3 style="color: #333;">Call Summary</h3>
          <p style="line-height: 1.6;">${params.summary}</p>

          ${params.notes ? `
            <h3 style="color: #333;">Intake Notes</h3>
            <p style="line-height: 1.6; white-space: pre-wrap;">${params.notes}</p>
          ` : ''}

          ${params.transcript ? `
            <h3 style="color: #333;">Call Transcript</h3>
            <div style="margin-top: 8px;">
              ${renderTranscriptHtml(params.transcript, params.assistantName)}
            </div>
          ` : ''}

          ${resolvedRecordingUrl ? `
            <h3 style="color: #333;">Call Recording</h3>
            <p style="line-height: 1.6;">
              ${recordingAttachment
                ? 'The call recording is attached to this email.'
                : `Recording link: <a href="${resolvedRecordingUrl}">${resolvedRecordingUrl}</a>`}
            </p>
          ` : ''}

          ${pdfBuffer ? `
            <p style="color: #666; font-size: 13px; margin-top: 16px; padding: 12px; background: #f0f7ff; border-radius: 6px;">
              📎 <strong>Call summary PDF attached</strong> - includes client info, summary, intake notes, and transcript when available.
            </p>
          ` : ''}

          ${recordingAttachment ? `
            <p style="color: #666; font-size: 13px; margin-top: 16px; padding: 12px; background: #f0fff4; border-radius: 6px;">
              🎧 <strong>Call recording attached</strong>
            </p>
          ` : ''}

          <p style="color: #666; font-size: 12px; margin-top: 32px;">
            This summary was generated by Begintake. Please review and follow up with the prospective client at your earliest convenience.
          </p>
        </div>
      `,
      ...(attachments.length ? { attachments } : {}),
    });

    const delivery = parseResendDelivery(resendResult);
    if (!delivery.success) {
      console.error(
        `[email] Resend did not confirm delivery for ${params.lawyerEmail}: ${delivery.error || 'Unknown response'}`
      );
      return delivery;
    }

    console.log(
      `[email] Sent summary${pdfBuffer ? ' with PDF' : ''} to ${recipients.join(', ')} for caller ${params.callerName} (message ${delivery.providerMessageId})`
    );
    return delivery;
  } catch (error: any) {
    console.error('[email] Failed to send:', error?.message || error);
    return { success: false, error: error?.message || 'Failed to send email' };
  }
}
