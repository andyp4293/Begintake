/**
 * Phone number normalization and validation utilities.
 * Ported from ClientFlow patterns.
 */

const SPOKEN_DIGIT_MAP: Record<string, string> = {
  zero: '0',
  oh: '0',
  o: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

const SPOKEN_REPEAT_MAP: Record<string, number> = {
  double: 2,
  triple: 3,
};

function extractPhoneDigits(phone: string): string {
  const numericDigits = phone.replace(/\D/g, '');
  if (numericDigits) return numericDigits;

  const tokens = phone
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  let digits = '';
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const repeatCount = SPOKEN_REPEAT_MAP[token];
    const nextDigit = SPOKEN_DIGIT_MAP[tokens[index + 1] || ''];

    if (repeatCount && nextDigit) {
      digits += nextDigit.repeat(repeatCount);
      index += 1;
      continue;
    }

    const mapped = SPOKEN_DIGIT_MAP[token];
    if (mapped) {
      digits += mapped;
    }
  }

  return digits;
}

export function normalizePhoneNumber(phone: string): string {
  const digits = extractPhoneDigits(phone);
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
