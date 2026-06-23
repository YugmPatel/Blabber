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
  type?: 'text' | 'image' | 'audio' | 'document' | 'poll' | 'sticker' | 'event';
  body: string;
  media?: {
    type: 'image' | 'audio' | 'document';
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
    }>;
    allowMultiple?: boolean;
    closed?: boolean;
  };
  sticker?: {
    emoji: string;
    label?: string;
  };
  event?: {
    title: string;
    startsAt: string;
    location?: string;
    description?: string;
  };
  replyTo?: {
    messageId: string;
    body: string;
    senderId: string;
  };
  reactions: Reaction[];
  status: 'sent' | 'delivered' | 'read';
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
  type: z.enum(['text', 'image', 'audio', 'document', 'poll', 'sticker', 'event']).optional(),
  body: z.string().max(10000),
  media: z.object({
    type: z.enum(['image', 'audio', 'document']),
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
    })),
    allowMultiple: z.boolean().optional(),
    closed: z.boolean().optional(),
  }).optional(),
  sticker: z.object({
    emoji: z.string(),
    label: z.string().optional(),
  }).optional(),
  event: z.object({
    title: z.string(),
    startsAt: z.string(),
    location: z.string().optional(),
    description: z.string().optional(),
  }).optional(),
  replyTo: z.object({
    messageId: z.string(),
    body: z.string(),
    senderId: z.string(),
  }).optional(),
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
  }).optional(),
  sticker: z.object({
    emoji: z.string().min(1).max(20),
    label: z.string().max(80).optional(),
  }).optional(),
  event: z.object({
    title: z.string().min(1).max(200),
    startsAt: z.string().min(1),
    location: z.string().max(200).optional(),
    description: z.string().max(1000).optional(),
  }).optional(),
  replyToId: z.string().optional(),
  clientMessageId: z.string().optional(),
  tempId: z.string().optional(),
});

export type CreateMessageDTO = z.infer<typeof CreateMessageDTOSchema>;

// Update Message DTO
export const UpdateMessageDTOSchema = z.object({
  body: z.string().min(1).max(10000),
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
  optionId: z.string().min(1),
});

export type PollVoteDTO = z.infer<typeof PollVoteDTOSchema>;
