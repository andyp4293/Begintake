import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Resend - use vi.hoisted to ensure mock is available before module load
const mockSend = vi.hoisted(() => vi.fn());

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mockSend };
  },
}));

import { sendCallSummaryEmail } from './email';

describe('sendCallSummaryEmail', () => {
  beforeEach(() => {
    mockSend.mockReset();
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
    mockSend.mockResolvedValue({ id: 'email-123' });
    const result = await sendCallSummaryEmail(baseParams);
    expect(result.success).toBe(true);
  });

  it('calls resend with correct recipient', async () => {
    mockSend.mockResolvedValue({ id: 'email-123' });
    await sendCallSummaryEmail(baseParams);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.to).toBe('lawyer@test.com');
  });

  it('includes caller name in subject', async () => {
    mockSend.mockResolvedValue({ id: 'email-123' });
    await sendCallSummaryEmail(baseParams);
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.subject).toContain('Jane Smith');
  });

  it('includes legal area in subject', async () => {
    mockSend.mockResolvedValue({ id: 'email-123' });
    await sendCallSummaryEmail(baseParams);
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.subject).toContain('family');
  });

  it('includes summary in email body', async () => {
    mockSend.mockResolvedValue({ id: 'email-123' });
    await sendCallSummaryEmail(baseParams);
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.html).toContain('divorce proceedings');
  });

  it('includes notes in email body', async () => {
    mockSend.mockResolvedValue({ id: 'email-123' });
    await sendCallSummaryEmail(baseParams);
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.html).toContain('two children');
  });

  it('includes caller phone in email body', async () => {
    mockSend.mockResolvedValue({ id: 'email-123' });
    await sendCallSummaryEmail(baseParams);
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.html).toContain('+15551234567');
  });

  it('includes availability link when provided', async () => {
    mockSend.mockResolvedValue({ id: 'email-123' });
    await sendCallSummaryEmail({
      ...baseParams,
      availabilityLink: 'https://app.test/availability',
    });
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.html).toContain('https://app.test/availability');
  });

  it('returns error on failure', async () => {
    mockSend.mockRejectedValue(new Error('API error'));
    const result = await sendCallSummaryEmail(baseParams);
    expect(result.success).toBe(false);
    expect(result.error).toContain('API error');
  });
});
