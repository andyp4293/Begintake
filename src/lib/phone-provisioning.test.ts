import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockTwilioList = vi.fn();
const mockTollFreeList = vi.fn();
const mockTwilioCreate = vi.fn();
const mockTwilioUpdate = vi.fn();
const mockTwilioRemove = vi.fn();

vi.mock('twilio', () => ({
  default: vi.fn(() => ({
    availablePhoneNumbers: vi.fn(() => ({
      local: { list: mockTwilioList },
      tollFree: { list: mockTollFreeList },
    })),
    incomingPhoneNumbers: Object.assign(
      vi.fn(() => ({ update: mockTwilioUpdate, remove: mockTwilioRemove })),
      { create: mockTwilioCreate }
    ),
  })),
}));

// Mock global fetch for VAPI API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  purchaseTwilioNumber,
  registerWithVapi,
  configureTwilioWebhooks,
  waitForVapiActivation,
  provisionPhoneNumber,
  releasePhoneNumber,
} from './phone-provisioning';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('purchaseTwilioNumber', () => {
  beforeEach(() => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC_test');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'test_token');
    mockTwilioList.mockReset();
    mockTollFreeList.mockReset();
    mockTwilioCreate.mockReset();
  });

  it('purchases a local number with area code', async () => {
    mockTwilioList.mockResolvedValue([{ phoneNumber: '+12125551234' }]);
    mockTwilioCreate.mockResolvedValue({ sid: 'PN_local', phoneNumber: '+12125551234' });

    const result = await purchaseTwilioNumber('212');
    expect(result.phoneNumber).toBe('+12125551234');
    expect(result.sid).toBe('PN_local');
  });

  it('falls back to toll-free when no local available', async () => {
    mockTwilioList.mockResolvedValue([]);
    mockTollFreeList.mockResolvedValue([{ phoneNumber: '+18005551234' }]);
    mockTwilioCreate.mockResolvedValue({ sid: 'PN_tf', phoneNumber: '+18005551234' });

    const result = await purchaseTwilioNumber('999');
    expect(result.phoneNumber).toBe('+18005551234');
  });

  it('purchases toll-free when no area code specified', async () => {
    mockTollFreeList.mockResolvedValue([{ phoneNumber: '+18885551234' }]);
    mockTwilioCreate.mockResolvedValue({ sid: 'PN_tf2', phoneNumber: '+18885551234' });

    const result = await purchaseTwilioNumber();
    expect(result.phoneNumber).toBe('+18885551234');
  });

  it('throws when no numbers available', async () => {
    mockTollFreeList.mockResolvedValue([]);
    await expect(purchaseTwilioNumber()).rejects.toThrow('No phone numbers available');
  });

  it('throws when Twilio not configured', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', '');
    await expect(purchaseTwilioNumber()).rejects.toThrow('Twilio not configured');
  });
});

describe('registerWithVapi', () => {
  beforeEach(() => {
    vi.stubEnv('VAPI_PRIVATE_KEY', 'test-vapi-key');
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC_test');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'test_token');
    mockFetch.mockReset();
  });

  it('registers number with VAPI API', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'vapi-123', number: '+15551234567', status: 'active' }),
    });

    const result = await registerWithVapi('+15551234567', 'https://app.test/api/webhooks/vapi', 'Test Firm');
    expect(result.id).toBe('vapi-123');
    expect(result.number).toBe('+15551234567');
  });

  it('sends correct payload to VAPI', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'vapi-456', number: '+15551234567' }),
    });

    await registerWithVapi('+15551234567', 'https://app.test/api/webhooks/vapi', 'My Firm');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.vapi.ai/phone-number',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-vapi-key',
        }),
      })
    );

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.provider).toBe('twilio');
    expect(callBody.number).toBe('+15551234567');
    expect(callBody.server.url).toBe('https://app.test/api/webhooks/vapi');
    expect(callBody.name).toContain('My Firm');
  });

  it('throws on VAPI API error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad request',
    });

    await expect(
      registerWithVapi('+15551234567', 'https://app.test', 'Test')
    ).rejects.toThrow('VAPI POST /phone-number failed');
  });

  it('throws when VAPI not configured', async () => {
    vi.stubEnv('VAPI_PRIVATE_KEY', '');
    await expect(
      registerWithVapi('+15551234567', 'https://app.test', 'Test')
    ).rejects.toThrow('VAPI not configured');
  });
});

describe('configureTwilioWebhooks', () => {
  beforeEach(() => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC_test');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'test_token');
    mockTwilioUpdate.mockReset();
  });

  it('sets voice URL to VAPI endpoint', async () => {
    mockTwilioUpdate.mockResolvedValue({});
    await configureTwilioWebhooks('PN_test', 'https://app.test');

    expect(mockTwilioUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceUrl: 'https://api.vapi.ai/twilio/inbound_call',
        voiceMethod: 'POST',
      })
    );
  });

  it('sets status callback to VAPI', async () => {
    mockTwilioUpdate.mockResolvedValue({});
    await configureTwilioWebhooks('PN_test', 'https://app.test');

    expect(mockTwilioUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCallback: 'https://api.vapi.ai/twilio/status',
      })
    );
  });

  it('sets SMS URL to app webhook', async () => {
    mockTwilioUpdate.mockResolvedValue({});
    await configureTwilioWebhooks('PN_test', 'https://app.test');

    expect(mockTwilioUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        smsUrl: 'https://app.test/api/webhooks/twilio-sms',
      })
    );
  });
});

describe('waitForVapiActivation', () => {
  beforeEach(() => {
    vi.stubEnv('VAPI_PRIVATE_KEY', 'test-vapi-key');
    mockFetch.mockReset();
  });

  it('returns activated number immediately', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'vapi-1', number: '+15551234567', status: 'active' }),
    });

    const result = await waitForVapiActivation('vapi-1', 1, 0);
    expect(result?.number).toBe('+15551234567');
  });

  it('returns null number if blocked', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'vapi-1', number: null, status: 'blocked' }),
    });

    const result = await waitForVapiActivation('vapi-1', 1, 0);
    expect(result?.status).toBe('blocked');
  });

  it('polls multiple times', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'v1', number: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'v1', number: '+15551234567' }) });

    const result = await waitForVapiActivation('v1', 2, 0);
    expect(result?.number).toBe('+15551234567');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('provisionPhoneNumber (full flow)', () => {
  beforeEach(() => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC_test');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'test_token');
    vi.stubEnv('VAPI_PRIVATE_KEY', 'test-vapi-key');
    mockTwilioList.mockReset();
    mockTollFreeList.mockReset();
    mockTwilioCreate.mockReset();
    mockTwilioUpdate.mockReset();
    mockTwilioRemove.mockReset();
    mockFetch.mockReset();
  });

  it('completes full provisioning flow', async () => {
    mockTollFreeList.mockResolvedValue([{ phoneNumber: '+18005559999' }]);
    mockTwilioCreate.mockResolvedValue({ sid: 'PN_full', phoneNumber: '+18005559999' });
    mockTwilioUpdate.mockResolvedValue({});

    // VAPI register
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'vapi-full', number: '+18005559999' }),
    });
    // VAPI poll
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'vapi-full', number: '+18005559999', status: 'active' }),
    });

    const result = await provisionPhoneNumber('Test User', 'https://app.test');
    expect(result.success).toBe(true);
    expect(result.phoneNumber).toBe('+18005559999');
    expect(result.vapiPhoneNumberId).toBe('vapi-full');
  });

  it('rolls back on VAPI registration failure', async () => {
    mockTollFreeList.mockResolvedValue([{ phoneNumber: '+18005559999' }]);
    mockTwilioCreate.mockResolvedValue({ sid: 'PN_rb', phoneNumber: '+18005559999' });

    // VAPI register fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal error',
    });

    const result = await provisionPhoneNumber('Test', 'https://app.test');
    expect(result.success).toBe(false);
    expect(mockTwilioRemove).toHaveBeenCalled(); // Twilio rollback
  });

  it('rolls back on webhook config failure', async () => {
    mockTollFreeList.mockResolvedValue([{ phoneNumber: '+18005559999' }]);
    mockTwilioCreate.mockResolvedValue({ sid: 'PN_rb2', phoneNumber: '+18005559999' });

    // VAPI register succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'vapi-rb2', number: '+18005559999' }),
    });

    // Twilio webhook fails
    mockTwilioUpdate.mockRejectedValue(new Error('Webhook config failed'));

    // VAPI delete for rollback
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const result = await provisionPhoneNumber('Test', 'https://app.test');
    expect(result.success).toBe(false);
    expect(mockTwilioRemove).toHaveBeenCalled(); // Twilio rollback
  });
});

describe('releasePhoneNumber', () => {
  beforeEach(() => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC_test');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'test_token');
    vi.stubEnv('VAPI_PRIVATE_KEY', 'test-vapi-key');
    mockFetch.mockReset();
    mockTwilioRemove.mockReset();
  });

  it('deletes VAPI and Twilio numbers', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    mockTwilioRemove.mockResolvedValue(undefined);

    const result = await releasePhoneNumber('vapi-1', 'PN_1');
    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalled();
    expect(mockTwilioRemove).toHaveBeenCalled();
  });

  it('handles null VAPI ID', async () => {
    mockTwilioRemove.mockResolvedValue(undefined);
    const result = await releasePhoneNumber(null, 'PN_1');
    expect(result.success).toBe(true);
  });

  it('handles null Twilio SID', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const result = await releasePhoneNumber('vapi-1', null);
    expect(result.success).toBe(true);
  });

  it('returns error on failure', async () => {
    mockFetch.mockRejectedValue(new Error('Delete failed'));
    const result = await releasePhoneNumber('vapi-1', 'PN_1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Delete failed');
  });
});
