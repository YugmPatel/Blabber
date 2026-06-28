import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';
import { logger } from '@repo/utils';

export interface MessageDocument {
  _id: ObjectId;
  chatId: ObjectId;
  senderId: ObjectId;
  clientMessageId?: string;
  type?: 'text' | 'image' | 'audio' | 'document' | 'poll' | 'sticker' | 'event';
  body: string;
  media?: {
    type: 'image' | 'audio' | 'document';
    url: string;
    mediaId?: ObjectId;
    storageKey?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
    duration?: number;
    thumbnailUrl?: string;
  };
  poll?: {
    question: string;
    options: Array<{
      id: string;
      text: string;
      votes: ObjectId[];
      voteCount?: number;
    }>;
    allowMultiple?: boolean;
    allowVoteChanges?: boolean;
    showVoters?: boolean;
    closesAt?: Date;
    closedAt?: Date;
    closedBy?: ObjectId;
    createdBy?: ObjectId;
    votes?: Array<{
      userId: ObjectId;
      optionIds: string[];
      votedAt: Date;
      updatedAt: Date;
    }>;
    closed?: boolean;
  };
  sticker?: {
    emoji: string;
    label?: string;
  };
  event?: {
    title: string;
    startsAt: string;
    startAt?: Date;
    endAt?: Date;
    timezone?: string;
    location?: string;
    meetingUrl?: string;
    description?: string;
    createdBy?: ObjectId;
    updatedAt?: Date;
    cancelledAt?: Date;
    cancelledBy?: ObjectId;
    reminderEnabled?: boolean;
    rsvps?: Array<{
      userId: ObjectId;
      status: 'going' | 'maybe' | 'declined';
      respondedAt: Date;
      updatedAt: Date;
    }>;
  };
  replyTo?: {
    messageId: ObjectId;
    body: string;
    senderId: ObjectId;
    senderDisplayName?: string;
    messageType?: MessageDocument['type'];
    snippet?: string;
    attachmentLabel?: string;
    unavailable?: boolean;
  };
  forwarded?: {
    isForwarded: boolean;
  };
  momentReply?: {
    isMomentReply: boolean;
    momentId?: ObjectId;
    authorUserId?: ObjectId;
    label?: string;
    createdAt?: Date;
  };
  mentions?: Array<{
    userId: ObjectId;
    start: number;
    length: number;
    displayName: string;
  }>;
  reactions: Array<{
    userId: ObjectId;
    emoji: string;
    createdAt: Date;
  }>;
  status: 'sent' | 'delivered' | 'read';
  deletedFor: ObjectId[];
  createdAt: Date;
  editedAt?: Date;
}

export function getMessagesCollection(): Collection<MessageDocument> {
  const db = getDatabase();
  return db.collection<MessageDocument>('messages');
}

export async function createMessageIndexes(): Promise<void> {
  const collection = getMessagesCollection();

  try {
    // Compound index for efficient pagination by chat
    await collection.createIndex({ chatId: 1, createdAt: -1 }, { name: 'chatId_createdAt' });
    await collection.createIndex(
      { type: 1, 'poll.closesAt': 1, 'poll.closed': 1 },
      { name: 'poll_closesAt_open' }
    );
    await collection.createIndex(
      { type: 1, 'event.startAt': 1, 'event.cancelledAt': 1, 'event.reminderEnabled': 1 },
      { name: 'event_reminder_candidates' }
    );

    // Index for sender queries
    await collection.createIndex({ senderId: 1 }, { name: 'senderId' });
    await collection.createIndex({ chatId: 1, 'mentions.userId': 1, createdAt: -1 }, { name: 'chat_mentions_createdAt' });

    await collection.createIndex(
      { chatId: 1, senderId: 1, clientMessageId: 1 },
      {
        name: 'chat_sender_clientMessageId',
        unique: true,
        partialFilterExpression: { clientMessageId: { $exists: true } },
      }
    );

    await collection.createIndex(
      {
        body: 'text',
        'media.fileName': 'text',
        'poll.question': 'text',
        'poll.options.text': 'text',
        'sticker.label': 'text',
        'event.title': 'text',
        'event.location': 'text',
        'event.description': 'text',
      },
      {
        name: 'message_search_text',
        default_language: 'none',
      }
    );

    logger.info('Message indexes created successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to create message indexes');
    throw error;
  }
}
