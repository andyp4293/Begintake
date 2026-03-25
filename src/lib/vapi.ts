import crypto from 'crypto';

export const VAPI_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '+18557654989';

export function verifyVapiSecret(secret: string | null): boolean {
  const expected = process.env.VAPI_WEBHOOK_SECRET;
  if (!expected) return true; // not configured → skip verification
  if (!secret) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function parseToolArguments(rawArgs: unknown): Record<string, unknown> {
  if (!rawArgs) return {};
  if (typeof rawArgs === 'string') {
    try {
      const parsed = JSON.parse(rawArgs);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof rawArgs === 'object' ? (rawArgs as Record<string, unknown>) : {};
}
