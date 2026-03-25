import { google } from 'googleapis';

function getCalendarClient() {
  // Option 1: Service account (recommended for server-to-server)
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (serviceAccountKey) {
    const credentials = JSON.parse(serviceAccountKey);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    return google.calendar({ version: 'v3', auth });
  }

  // Option 2: OAuth2 with refresh token
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  if (process.env.GOOGLE_REFRESH_TOKEN) {
    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });
  }

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
    const calendar = getCalendarClient();

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

    return event.data.id || null;
  } catch (error: any) {
    console.error('Failed to create calendar event:', error);
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

export async function getAvailableSlots(params: GetSlotsParams): Promise<TimeSlot[]> {
  try {
    const calendar = getCalendarClient();

    const dayStart = new Date(`${params.date}T09:00:00-05:00`);
    const dayEnd = new Date(`${params.date}T17:00:00-05:00`);

    const busyResponse = await calendar.freebusy.query({
      requestBody: {
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        items: [{ id: params.calendarId || 'primary' }],
      },
    });

    const busySlots = busyResponse.data.calendars?.[params.calendarId || 'primary']?.busy || [];

    // Generate available slots
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

      current = new Date(current.getTime() + 30 * 60 * 1000); // 30-min increments
    }

    return slots;
  } catch (error: any) {
    console.error('Failed to get available slots:', error);
    return [];
  }
}
