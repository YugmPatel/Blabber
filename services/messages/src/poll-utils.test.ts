import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { buildPollOptionsFromVotes, getUserPollVote, isPollClosed } from './poll-utils';
import type { MessageDocument } from './models/message';

describe('poll utils', () => {
  it('normalizes legacy option vote arrays into per-option counts', () => {
    const userA = new ObjectId();
    const userB = new ObjectId();
    const poll: NonNullable<MessageDocument['poll']> = {
      question: 'Lunch?',
      options: [
        { id: 'option-1', text: 'Tacos', votes: [userA, userB] },
        { id: 'option-2', text: 'Sushi', votes: [userA] },
      ],
      allowMultiple: true,
      closed: false,
    };

    expect(getUserPollVote(poll, userA)).toEqual(['option-1', 'option-2']);
    expect(buildPollOptionsFromVotes(poll).map((option) => option.voteCount)).toEqual([2, 1]);
  });

  it('treats elapsed close times as closed without mutating the poll', () => {
    const poll: NonNullable<MessageDocument['poll']> = {
      question: 'Ship?',
      options: [
        { id: 'option-1', text: 'Yes', votes: [] },
        { id: 'option-2', text: 'No', votes: [] },
      ],
      closesAt: new Date('2026-01-01T00:00:00.000Z'),
      closed: false,
    };

    expect(isPollClosed(poll, new Date('2026-01-02T00:00:00.000Z'))).toBe(true);
  });
});
