import twilio from 'twilio';

// ─── Twilio Client ───────────────────────────────────────────────────────────

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!accountSid || !authToken) throw new Error('Twilio not configured');
  return twilio(accountSid, authToken);
}

// ─── VAPI API Helper ─────────────────────────────────────────────────────────

async function vapiRequest(method: string, path: string, body?: any): Promise<any> {
  const apiKey = process.env.VAPI_PRIVATE_KEY?.trim();
  if (!apiKey) throw new Error('VAPI not configured');

  const res = await fetch(`https://api.vapi.ai${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`VAPI ${method} ${path} failed (${res.status}): ${text}`);
  }

  return res.json();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Purchase Twilio Number ──────────────────────────────────────────────────

interface TwilioProvisionedNumber {
  sid: string;
  phoneNumber: string;
}

export async function purchaseTwilioNumber(areaCode?: string): Promise<TwilioProvisionedNumber> {
  const client = getTwilioClient();
  let candidate: string | undefined;

  // Try local number with area code
  if (areaCode) {
    const local = await client.availablePhoneNumbers('US').local.list({
      areaCode: parseInt(areaCode),
      smsEnabled: true,
      voiceEnabled: true,
      limit: 1,
    });
    candidate = local[0]?.phoneNumber;
  }

  // Fallback to toll-free
  if (!candidate) {
    const tollFree = await client.availablePhoneNumbers('US').tollFree.list({
      smsEnabled: true,
      voiceEnabled: true,
      limit: 1,
    });
    candidate = tollFree[0]?.phoneNumber;
  }

  if (!candidate) {
    throw new Error('No phone numbers available');
  }

  const purchased = await client.incomingPhoneNumbers.create({
    phoneNumber: candidate,
  });

  return {
    sid: purchased.sid,
    phoneNumber: purchased.phoneNumber,
  };
}

// ─── Register Number with VAPI ───────────────────────────────────────────────

interface VapiPhoneNumber {
  id: string;
  number: string;
  status?: string;
}

export async function registerWithVapi(
  twilioNumber: string,
  serverUrl: string,
  name: string
): Promise<VapiPhoneNumber> {
  const result = await vapiRequest('POST', '/phone-number', {
    provider: 'twilio',
    number: twilioNumber,
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID?.trim(),
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN?.trim(),
    smsEnabled: false,
    name: `${name} AI Paralegal`,
    server: { url: serverUrl },
  });

  return {
    id: result.id,
    number: result.number || twilioNumber,
    status: result.status,
  };
}

// ─── Configure Twilio Webhooks ───────────────────────────────────────────────

export async function configureTwilioWebhooks(
  numberSid: string,
  appUrl: string
): Promise<void> {
  const client = getTwilioClient();

  await client.incomingPhoneNumbers(numberSid).update({
    // Voice goes to VAPI
    voiceUrl: 'https://api.vapi.ai/twilio/inbound_call',
    voiceMethod: 'POST',
    statusCallback: 'https://api.vapi.ai/twilio/status',
    statusCallbackMethod: 'POST',
    // SMS goes to our app
    smsUrl: `${appUrl}/api/webhooks/twilio-sms`,
    smsMethod: 'POST',
  });
}

// ─── Wait for VAPI Activation ────────────────────────────────────────────────

export async function waitForVapiActivation(
  phoneNumberId: string,
  attempts = 4,
  delayMs = 1200
): Promise<VapiPhoneNumber | null> {
  let latest: VapiPhoneNumber | null = null;

  for (let i = 0; i < attempts; i++) {
    const details = await vapiRequest('GET', `/phone-number/${phoneNumberId}`);
    latest = {
      id: details.id,
      number: details.number,
      status: details.status,
    };

    if (latest.number || latest.status === 'blocked') {
      return latest;
    }

    if (i < attempts - 1) {
      await sleep(delayMs);
    }
  }

  return latest;
}

// ─── Full Provisioning Flow ──────────────────────────────────────────────────

export interface ProvisionResult {
  success: boolean;
  phoneNumber?: string;
  twilioSid?: string;
  vapiPhoneNumberId?: string;
  error?: string;
}

export async function provisionPhoneNumber(
  userName: string,
  appUrl: string,
  areaCode?: string
): Promise<ProvisionResult> {
  let twilioSid: string | undefined;
  let vapiId: string | undefined;

  try {
    // Step 1: Purchase Twilio number
    const twilio = await purchaseTwilioNumber(areaCode);
    twilioSid = twilio.sid;

    // Step 2: Register with VAPI
    const serverUrl = `${appUrl}/api/webhooks/vapi`;
    const vapiNumber = await registerWithVapi(twilio.phoneNumber, serverUrl, userName);
    vapiId = vapiNumber.id;

    // Step 3: Configure Twilio webhooks to point to VAPI
    await configureTwilioWebhooks(twilio.sid, appUrl);

    // Step 4: Wait for VAPI activation
    const activated = await waitForVapiActivation(vapiNumber.id);

    if (activated?.status === 'blocked') {
      throw new Error('Phone number was blocked by VAPI');
    }

    return {
      success: true,
      phoneNumber: twilio.phoneNumber,
      twilioSid: twilio.sid,
      vapiPhoneNumberId: vapiNumber.id,
    };
  } catch (error: any) {
    // Rollback on failure
    console.error('Phone provisioning failed:', error);

    if (vapiId) {
      try {
        await vapiRequest('DELETE', `/phone-number/${vapiId}`);
      } catch (e) {
        console.error('Failed to rollback VAPI number:', e);
      }
    }

    if (twilioSid) {
      try {
        const client = getTwilioClient();
        await client.incomingPhoneNumbers(twilioSid).remove();
      } catch (e) {
        console.error('Failed to rollback Twilio number:', e);
      }
    }

    return {
      success: false,
      error: error?.message || 'Failed to provision phone number',
    };
  }
}

// ─── Release Number ──────────────────────────────────────────────────────────

export async function releasePhoneNumber(
  vapiPhoneNumberId: string | null,
  twilioSid: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    if (vapiPhoneNumberId) {
      await vapiRequest('DELETE', `/phone-number/${vapiPhoneNumberId}`);
    }

    if (twilioSid) {
      const client = getTwilioClient();
      await client.incomingPhoneNumbers(twilioSid).remove();
    }

    return { success: true };
  } catch (error: any) {
    console.error('Failed to release phone number:', error);
    return { success: false, error: error?.message || 'Failed to release number' };
  }
}
