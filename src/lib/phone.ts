/**
 * Phone number normalization and validation utilities.
 * Ported from ClientFlow patterns.
 */

export function normalizePhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.startsWith('+')) return phone.replace(/[^\d+]/g, '');
  return `+${digits}`;
}

export function isE164PhoneNumber(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

export function isValidPhoneNumber(phone: string): boolean {
  if (!phone) return false;
  const normalized = normalizePhoneNumber(phone);
  return isE164PhoneNumber(normalized);
}

export function normalizeOptionalPhoneNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const normalized = normalizePhoneNumber(phone);
  return isE164PhoneNumber(normalized) ? normalized : null;
}
