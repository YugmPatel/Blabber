import type { ObjectId } from 'mongodb';
import type { MessageDocument } from './models/message';
import { buildPollOptionsFromVotes, getPollVoteRecords, getUserPollVote, isPollClosed } from './poll-utils';
import { objectIdToString as maybeObjectIdToString } from './event-utils';

function objectIdToString(id: ObjectId | string) {
  return typeof id === 'string' ? id : id.toString();
}

function inferMessageType(message: MessageDocument) {
  if (message.type) return message.type;
  if (message.poll) return 'poll';
  if (message.sticker) return 'sticker';
  if (message.event) return 'event';
  if (message.media) return message.media.type;
  return 'text';
}

function dateToIso(value: Date | string | undefined) {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

export function serializeMessage(message: MessageDocument, tempId?: string, viewerId?: ObjectId | string) {
  const pollOptions = message.poll ? buildPollOptionsFromVotes(message.poll) : undefined;
  const pollVotes = message.poll ? getPollVoteRecords(message.poll) : undefined;
  const currentUserRsvp = viewerId && message.event?.rsvps
    ? message.event.rsvps.find((rsvp) => rsvp.userId.toString() === viewerId.toString())?.status
    : undefined;

  return {
    _id: objectIdToString(message._id),
    chatId: objectIdToString(message.chatId),
    senderId: objectIdToString(message.senderId),
    clientMessageId: message.clientMessageId,
    type: inferMessageType(message),
    body: message.body,
    media: message.media
      ? {
          ...message.media,
          mediaId: message.media.mediaId ? objectIdToString(message.media.mediaId) : undefined,
        }
      : undefined,
    poll: message.poll
      ? {
          ...message.poll,
          options: (pollOptions || message.poll.options).map((option) => ({
            ...option,
            votes: message.poll?.showVoters ? option.votes.map(objectIdToString) : [],
            voteCount: option.voteCount ?? option.votes.length,
          })),
          votes: message.poll.showVoters
            ? pollVotes?.map((vote) => ({
                userId: objectIdToString(vote.userId),
                optionIds: vote.optionIds,
                votedAt: vote.votedAt,
                updatedAt: vote.updatedAt,
              }))
            : undefined,
          currentUserVote: getUserPollVote(message.poll, viewerId),
          closesAt: dateToIso(message.poll.closesAt),
          closedAt: dateToIso(message.poll.closedAt),
          closedBy: maybeObjectIdToString(message.poll.closedBy),
          createdBy: maybeObjectIdToString(message.poll.createdBy),
          closed: isPollClosed(message.poll),
        }
      : undefined,
    sticker: message.sticker,
    event: message.event
      ? {
          ...message.event,
          startAt: dateToIso(message.event.startAt),
          endAt: dateToIso(message.event.endAt),
          startsAt: message.event.startAt ? message.event.startAt.toISOString() : message.event.startsAt,
          createdBy: maybeObjectIdToString(message.event.createdBy),
          cancelledAt: dateToIso(message.event.cancelledAt),
          cancelledBy: maybeObjectIdToString(message.event.cancelledBy),
          currentUserRsvp,
          rsvps: message.event.rsvps?.map((rsvp) => ({
            userId: objectIdToString(rsvp.userId),
            status: rsvp.status,
            respondedAt: rsvp.respondedAt,
            updatedAt: rsvp.updatedAt,
          })),
        }
      : undefined,
    replyTo: message.replyTo
      ? {
          messageId: objectIdToString(message.replyTo.messageId),
          body: message.replyTo.body,
          senderId: objectIdToString(message.replyTo.senderId),
          senderDisplayName: message.replyTo.senderDisplayName,
          messageType: message.replyTo.messageType,
          snippet: message.replyTo.snippet,
          attachmentLabel: message.replyTo.attachmentLabel,
          unavailable: message.replyTo.unavailable,
        }
      : undefined,
    forwarded: message.forwarded,
    momentReply: message.momentReply
      ? {
          isMomentReply: true,
          label: message.momentReply.label || 'Replied to a Moment',
        }
      : undefined,
    mentions: message.mentions?.map((mention) => ({
      userId: objectIdToString(mention.userId),
      start: mention.start,
      length: mention.length,
      displayName: mention.displayName,
    })),
    reactions: message.reactions.map((reaction) => ({
      userId: objectIdToString(reaction.userId),
      emoji: reaction.emoji,
      createdAt: reaction.createdAt,
    })),
    status: message.status,
    deletedFor: message.deletedFor.map(objectIdToString),
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    tempId,
  };
}
