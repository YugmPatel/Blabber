import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { buildEventIcs } from './ics';
import type { MessageDocument } from './models/message';

describe('buildEventIcs', () => {
  it('escapes text fields to prevent calendar field injection', () => {
    const message: MessageDocument = {
      _id: new ObjectId('666000000000000000000001'),
      chatId: new ObjectId(),
      senderId: new ObjectId(),
      type: 'event',
      body: 'Planning',
      event: {
        title: 'Planning\nATTENDEE:bad@example.com',
        startsAt: '2026-07-01T16:00:00.000Z',
        startAt: new Date('2026-07-01T16:00:00.000Z'),
        location: 'Room 1, HQ',
        description: 'Line one\nLine two; with comma, ok',
      },
      reactions: [],
      status: 'sent',
      deletedFor: [],
      createdAt: new Date('2026-06-27T00:00:00.000Z'),
    };

    const ics = buildEventIcs(message);

    expect(ics).toContain('SUMMARY:Planning\\nATTENDEE:bad@example.com');
    expect(ics).toContain('LOCATION:Room 1\\, HQ');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two\\; with comma\\, ok');
    expect(ics).not.toContain('\nATTENDEE:bad@example.com');
  });
});
