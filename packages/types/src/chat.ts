import { z } from 'zod';

// Chat TypeScript Interface
export interface Chat {
  _id: string;
  type: 'direct' | 'group';
  participants: string[];
  admins: string[];
  ownerId?: string;
  title?: string;
  description?: string;
  groupContext?: string;
  avatarUrl?: string;
  groupKind?: 'standard' | 'temporary';
  expiresAt?: Date;
  endedAt?: Date;
  deletedAt?: Date;
  participantProfiles?: ChatParticipantProfile[];
  lastMessageRef?: {
    messageId: string;
    body: string;
    senderId: string;
    createdAt: Date;
  };
  unreadCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatParticipantProfile {
  _id: string;
  name: string;
  username?: string;
  email?: string;
  avatarUrl?: string;
}

// Chat Zod Schema
export const ChatParticipantProfileSchema = z.object({
  _id: z.string(),
  name: z.string(),
  username: z.string().optional(),
  email: z.string().optional(),
  avatarUrl: z.string().url().optional(),
});

export const ChatSchema = z.object({
  _id: z.string(),
  type: z.enum(['direct', 'group']),
  participants: z.array(z.string()).min(2),
  admins: z.array(z.string()),
  ownerId: z.string().optional(),
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  groupContext: z.string().max(2000).optional(),
  avatarUrl: z.string().url().optional(),
  groupKind: z.enum(['standard', 'temporary']).optional(),
  expiresAt: z.date().optional(),
  endedAt: z.date().optional(),
  deletedAt: z.date().optional(),
  participantProfiles: z.array(ChatParticipantProfileSchema).optional(),
  lastMessageRef: z.object({
    messageId: z.string(),
    body: z.string(),
    senderId: z.string(),
    createdAt: z.date(),
  }).optional(),
  unreadCount: z.number().int().min(0).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Create Chat DTO
export const CreateChatDTOSchema = z.object({
  type: z.enum(['direct', 'group']),
  participantIds: z.array(z.string()).min(2),
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  groupContext: z.string().max(2000).optional(),
  avatarUrl: z.string().url().optional(),
  groupKind: z.enum(['standard', 'temporary']).optional(),
  expiresAt: z.string().datetime().optional(),
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
  description: z.string().max(500).optional(),
  groupContext: z.string().max(2000).optional(),
  avatarUrl: z.string().url().optional(),
  expiresAt: z.string().datetime().optional(),
});

export type UpdateChatDTO = z.infer<typeof UpdateChatDTOSchema>;

// Add Member DTO
export const AddMemberDTOSchema = z.object({
  userId: z.string(),
});

export type AddMemberDTO = z.infer<typeof AddMemberDTOSchema>;

export const UpdateGroupRoleDTOSchema = z.object({
  userId: z.string(),
});

export type UpdateGroupRoleDTO = z.infer<typeof UpdateGroupRoleDTOSchema>;
