import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock twilio
const mockCreate = vi.fn();
vi.mock('twilio', () => ({
  default: vi.fn(() => ({
    messages: { create: mockCreate },
  })),
}));

import { sendSMS } from './twilio';

describe('sendSMS', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC_test_sid');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'test_token');
    vi.stubEnv('TWILIO_PHONE_NUMBER', '+15551234567');
  });

  it('sends SMS successfully', async () => {
    mockCreate.mockResolvedValue({ sid: 'SM_test_123' });
    const result = await sendSMS({ to: '+15559990001', message: 'Test' });
    expect(result.success).toBe(true);
    expect(result.sid).toBe('SM_test_123');
  });

  it('normalizes phone number before sending', async () => {
    mockCreate.mockResolvedValue({ sid: 'SM_test' });
    await sendSMS({ to: '(555) 999-0001', message: 'Test' });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+15559990001' })
    );
  });

  it('sends from configured phone number', async () => {
    mockCreate.mockResolvedValue({ sid: 'SM_test' });
    await sendSMS({ to: '+15559990001', message: 'Test' });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ from: '+15551234567' })
    );
  });

  it('returns error for invalid phone number', async () => {
    const result = await sendSMS({ to: '', message: 'Test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid phone number');
  });

  it('returns error when Twilio not configured', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', '');
    vi.stubEnv('TWILIO_AUTH_TOKEN', '');
    const result = await sendSMS({ to: '+15559990001', message: 'Test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Twilio not configured');
  });

  it('returns error when Twilio API fails', async () => {
    mockCreate.mockRejectedValue(new Error('API limit exceeded'));
    const result = await sendSMS({ to: '+15559990001', message: 'Test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('API limit exceeded');
  });

  it('sends the correct message body', async () => {
    mockCreate.mockResolvedValue({ sid: 'SM_test' });
    await sendSMS({ to: '+15559990001', message: 'Hello world' });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Hello world' })
    );
  });
});
