import twilio from 'twilio';

interface ProvisionResult {
  success: boolean;
  phoneNumber?: string;
  phoneSid?: string;
  error?: string;
}

/**
 * Provision a new Twilio phone number for use with VAPI.
 * Following Twilio's API docs: https://www.twilio.com/docs/phone-numbers/api/incoming-phone-number-resource
 */
export async function provisionPhoneNumber(areaCode?: string): Promise<ProvisionResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();

  if (!accountSid || !authToken) {
    return { success: false, error: 'Twilio not configured' };
  }

  const client = twilio(accountSid, authToken);

  try {
    // Search for available numbers
    const availableNumbers = await client.availablePhoneNumbers('US')
      .local.list({
        areaCode: areaCode ? parseInt(areaCode) : undefined,
        voiceEnabled: true,
        smsEnabled: true,
        limit: 1,
      });

    if (!availableNumbers.length) {
      // Fallback to toll-free if no local numbers
      const tollFree = await client.availablePhoneNumbers('US')
        .tollFree.list({
          voiceEnabled: true,
          limit: 1,
        });

      if (!tollFree.length) {
        return { success: false, error: 'No phone numbers available' };
      }

      // Purchase the toll-free number
      const purchased = await client.incomingPhoneNumbers.create({
        phoneNumber: tollFree[0].phoneNumber,
        voiceUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/vapi`,
        voiceMethod: 'POST',
      });

      return {
        success: true,
        phoneNumber: purchased.phoneNumber,
        phoneSid: purchased.sid,
      };
    }

    // Purchase the local number
    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber: availableNumbers[0].phoneNumber,
      voiceUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/vapi`,
      voiceMethod: 'POST',
    });

    return {
      success: true,
      phoneNumber: purchased.phoneNumber,
      phoneSid: purchased.sid,
    };
  } catch (error: any) {
    console.error('Failed to provision phone number:', error);
    return { success: false, error: error?.message || 'Failed to provision number' };
  }
}

/**
 * Release a provisioned Twilio phone number.
 */
export async function releasePhoneNumber(phoneSid: string): Promise<{ success: boolean; error?: string }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();

  if (!accountSid || !authToken) {
    return { success: false, error: 'Twilio not configured' };
  }

  const client = twilio(accountSid, authToken);

  try {
    await client.incomingPhoneNumbers(phoneSid).remove();
    return { success: true };
  } catch (error: any) {
    console.error('Failed to release phone number:', error);
    return { success: false, error: error?.message || 'Failed to release number' };
  }
}
