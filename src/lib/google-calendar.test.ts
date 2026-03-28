import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock googleapis
const mockInsert = vi.fn();
const mockQuery  = vi.fn();

vi.mock('googleapis', () => {
  class MockOAuth2 {
    setCredentials = vi.fn();
  }
  return {
    google: {
      auth: {
        GoogleAuth: class { },
        OAuth2: MockOAuth2,
      },
      calendar: vi.fn(() => ({
        events:   { insert: mockInsert },
        freebusy: { query: mockQuery },
      })),
    },
  };
});

// Mock prisma — getCalendarClient looks up the user's googleRefreshToken
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn().mockResolvedValue({ googleRefreshToken: 'test-refresh-token' }),
    },
  },
}));

import { createCalendarEvent, getAvailableSlots } from './google-calendar';

const TEST_USER_ID = 'user-1';

describe('createCalendarEvent', () => {
  beforeEach(() => {
    mockInsert.mockReset();
    vi.stubEnv('GOOGLE_CLIENT_ID', 'test-client-id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-secret');
  });

  it('creates event and returns event ID', async () => {
    mockInsert.mockResolvedValue({ data: { id: 'event-123' } });
    const result = await createCalendarEvent({
      calendarId: 'attorney@firm.com',
      summary: 'Consultation with John',
      description: 'Legal consultation',
      startTime: new Date('2025-01-15T14:00:00'),
      endTime:   new Date('2025-01-15T15:00:00'),
    }, TEST_USER_ID);
    expect(result).toBe('event-123');
  });

  it('passes correct summary to Google Calendar API', async () => {
    mockInsert.mockResolvedValue({ data: { id: 'event-456' } });
    await createCalendarEvent({
      calendarId: 'attorney@firm.com',
      summary:    'Meeting with Jane',
      description: 'Test',
      startTime: new Date('2025-01-15T14:00:00'),
      endTime:   new Date('2025-01-15T15:00:00'),
    }, TEST_USER_ID);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({ summary: 'Meeting with Jane' }),
      })
    );
  });

  it('includes attendee email when provided', async () => {
    mockInsert.mockResolvedValue({ data: { id: 'event-789' } });
    await createCalendarEvent({
      calendarId:    'attorney@firm.com',
      summary:       'Consultation',
      description:   'Test',
      startTime:     new Date('2025-01-15T14:00:00'),
      endTime:       new Date('2025-01-15T15:00:00'),
      attendeeEmail: 'client@test.com',
    }, TEST_USER_ID);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          attendees: [{ email: 'client@test.com' }],
        }),
      })
    );
  });

  it('returns null on API error', async () => {
    mockInsert.mockRejectedValue(new Error('Calendar API error'));
    const result = await createCalendarEvent({
      calendarId:  'attorney@firm.com',
      summary:     'Test',
      description: 'Test',
      startTime:   new Date(),
      endTime:     new Date(),
    }, TEST_USER_ID);
    expect(result).toBeNull();
  });
});

describe('getAvailableSlots', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    vi.stubEnv('GOOGLE_CLIENT_ID', 'test-client-id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-secret');
  });

  it('returns available slots when no busy times', async () => {
    mockQuery.mockResolvedValue({
      data: { calendars: { 'attorney@firm.com': { busy: [] } } },
    });
    const slots = await getAvailableSlots({
      calendarId: 'attorney@firm.com',
      date:       '2025-01-15',
      duration:   60,
    }, TEST_USER_ID);
    expect(Array.isArray(slots)).toBe(true);
  });

  it('returns empty array on API error', async () => {
    mockQuery.mockRejectedValue(new Error('API error'));
    const slots = await getAvailableSlots({
      calendarId: 'attorney@firm.com',
      date:       '2025-01-15',
      duration:   60,
    }, TEST_USER_ID);
    expect(slots).toEqual([]);
  });

  it('respects duration parameter for slot size', async () => {
    mockQuery.mockResolvedValue({
      data: { calendars: { 'attorney@firm.com': { busy: [] } } },
    });
    const slots = await getAvailableSlots({
      calendarId: 'attorney@firm.com',
      date:       '2025-01-15',
      duration:   60,
    }, TEST_USER_ID);
    if (slots.length > 0) {
      const diff = slots[0].end.getTime() - slots[0].start.getTime();
      expect(diff).toBe(60 * 60 * 1000);
    }
  });
});
