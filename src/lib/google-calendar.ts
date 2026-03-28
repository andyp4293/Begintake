import { google } from 'googleapis';
import { prisma } from '@/lib/prisma';

async function getCalendarClient() {
  // Option 1: Service account (if configured)
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (serviceAccountKey) {
    const credentials = JSON.parse(serviceAccountKey);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.readonly',
      ],
    });
    return google.calendar({ version: 'v3', auth });
  }

  // Option 2: Use stored refresh token from Google OAuth login
  const user = await prisma.user.findFirst({
    where: { googleRefreshToken: { not: null } },
    select: { googleRefreshToken: true },
  });

  if (!user?.googleRefreshToken) {
    throw new Error('No Google Calendar credentials available. Sign in with Google to enable calendar.');
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: user.googleRefreshToken,
  });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

interface CreateEventParams {
  calendarId: string;
  summary: string;
  description: string;
  startTime: Date;
  endTime: Date;
  attendeeEmail?: string;
}

export async function createCalendarEvent(params: CreateEventParams): Promise<string | null> {
  try {
    const calendar = await getCalendarClient();

    const event = await calendar.events.insert({
      calendarId: params.calendarId || 'primary',
      requestBody: {
        summary: params.summary,
        description: params.description,
        start: {
          dateTime: params.startTime.toISOString(),
          timeZone: 'America/New_York',
        },
        end: {
          dateTime: params.endTime.toISOString(),
          timeZone: 'America/New_York',
        },
        ...(params.attendeeEmail
          ? { attendees: [{ email: params.attendeeEmail }] }
          : {}),
      },
    });

    console.log(`[calendar] Event created: ${event.data.id} - ${params.summary}`);
    return event.data.id || null;
  } catch (error: any) {
    console.error('[calendar] Failed to create event:', error?.message || error);
    return null;
  }
}

interface GetSlotsParams {
  calendarId: string;
  date: string; // YYYY-MM-DD
  duration: number; // minutes
}

interface TimeSlot {
  start: Date;
  end: Date;
}

export async function getAvailableSlots(params: GetSlotsParams & { availabilityStart?: number; availabilityEnd?: number }): Promise<TimeSlot[]> {
  try {
    const calendar = await getCalendarClient();

    const startHour = params.availabilityStart ?? 9;
    const endHour   = params.availabilityEnd   ?? 17;
    const pad = (n: number) => String(n).padStart(2, '0');
    const tz = 'America/New_York';
    const dayStart = new Date(`${params.date}T${pad(startHour)}:00:00-05:00`);
    const dayEnd   = new Date(`${params.date}T${pad(endHour)}:00:00-05:00`);

    const calId = params.calendarId || 'primary';
    const busyResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        timeZone: tz,
        items: [{ id: calId }],
      },
    });

    const busySlots = busyResponse.data.calendars?.[calId]?.busy || [];

    const slots: TimeSlot[] = [];
    let current = new Date(dayStart);

    while (current < dayEnd) {
      const slotEnd = new Date(current.getTime() + params.duration * 60 * 1000);
      if (slotEnd > dayEnd) break;

      const isBusy = busySlots.some((busy) => {
        const busyStart = new Date(busy.start!);
        const busyEnd = new Date(busy.end!);
        return current < busyEnd && slotEnd > busyStart;
      });

      if (!isBusy) {
        slots.push({ start: new Date(current), end: new Date(slotEnd) });
      }

      current = new Date(current.getTime() + 30 * 60 * 1000);
    }

    return slots;
  } catch (error: any) {
    console.error('Failed to get available slots:', error?.message || error);
    return [];
  }
}

// ─── Check if an attorney is busy right now (or at a specific time) ──────────

export interface AttorneyAvailabilityResult {
  available: boolean;
  reason?: string;          // why unavailable
  nextFreeAt?: string;      // ISO string suggestion if busy
  withinBusinessHours: boolean;
  calendarChecked: boolean;
}

export async function checkAttorneyBusy(params: {
  /** Attorney's email address or googleCalendarId */
  calendarId: string;
  /** Start of window to check (defaults to now) */
  timeMin?: Date;
  /** End of window to check (defaults to timeMin + 30 min) */
  timeMax?: Date;
  /** Attorney's configured business-hours start (0-23) */
  availabilityStart?: number;
  /** Attorney's configured business-hours end (0-23) */
  availabilityEnd?: number;
}): Promise<AttorneyAvailabilityResult> {
  const now = params.timeMin ?? new Date();
  const windowEnd = params.timeMax ?? new Date(now.getTime() + 30 * 60 * 1000);
  const startHour = params.availabilityStart ?? 9;
  const endHour   = params.availabilityEnd   ?? 17;

  // Convert to Eastern time hour for business hours check
  const easternHour = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })).getHours();
  const withinBusinessHours = easternHour >= startHour && easternHour < endHour;

  if (!withinBusinessHours) {
    const ampm = (h: number) => h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
    return {
      available: false,
      withinBusinessHours: false,
      calendarChecked: false,
      reason: `Outside business hours (available ${ampm(startHour)}–${ampm(endHour)} ET)`,
    };
  }

  // Query Google Calendar freebusy
  try {
    const calendar = await getCalendarClient();
    const busyResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin: now.toISOString(),
        timeMax: windowEnd.toISOString(),
        timeZone: 'America/New_York',
        items: [{ id: params.calendarId }],
      },
    });

    const busy = busyResponse.data.calendars?.[params.calendarId]?.busy ?? [];
    const isBusy = busy.length > 0;

    // Find earliest free time after current busy block
    let nextFreeAt: string | undefined;
    if (isBusy && busy[0]?.end) {
      nextFreeAt = busy[0].end;
    }

    return {
      available: !isBusy,
      withinBusinessHours: true,
      calendarChecked: true,
      reason: isBusy ? 'Attorney has a calendar conflict in the next 30 minutes' : undefined,
      nextFreeAt,
    };
  } catch (err: any) {
    // Calendar not accessible — fall back to hours-only check
    console.warn('[calendar] freebusy check failed, falling back to hours only:', err?.message);
    return {
      available: true,
      withinBusinessHours: true,
      calendarChecked: false,
      reason: 'Calendar not accessible — availability based on business hours only',
    };
  }
}
