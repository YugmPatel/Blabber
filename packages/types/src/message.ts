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
  body: string;
  media?: {
    type: 'image' | 'audio' | 'document';
    url: string;
    duration?: number;
    thumbnailUrl?: string;
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
  body: z.string().max(10000),
  media: z.object({
    type: z.enum(['image', 'audio', 'document']),
    url: z.string().url(),
    duration: z.number().positive().optional(),
    thumbnailUrl: z.string().url().optional(),
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
  mediaId: z.string().optional(),
  replyToId: z.string().optional(),
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
