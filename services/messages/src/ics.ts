import type { MessageDocument } from './models/message';

function formatIcsDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function foldLine(line: string) {
  const chunks: string[] = [];
  let remaining = line;
  while (remaining.length > 73) {
    chunks.push(remaining.slice(0, 73));
    remaining = ` ${remaining.slice(73)}`;
  }
  chunks.push(remaining);
  return chunks.join('\r\n');
}

function line(name: string, value: string) {
  return foldLine(`${name}:${escapeIcsText(value)}`);
}

function propertyValue(value: string) {
  return escapeIcsText(value).replace(/:/g, '\\:');
}

export function buildEventIcs(message: MessageDocument) {
  if (!message.event) {
    throw new Error('Message is not an event');
  }

  const start = message.event.startAt || new Date(message.event.startsAt);
  const end = message.event.endAt || new Date(start.getTime() + 60 * 60 * 1000);
  const now = new Date();
  const uid = `${message._id.toString()}@blabber.local`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Blabber//Messaging Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    message.event.timezone ? `X-WR-TIMEZONE:${propertyValue(message.event.timezone)}` : undefined,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatIcsDate(now)}`,
    `DTSTART:${formatIcsDate(start)}`,
    `DTEND:${formatIcsDate(end)}`,
    line('SUMMARY', message.event.title),
  ].filter(Boolean) as string[];

  if (message.event.description) lines.push(line('DESCRIPTION', message.event.description));
  if (message.event.location) lines.push(line('LOCATION', message.event.location));
  if (message.event.meetingUrl) lines.push(line('URL', message.event.meetingUrl));

  lines.push(
    `STATUS:${message.event.cancelledAt ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR'
  );

  return `${lines.join('\r\n')}\r\n`;
}

export function eventIcsFilename(title: string) {
  const safe = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return `${safe || 'blabber-event'}.ics`;
}
