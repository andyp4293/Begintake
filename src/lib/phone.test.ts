import { describe, it, expect } from 'vitest';
import {
  normalizePhoneNumber,
  isE164PhoneNumber,
  isValidPhoneNumber,
  normalizeOptionalPhoneNumber,
} from './phone';

describe('normalizePhoneNumber', () => {
  it('normalizes 10-digit US number', () => {
    expect(normalizePhoneNumber('5551234567')).toBe('+15551234567');
  });

  it('normalizes 11-digit US number with leading 1', () => {
    expect(normalizePhoneNumber('15551234567')).toBe('+15551234567');
  });

  it('normalizes number with dashes', () => {
    expect(normalizePhoneNumber('555-123-4567')).toBe('+15551234567');
  });

  it('normalizes number with parentheses', () => {
    expect(normalizePhoneNumber('(555) 123-4567')).toBe('+15551234567');
  });

  it('normalizes number with dots', () => {
    expect(normalizePhoneNumber('555.123.4567')).toBe('+15551234567');
  });

  it('preserves already-formatted E.164 number', () => {
    expect(normalizePhoneNumber('+15551234567')).toBe('+15551234567');
  });

  it('handles number with spaces', () => {
    expect(normalizePhoneNumber('555 123 4567')).toBe('+15551234567');
  });

  it('handles number with country code prefix', () => {
    expect(normalizePhoneNumber('+1 (555) 123-4567')).toBe('+15551234567');
  });

  it('normalizes spoken-out digits', () => {
    expect(normalizePhoneNumber('one two three seven two seven two four three seven')).toBe('+11237272437');
  });

  it('normalizes repeated spoken digits', () => {
    expect(normalizePhoneNumber('double five five one two three four five six seven')).toBe('+15551234567');
  });
});

describe('isE164PhoneNumber', () => {
  it('returns true for valid E.164 format', () => {
    expect(isE164PhoneNumber('+15551234567')).toBe(true);
  });

  it('returns false for missing plus', () => {
    expect(isE164PhoneNumber('15551234567')).toBe(false);
  });

  it('returns false for too short', () => {
    expect(isE164PhoneNumber('+1234')).toBe(false);
  });

  it('returns false for too long', () => {
    expect(isE164PhoneNumber('+1234567890123456')).toBe(false);
  });

  it('returns false for non-numeric characters', () => {
    expect(isE164PhoneNumber('+1555abc4567')).toBe(false);
  });

  it('returns false for leading zero after plus', () => {
    expect(isE164PhoneNumber('+05551234567')).toBe(false);
  });
});

describe('isValidPhoneNumber', () => {
  it('returns true for valid 10-digit number', () => {
    expect(isValidPhoneNumber('5551234567')).toBe(true);
  });

  it('returns true for valid E.164 number', () => {
    expect(isValidPhoneNumber('+15551234567')).toBe(true);
  });

  it('returns true for formatted number', () => {
    expect(isValidPhoneNumber('(555) 123-4567')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isValidPhoneNumber('')).toBe(false);
  });

  it('returns false for null-like input', () => {
    expect(isValidPhoneNumber('')).toBe(false);
  });

  it('returns false for too-short number', () => {
    expect(isValidPhoneNumber('123')).toBe(false);
  });
});

describe('normalizeOptionalPhoneNumber', () => {
  it('returns normalized number for valid input', () => {
    expect(normalizeOptionalPhoneNumber('5551234567')).toBe('+15551234567');
  });

  it('returns null for null input', () => {
    expect(normalizeOptionalPhoneNumber(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(normalizeOptionalPhoneNumber(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(normalizeOptionalPhoneNumber('')).toBeNull();
  });

  it('returns null for invalid number', () => {
    expect(normalizeOptionalPhoneNumber('abc')).toBeNull();
  });

  it('returns normalized number for spoken digits', () => {
    expect(normalizeOptionalPhoneNumber('one two three seven two seven two four three seven')).toBe('+11237272437');
  });
});
