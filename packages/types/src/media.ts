import { z } from 'zod';

// Media TypeScript Interface
export interface Media {
  _id: string;
  userId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  s3Key: string;
  url: string;
  createdAt: Date;
}

// Media Zod Schema
export const MediaSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  fileName: z.string(),
  fileType: z.string(),
  fileSize: z.number().positive(),
  s3Key: z.string(),
  url: z.string().url(),
  createdAt: z.date(),
});

// Presign Request DTO
export const PresignRequestDTOSchema = z.object({
  fileName: z.string().min(1).max(255),
  fileType: z.string().min(1),
  fileSize: z.number().positive().max(50 * 1024 * 1024), // 50MB max
});

export type PresignRequestDTO = z.infer<typeof PresignRequestDTOSchema>;

// Presign Response DTO
export interface PresignResponseDTO {
  uploadUrl: string;
  mediaId: string;
  expiresIn: number;
}

// Link Preview DTO
export interface LinkPreviewDTO {
  title: string;
  description?: string;
  image?: string;
  url: string;
}
