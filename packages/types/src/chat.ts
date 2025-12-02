import { z } from 'zod';

// Chat TypeScript Interface
export interface Chat {
  _id: string;
  type: 'direct' | 'group';
  participants: string[];
  admins: string[];
  title?: string;
  avatarUrl?: string;
  lastMessageRef?: {
    messageId: string;
    body: string;
    senderId: string;
    createdAt: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

// Chat Zod Schema
export const ChatSchema = z.object({
  _id: z.string(),
  type: z.enum(['direct', 'group']),
  participants: z.array(z.string()).min(2),
  admins: z.array(z.string()),
  title: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().optional(),
  lastMessageRef: z.object({
    messageId: z.string(),
    body: z.string(),
    senderId: z.string(),
    createdAt: z.date(),
  }).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Create Chat DTO
export const CreateChatDTOSchema = z.object({
  type: z.enum(['direct', 'group']),
  participantIds: z.array(z.string()).min(2),
  title: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().optional(),
}).refine(
  (data) => {
    if (data.type === 'direct' && data.participantIds.length !== 2) {
      return false;
    }
    if (data.type === 'group' && !data.title) {
      return false;
    }
    return true;
  },
  {
    message: 'Direct chats must have exactly 2 participants, group chats must have a title',
  }
);

export type CreateChatDTO = z.infer<typeof CreateChatDTOSchema>;

// Update Chat DTO
export const UpdateChatDTOSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().optional(),
});

export type UpdateChatDTO = z.infer<typeof UpdateChatDTOSchema>;

// Add Member DTO
export const AddMemberDTOSchema = z.object({
  userId: z.string(),
});

export type AddMemberDTO = z.infer<typeof AddMemberDTOSchema>;
