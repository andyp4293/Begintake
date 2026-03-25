import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyVapiSecret, parseToolArguments } from './vapi';

describe('verifyVapiSecret', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns true when no secret configured', () => {
    vi.stubEnv('VAPI_WEBHOOK_SECRET', '');
    expect(verifyVapiSecret(null)).toBe(true);
  });

  it('returns true when secrets match', () => {
    vi.stubEnv('VAPI_WEBHOOK_SECRET', 'my-secret');
    expect(verifyVapiSecret('my-secret')).toBe(true);
  });

  it('returns false when secrets do not match', () => {
    vi.stubEnv('VAPI_WEBHOOK_SECRET', 'my-secret');
    expect(verifyVapiSecret('wrong-secret')).toBe(false);
  });

  it('returns false when no secret provided but one expected', () => {
    vi.stubEnv('VAPI_WEBHOOK_SECRET', 'my-secret');
    expect(verifyVapiSecret(null)).toBe(false);
  });

  it('returns false for empty string when secret expected', () => {
    vi.stubEnv('VAPI_WEBHOOK_SECRET', 'my-secret');
    expect(verifyVapiSecret('')).toBe(false);
  });
});

describe('parseToolArguments', () => {
  it('parses JSON string arguments', () => {
    const result = parseToolArguments('{"name": "John", "phone": "+15551234567"}');
    expect(result).toEqual({ name: 'John', phone: '+15551234567' });
  });

  it('passes through object arguments', () => {
    const args = { name: 'John', phone: '+15551234567' };
    expect(parseToolArguments(args)).toEqual(args);
  });

  it('returns empty object for null', () => {
    expect(parseToolArguments(null)).toEqual({});
  });

  it('returns empty object for undefined', () => {
    expect(parseToolArguments(undefined)).toEqual({});
  });

  it('returns empty object for invalid JSON string', () => {
    expect(parseToolArguments('not json')).toEqual({});
  });

  it('returns empty object for non-object JSON', () => {
    expect(parseToolArguments('"just a string"')).toEqual({});
  });

  it('returns empty object for number', () => {
    expect(parseToolArguments(42)).toEqual({});
  });

  it('returns empty object for boolean', () => {
    expect(parseToolArguments(true)).toEqual({});
  });

  it('handles nested objects', () => {
    const result = parseToolArguments('{"data": {"nested": true}}');
    expect(result).toEqual({ data: { nested: true } });
  });
});
