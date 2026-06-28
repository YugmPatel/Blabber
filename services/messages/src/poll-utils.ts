import { ObjectId } from 'mongodb';
import type { MessageDocument } from './models/message';

type Poll = NonNullable<MessageDocument['poll']>;

function idsEqual(left: ObjectId | string, right: ObjectId | string) {
  return left.toString() === right.toString();
}

export function getPollVoteRecords(poll: Poll) {
  if (poll.votes) return poll.votes;

  const records = new Map<string, { userId: ObjectId; optionIds: string[]; votedAt: Date; updatedAt: Date }>();
  for (const option of poll.options) {
    for (const voterId of option.votes || []) {
      const key = voterId.toString();
      const existing = records.get(key);
      if (existing) {
        existing.optionIds.push(option.id);
      } else {
        records.set(key, {
          userId: voterId,
          optionIds: [option.id],
          votedAt: new Date(0),
          updatedAt: new Date(0),
        });
      }
    }
  }
  return Array.from(records.values());
}

export function buildPollOptionsFromVotes(poll: Poll) {
  const records = getPollVoteRecords(poll);
  return poll.options.map((option) => {
    const votes = records
      .filter((record) => record.optionIds.includes(option.id))
      .map((record) => record.userId);
    return {
      ...option,
      votes,
      voteCount: votes.length,
    };
  });
}

export function getUserPollVote(poll: Poll, userId?: ObjectId | string) {
  if (!userId) return [];
  return getPollVoteRecords(poll).find((record) => idsEqual(record.userId, userId))?.optionIds || [];
}

export function isPollClosed(poll: Poll, now = new Date()) {
  if (poll.closed || poll.closedAt) return true;
  return Boolean(poll.closesAt && poll.closesAt.getTime() <= now.getTime());
}
