import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockList = vi.fn();
const mockTollFreeList = vi.fn();
const mockCreate = vi.fn();
const mockRemove = vi.fn();

vi.mock('twilio', () => ({
  default: vi.fn(() => ({
    availablePhoneNumbers: vi.fn(() => ({
      local: { list: mockList },
      tollFree: { list: mockTollFreeList },
    })),
    incomingPhoneNumbers: Object.assign(
      vi.fn(() => ({ remove: mockRemove })),
      { create: mockCreate }
    ),
  })),
}));

import { provisionPhoneNumber, releasePhoneNumber } from './phone-provisioning';

describe('provisionPhoneNumber', () => {
  beforeEach(() => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC_test');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'test_token');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.test');
    mockList.mockReset();
    mockTollFreeList.mockReset();
    mockCreate.mockReset();
  });

  it('provisions a local number successfully', async () => {
    mockList.mockResolvedValue([{ phoneNumber: '+15559998888' }]);
    mockCreate.mockResolvedValue({ phoneNumber: '+15559998888', sid: 'PN_test' });

    const result = await provisionPhoneNumber();
    expect(result.success).toBe(true);
    expect(result.phoneNumber).toBe('+15559998888');
    expect(result.phoneSid).toBe('PN_test');
  });

  it('falls back to toll-free when no local available', async () => {
    mockList.mockResolvedValue([]);
    mockTollFreeList.mockResolvedValue([{ phoneNumber: '+18005551234' }]);
    mockCreate.mockResolvedValue({ phoneNumber: '+18005551234', sid: 'PN_tf' });

    const result = await provisionPhoneNumber();
    expect(result.success).toBe(true);
    expect(result.phoneNumber).toBe('+18005551234');
  });

  it('returns error when no numbers available at all', async () => {
    mockList.mockResolvedValue([]);
    mockTollFreeList.mockResolvedValue([]);

    const result = await provisionPhoneNumber();
    expect(result.success).toBe(false);
    expect(result.error).toContain('No phone numbers available');
  });

  it('returns error when Twilio not configured', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', '');
    const result = await provisionPhoneNumber();
    expect(result.success).toBe(false);
    expect(result.error).toContain('Twilio not configured');
  });

  it('passes area code when provided', async () => {
    mockList.mockResolvedValue([{ phoneNumber: '+12125551234' }]);
    mockCreate.mockResolvedValue({ phoneNumber: '+12125551234', sid: 'PN_ac' });

    await provisionPhoneNumber('212');
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ areaCode: 212 })
    );
  });

  it('sets voice webhook URL on provisioned number', async () => {
    mockList.mockResolvedValue([{ phoneNumber: '+15559998888' }]);
    mockCreate.mockResolvedValue({ phoneNumber: '+15559998888', sid: 'PN_wh' });

    await provisionPhoneNumber();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceUrl: 'https://app.test/api/webhooks/vapi',
        voiceMethod: 'POST',
      })
    );
  });

  it('handles Twilio API error gracefully', async () => {
    mockList.mockRejectedValue(new Error('Twilio API error'));
    const result = await provisionPhoneNumber();
    expect(result.success).toBe(false);
    expect(result.error).toContain('Twilio API error');
  });
});

describe('releasePhoneNumber', () => {
  beforeEach(() => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC_test');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'test_token');
    mockRemove.mockReset();
  });

  it('releases number successfully', async () => {
    mockRemove.mockResolvedValue(undefined);
    const result = await releasePhoneNumber('PN_test');
    expect(result.success).toBe(true);
  });

  it('returns error when Twilio not configured', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', '');
    const result = await releasePhoneNumber('PN_test');
    expect(result.success).toBe(false);
  });

  it('handles remove error gracefully', async () => {
    mockRemove.mockRejectedValue(new Error('Number not found'));
    const result = await releasePhoneNumber('PN_test');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Number not found');
  });
});
