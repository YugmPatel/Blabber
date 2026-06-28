import type { ObjectId } from 'mongodb';

export function parseEventDate(value: string | Date | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function validateTimezone(timezone: string | undefined) {
  if (!timezone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return null;
  }
}

export function validateMeetingUrl(value: string | null | undefined) {
  if (value === null || value === undefined || value.trim() === '') return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function objectIdToString(id: ObjectId | string | undefined) {
  if (!id) return undefined;
  return typeof id === 'string' ? id : id.toString();
}
