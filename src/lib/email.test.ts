import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Resend - use vi.hoisted to ensure mock is available before module load
const mockSend = vi.hoisted(() => vi.fn());

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mockSend };
  },
}));

import { sendCallSummaryEmail } from './email';

describe('sendCallSummaryEmail', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockSend.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.VAPI_PRIVATE_KEY;
  });

  const baseParams = {
    lawyerEmail: 'lawyer@test.com',
    lawyerName: 'John Doe',
    callerName: 'Jane Smith',
    callerPhone: '+15551234567',
    summary: 'Client needs help with divorce proceedings',
    notes: 'Has two children, married for 10 years',
    legalArea: 'family',
  };

  it('sends email successfully', async () => {
    mockSend.mockResolvedValue({ data: { id: 'email-123' }, error: null, headers: null });
    const result = await sendCallSummaryEmail(baseParams);
    expect(result.success).toBe(true);
    expect(result.providerMessageId).toBe('email-123');
  });

  it('calls resend with correct recipient', async () => {
    mockSend.mockResolvedValue({ data: { id: 'email-123' }, error: null, headers: null });
    await sendCallSummaryEmail(baseParams);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.to).toBe('lawyer@test.com');
  });

  it('includes caller name in subject', async () => {
    mockSend.mockResolvedValue({ data: { id: 'email-123' }, error: null, headers: null });
    await sendCallSummaryEmail(baseParams);
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.subject).toContain('Jane Smith');
  });

  it('includes legal area in subject', async () => {
    mockSend.mockResolvedValue({ data: { id: 'email-123' }, error: null, headers: null });
    await sendCallSummaryEmail(baseParams);
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.subject).toContain('family');
  });

  it('includes summary in email body', async () => {
    mockSend.mockResolvedValue({ data: { id: 'email-123' }, error: null, headers: null });
    await sendCallSummaryEmail(baseParams);
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.html).toContain('divorce proceedings');
  });

  it('includes notes in email body', async () => {
    mockSend.mockResolvedValue({ data: { id: 'email-123' }, error: null, headers: null });
    await sendCallSummaryEmail(baseParams);
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.html).toContain('two children');
  });

  it('includes caller phone in email body', async () => {
    mockSend.mockResolvedValue({ data: { id: 'email-123' }, error: null, headers: null });
    await sendCallSummaryEmail(baseParams);
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.html).toContain('+15551234567');
  });

  it('does not render the availability button in the summary email', async () => {
    mockSend.mockResolvedValue({ data: { id: 'email-123' }, error: null, headers: null });
    await sendCallSummaryEmail(baseParams);
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.html).not.toContain('View Your Availability & Respond');
  });

  it('sanitizes escaped newlines in the configured sender email', async () => {
    process.env.RESEND_FROM_EMAIL = 'intake@clientific.app\\n';
    mockSend.mockResolvedValue({ data: { id: 'email-123' }, error: null, headers: null });

    await sendCallSummaryEmail(baseParams);

    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.from).toBe('Begintake <intake@clientific.app>');
  });

  it('renders intake notes and transcript as separate sections', async () => {
    mockSend.mockResolvedValue({ data: { id: 'email-123' }, error: null, headers: null });
    await sendCallSummaryEmail({
      ...baseParams,
      notes: 'Condensed intake notes',
      transcript: 'assistant: How can I help?\nuser: I was in a car accident.',
    });
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.html).toContain('Intake Notes');
    expect(callArgs.html).toContain('Condensed intake notes');
    expect(callArgs.html).toContain('Call Transcript');
    expect(callArgs.html).toContain('AI');
    expect(callArgs.html).toContain('Caller');
    expect(callArgs.html).toContain('margin: 0 0 14px');
    expect(callArgs.html).toContain('I was in a car accident.');
  });

  it('treats custom assistant speaker names as AI in the transcript', async () => {
    mockSend.mockResolvedValue({ data: { id: 'email-123' }, error: null, headers: null });
    await sendCallSummaryEmail({
      ...baseParams,
      transcript: 'Bobby: Thanks for calling.\nCaller: I need help with my divorce.',
    });
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.html).toContain('AI');
    expect(callArgs.html).toContain('Caller');
    expect(callArgs.html).not.toContain('Bobby:');
  });

  it('attaches the call recording when a recording url is provided', async () => {
    mockFetch.mockResolvedValueOnce(new Response('audio-bytes', {
      status: 200,
      headers: { 'content-type': 'audio/mpeg' },
    }));
    mockSend.mockResolvedValue({ data: { id: 'email-123' }, error: null, headers: null });

    await sendCallSummaryEmail({
      ...baseParams,
      recordingUrl: 'https://api.vapi.ai/recordings/test-call.mp3',
    });

    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filename: 'test-call.mp3' }),
      ])
    );
  });

  it('keeps the audio attached while removing the raw recording link from the PDF', async () => {
    mockFetch.mockResolvedValueOnce(new Response('audio-bytes', {
      status: 200,
      headers: { 'content-type': 'audio/mpeg' },
    }));
    mockSend.mockResolvedValue({ data: { id: 'email-123' }, error: null, headers: null });

    await sendCallSummaryEmail({
      ...baseParams,
      transcript: 'Bobby: Thanks for calling.\nCaller: I need help with my divorce.',
      recordingUrl: 'https://api.vapi.ai/recordings/test-call.mp3',
    });

    const callArgs = mockSend.mock.calls[0][0];
    const pdfAttachment = callArgs.attachments.find((attachment: { filename: string }) => attachment.filename.endsWith('.pdf'));
    expect(pdfAttachment).toBeDefined();
    const pdfText = Buffer.from(pdfAttachment.content).toString('latin1');
    expect(pdfText).toContain('The call recording is attached separately to the email.');
    expect(pdfText).not.toContain('https://api.vapi.ai/recordings/test-call.mp3');
    expect(callArgs.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filename: 'test-call.mp3' }),
      ])
    );
  });

  it('looks up the Vapi call artifact when the recording url is not provided directly', async () => {
    process.env.VAPI_PRIVATE_KEY = 'vapi-test-key';
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        artifact: {
          recordingUrl: 'https://storage.vapi.ai/calls/recovered-recording.wav',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response('audio-bytes', {
        status: 200,
        headers: { 'content-type': 'audio/wav' },
      }));
    mockSend.mockResolvedValue({ data: { id: 'email-123' }, error: null, headers: null });

    await sendCallSummaryEmail({
      ...baseParams,
      callId: 'call-123',
    });

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'https://api.vapi.ai/call/call-123',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer vapi-test-key',
        }),
      }),
    );

    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filename: 'recovered-recording.wav' }),
      ])
    );
  });

  it('treats a direct resend id response as success for compatibility', async () => {
    mockSend.mockResolvedValue({ id: 'email-legacy-123' });
    const result = await sendCallSummaryEmail(baseParams);
    expect(result.success).toBe(true);
    expect(result.providerMessageId).toBe('email-legacy-123');
  });

  it('returns error when resend resolves with an error payload', async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: {
        message: 'Recipient domain rejected',
        statusCode: 422,
        name: 'validation_error',
      },
      headers: null,
    });

    const result = await sendCallSummaryEmail(baseParams);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Recipient domain rejected');
  });

  it('returns error when resend resolves without a message id', async () => {
    mockSend.mockResolvedValue({ data: {}, error: null, headers: null });
    const result = await sendCallSummaryEmail(baseParams);
    expect(result.success).toBe(false);
    expect(result.error).toContain('message id');
  });

  it('returns error on failure', async () => {
    mockSend.mockRejectedValue(new Error('API error'));
    const result = await sendCallSummaryEmail(baseParams);
    expect(result.success).toBe(false);
    expect(result.error).toContain('API error');
  });
});
