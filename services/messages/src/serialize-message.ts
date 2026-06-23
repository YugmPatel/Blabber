import type { ObjectId } from 'mongodb';
import type { MessageDocument } from './models/message';

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

export function serializeMessage(message: MessageDocument, tempId?: string) {
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
          options: message.poll.options.map((option) => ({
            ...option,
            votes: option.votes.map(objectIdToString),
          })),
        }
      : undefined,
    sticker: message.sticker,
    event: message.event,
    replyTo: message.replyTo
      ? {
          messageId: objectIdToString(message.replyTo.messageId),
          body: message.replyTo.body,
          senderId: objectIdToString(message.replyTo.senderId),
        }
      : undefined,
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
