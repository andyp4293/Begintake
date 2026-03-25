import twilio from 'twilio';
import { isValidPhoneNumber, normalizePhoneNumber } from '@/lib/phone';

interface SendSMSParams {
  to: string;
  message: string;
}

interface SMSResult {
  success: boolean;
  sid?: string;
  error?: string;
}

export async function sendSMS({ to, message }: SendSMSParams): Promise<SMSResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const fromNumber = process.env.TWILIO_PHONE_NUMBER?.trim();

  if (!accountSid || !authToken || !fromNumber) {
    console.log('SMS disabled (Twilio not configured)');
    return { success: false, error: 'Twilio not configured' };
  }

  if (!isValidPhoneNumber(to)) {
    console.error('Invalid phone number:', to);
    return { success: false, error: 'Invalid phone number format' };
  }

  const client = twilio(accountSid, authToken);
  const formattedPhone = normalizePhoneNumber(to);

  try {
    const result = await client.messages.create({
      body: message,
      from: fromNumber,
      to: formattedPhone,
    });
    console.log('SMS sent:', result.sid);
    return { success: true, sid: result.sid };
  } catch (error: any) {
    console.error('Failed to send SMS:', error);
    return { success: false, error: error?.message || 'Failed to send SMS' };
  }
}
