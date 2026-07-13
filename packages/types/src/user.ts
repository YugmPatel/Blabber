import { z } from 'zod';

// User TypeScript Interface
export interface User {
  _id: string;
  username: string;
  email: string;
  name: string;
  avatarUrl?: string;
  about?: string;
  profileHandle?: string;
  profileBio?: string;
  profileWebsite?: string;
  profileVisibility?: 'private' | 'public';
  profileHandleChangedAt?: Date;
  profileUpdatedAt?: Date;
  role?: string;
  department?: string;
  contacts: string[];
  blocked: string[];
  lastSeen: Date;
  createdAt: Date;
  updatedAt: Date;
}

// User Zod Schema
export const UserSchema = z.object({
  _id: z.string(),
  username: z.string().min(3).max(30),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  avatarUrl: z.string().url().optional(),
  about: z.string().max(500).optional(),
  profileHandle: z.string().min(3).max(30).optional(),
  profileBio: z.string().max(160).optional(),
  profileWebsite: z.string().url().optional(),
  profileVisibility: z.enum(['private', 'public']).optional(),
  profileHandleChangedAt: z.date().optional(),
  profileUpdatedAt: z.date().optional(),
  role: z.string().max(120).optional(),
  department: z.string().max(120).optional(),
  contacts: z.array(z.string()),
  blocked: z.array(z.string()),
  lastSeen: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// User Registration DTO
export const RegisterDTOSchema = z.object({
  // Case-insensitive on input; normalized to lowercase for storage/uniqueness.
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_.]+$/, 'Username can only contain letters, numbers, underscores, and dots')
    .transform((value) => value.toLowerCase()),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  name: z.string().min(1).max(100),
});

export type RegisterDTO = z.infer<typeof RegisterDTOSchema>;

// User Login DTO
export const LoginDTOSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginDTO = z.infer<typeof LoginDTOSchema>;

// User Update DTO
export const UpdateUserDTOSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  // Empty string clears the avatar (matches the users-service route schema)
  avatarUrl: z.string().url().or(z.literal('')).optional(),
  about: z.string().max(500).optional(),
  role: z.string().max(120).optional(),
  department: z.string().max(120).optional(),
});

export type UpdateUserDTO = z.infer<typeof UpdateUserDTOSchema>;

// User Response DTO (without sensitive fields)
export interface UserResponseDTO {
  _id: string;
  username: string;
  email: string;
  name: string;
  avatarUrl?: string;
  about?: string;
  profileHandle?: string;
  profileBio?: string;
  profileWebsite?: string;
  profileVisibility?: 'private' | 'public';
  role?: string;
  department?: string;
  lastSeen: Date;
  createdAt: Date;
}
