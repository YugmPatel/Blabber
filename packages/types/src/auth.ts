import { z } from 'zod';

// JWT Payload Interface
export interface JWTPayload {
  userId: string;
  username: string;
  email: string;
  iat?: number;
  exp?: number;
}

// JWT Payload Zod Schema
export const JWTPayloadSchema = z.object({
  userId: z.string(),
  username: z.string(),
  email: z.string().email(),
  iat: z.number().optional(),
  exp: z.number().optional(),
});

// Device Session Interface
export interface DeviceSession {
  _id: string;
  userId: string;
  refreshTokenHash: string;
  userAgent: string;
  ipAddress: string;
  expiresAt: Date;
  createdAt: Date;
}

// Device Session Zod Schema
export const DeviceSessionSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  refreshTokenHash: z.string(),
  userAgent: z.string(),
  ipAddress: z.string(),
  expiresAt: z.date(),
  createdAt: z.date(),
});

// Auth Response DTO
export interface AuthResponseDTO {
  user: {
    _id: string;
    username: string;
    email: string;
    name: string;
    avatarUrl?: string;
  };
  accessToken: string;
}

// Password Reset Request DTO
export const PasswordResetRequestDTOSchema = z.object({
  email: z.string().email(),
});

export type PasswordResetRequestDTO = z.infer<typeof PasswordResetRequestDTOSchema>;

// Password Reset DTO
export const PasswordResetDTOSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(100),
});

export type PasswordResetDTO = z.infer<typeof PasswordResetDTOSchema>;
