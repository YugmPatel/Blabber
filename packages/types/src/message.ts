import { z } from 'zod';

// Reaction TypeScript Interface
export interface Reaction {
  userId: string;
  emoji: string;
  createdAt: Date;
}

// Message TypeScript Interface
export interface Message {
  _id: string;
  chatId: string;
  senderId: string;
  clientMessageId?: string;
  type?: 'text' | 'image' | 'audio' | 'document' | 'video' | 'poll' | 'sticker' | 'event';
  body: string;
  media?: {
    type: 'image' | 'audio' | 'document' | 'video';
    url: string;
    mediaId?: string;
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
      votes: string[];
      voteCount?: number;
    }>;
    allowMultiple?: boolean;
    allowVoteChanges?: boolean;
    showVoters?: boolean;
    closesAt?: string;
    closedAt?: string;
    closedBy?: string;
    createdBy?: string;
    currentUserVote?: string[];
    votes?: Array<{
      userId: string;
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
    startAt?: string;
    endAt?: string;
    timezone?: string;
    location?: string;
    meetingUrl?: string;
    description?: string;
    createdBy?: string;
    updatedAt?: Date;
    cancelledAt?: string;
    cancelledBy?: string;
    reminderEnabled?: boolean;
    reminderOffsetMinutes?: number;
    currentUserRsvp?: 'going' | 'maybe' | 'declined';
    rsvps?: Array<{
      userId: string;
      status: 'going' | 'maybe' | 'declined';
      respondedAt: Date;
      updatedAt: Date;
    }>;
  };
  planThis?: {
    planId: string;
    kind: 'proposal' | 'finalized' | 'updated' | 'cancelled';
    planVersion?: number;
    title?: string;
    status?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  sharedItem?: {
    type: 'post' | 'reel';
    id: string;
    url: string;
    text?: string;
    authorName?: string;
    thumbnailUrl?: string;
    createdAt?: string;
  };
  replyTo?: {
    messageId: string;
    body: string;
    senderId: string;
    senderDisplayName?: string;
    messageType?: Message['type'];
    snippet?: string;
    attachmentLabel?: string;
    unavailable?: boolean;
  };
  forwarded?: {
    isForwarded: boolean;
  };
  momentReply?: {
    isMomentReply: boolean;
    label: string;
    momentId?: string;
    authorUserId?: string;
    authorName?: string;
    momentType?: 'text' | 'image' | 'audio' | 'video';
    text?: string;
    mediaUrl?: string;
    unavailable?: boolean;
  };
  mentions?: Array<{
    userId: string;
    start: number;
    length: number;
    displayName: string;
  }>;
  reactions: Reaction[];
  // 'failed' is client-only: an optimistic message whose send attempt errored
  // out or timed out waiting for an ack. The server never persists or
  // returns this status.
  status: 'sent' | 'delivered' | 'read' | 'failed';
  deletedFor: string[];
  createdAt: Date;
  editedAt?: Date;
}

// Reaction Zod Schema
export const ReactionSchema = z.object({
  userId: z.string(),
  emoji: z.string().min(1).max(10),
  createdAt: z.date(),
});

// Message Zod Schema
export const MessageSchema = z.object({
  _id: z.string(),
  chatId: z.string(),
  senderId: z.string(),
  clientMessageId: z.string().optional(),
  type: z.enum(['text', 'image', 'audio', 'document', 'video', 'poll', 'sticker', 'event']).optional(),
  body: z.string().max(10000),
  media: z.object({
    type: z.enum(['image', 'audio', 'document', 'video']),
    url: z.string().url(),
    mediaId: z.string().optional(),
    storageKey: z.string().optional(),
    fileName: z.string().optional(),
    mimeType: z.string().optional(),
    size: z.number().positive().optional(),
    duration: z.number().positive().optional(),
    thumbnailUrl: z.string().url().optional(),
  }).optional(),
  poll: z.object({
    question: z.string(),
    options: z.array(z.object({
      id: z.string(),
      text: z.string(),
      votes: z.array(z.string()),
      voteCount: z.number().int().min(0).optional(),
    })),
    allowMultiple: z.boolean().optional(),
    allowVoteChanges: z.boolean().optional(),
    showVoters: z.boolean().optional(),
    closesAt: z.string().optional(),
    closedAt: z.string().optional(),
    closedBy: z.string().optional(),
    createdBy: z.string().optional(),
    currentUserVote: z.array(z.string()).optional(),
    votes: z.array(z.object({
      userId: z.string(),
      optionIds: z.array(z.string()),
      votedAt: z.date(),
      updatedAt: z.date(),
    })).optional(),
    closed: z.boolean().optional(),
  }).optional(),
  sticker: z.object({
    emoji: z.string(),
    label: z.string().optional(),
  }).optional(),
  event: z.object({
    title: z.string(),
    startsAt: z.string(),
    startAt: z.string().optional(),
    endAt: z.string().optional(),
    timezone: z.string().optional(),
    location: z.string().optional(),
    meetingUrl: z.string().optional(),
    description: z.string().optional(),
    createdBy: z.string().optional(),
    updatedAt: z.date().optional(),
    cancelledAt: z.string().optional(),
    cancelledBy: z.string().optional(),
    reminderEnabled: z.boolean().optional(),
    reminderOffsetMinutes: z.number().int().positive().optional(),
    currentUserRsvp: z.enum(['going', 'maybe', 'declined']).optional(),
    rsvps: z.array(z.object({
      userId: z.string(),
      status: z.enum(['going', 'maybe', 'declined']),
      respondedAt: z.date(),
      updatedAt: z.date(),
    })).optional(),
  }).optional(),
  planThis: z.object({
    planId: z.string(),
    kind: z.enum(['proposal', 'finalized', 'updated', 'cancelled']),
    planVersion: z.number().int().min(0).optional(),
    title: z.string().optional(),
    status: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  }).optional(),
  sharedItem: z.object({
    type: z.enum(['post', 'reel']),
    id: z.string(),
    url: z.string(),
    text: z.string().optional(),
    authorName: z.string().optional(),
    thumbnailUrl: z.string().optional(),
    createdAt: z.string().optional(),
  }).optional(),
  replyTo: z.object({
    messageId: z.string(),
    body: z.string(),
    senderId: z.string(),
    senderDisplayName: z.string().optional(),
    messageType: z.enum(['text', 'image', 'audio', 'document', 'video', 'poll', 'sticker', 'event']).optional(),
    snippet: z.string().optional(),
    attachmentLabel: z.string().optional(),
    unavailable: z.boolean().optional(),
  }).optional(),
  forwarded: z.object({
    isForwarded: z.boolean(),
  }).optional(),
  momentReply: z.object({
    isMomentReply: z.boolean(),
    label: z.string(),
    momentId: z.string().optional(),
    authorUserId: z.string().optional(),
    authorName: z.string().optional(),
    momentType: z.enum(['text', 'image', 'audio', 'video']).optional(),
    text: z.string().optional(),
    mediaUrl: z.string().optional(),
    unavailable: z.boolean().optional(),
  }).optional(),
  mentions: z.array(z.object({
    userId: z.string(),
    start: z.number().int().min(0),
    length: z.number().int().positive(),
    displayName: z.string(),
  })).optional(),
  reactions: z.array(ReactionSchema),
  status: z.enum(['sent', 'delivered', 'read']),
  deletedFor: z.array(z.string()),
  createdAt: z.date(),
  editedAt: z.date().optional(),
});

// Create Message DTO
export const CreateMessageDTOSchema = z.object({
  body: z.string().min(1).max(10000),
  type: z.enum(['text', 'poll', 'sticker', 'event']).optional(),
  mediaId: z.string().optional(),
  mediaDuration: z.number().positive().optional(),
  poll: z.object({
    question: z.string().min(1).max(300),
    options: z.array(z.string().min(1).max(200)).min(2).max(12),
    allowMultiple: z.boolean().optional(),
    allowVoteChanges: z.boolean().optional(),
    showVoters: z.boolean().optional(),
    closesAt: z.string().datetime().optional(),
  }).optional(),
  sticker: z.object({
    emoji: z.string().min(1).max(20),
    label: z.string().max(80).optional(),
  }).optional(),
  event: z.object({
    title: z.string().min(1).max(200),
    startsAt: z.string().min(1),
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
    timezone: z.string().min(1).max(80).optional(),
    location: z.string().max(200).optional(),
    meetingUrl: z.string().url().optional(),
    description: z.string().max(1000).optional(),
    reminderEnabled: z.boolean().optional(),
    reminderOffsetMinutes: z.number().int().positive().optional(),
  }).optional(),
  replyToId: z.string().optional(),
  // Client sends only the reference — the server resolves and verifies the
  // real text/author/thumbnail from the source post/reel, the same way
  // `mediaId` is resolved into `media` above. Never trust client-supplied
  // shared-item display data.
  sharedItem: z.object({
    type: z.enum(['post', 'reel']),
    id: z.string(),
  }).optional(),
  mentions: z.array(z.object({
    userId: z.string(),
    start: z.number().int().min(0),
    length: z.number().int().positive(),
  })).max(20).optional(),
  clientMessageId: z.string().optional(),
  tempId: z.string().optional(),
});

export type CreateMessageDTO = z.infer<typeof CreateMessageDTOSchema>;

// Update Message DTO
export const UpdateMessageDTOSchema = z.object({
  body: z.string().min(1).max(10000),
  mentions: z.array(z.object({
    userId: z.string(),
    start: z.number().int().min(0),
    length: z.number().int().positive(),
  })).max(20).optional(),
});

export type UpdateMessageDTO = z.infer<typeof UpdateMessageDTOSchema>;

// Add Reaction DTO
export const AddReactionDTOSchema = z.object({
  emoji: z.string().min(1).max(10),
});

export type AddReactionDTO = z.infer<typeof AddReactionDTOSchema>;

// Mark Read DTO
export const MarkReadDTOSchema = z.object({
  messageIds: z.array(z.string()).min(1),
});

export type MarkReadDTO = z.infer<typeof MarkReadDTOSchema>;

// Poll Vote DTO
export const PollVoteDTOSchema = z.object({
  optionId: z.string().min(1).optional(),
  optionIds: z.array(z.string().min(1)).min(1).max(12).optional(),
}).refine((value) => Boolean(value.optionId || value.optionIds?.length), {
  message: 'At least one poll option is required',
});

export type PollVoteDTO = z.infer<typeof PollVoteDTOSchema>;

export const EventRsvpDTOSchema = z.object({
  status: z.enum(['going', 'maybe', 'declined']),
});

export type EventRsvpDTO = z.infer<typeof EventRsvpDTOSchema>;

export const UpdateEventDTOSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  startsAt: z.string().min(1).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  timezone: z.string().min(1).max(80).optional(),
  location: z.string().max(200).optional(),
  meetingUrl: z.string().url().optional().nullable(),
  description: z.string().max(1000).optional(),
  reminderEnabled: z.boolean().optional(),
  reminderOffsetMinutes: z.number().int().positive().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one event field is required',
});

export type UpdateEventDTO = z.infer<typeof UpdateEventDTOSchema>;
