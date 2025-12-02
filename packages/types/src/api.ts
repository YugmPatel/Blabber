import { z } from 'zod';

// Generic API Response
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    statusCode?: number;
  };
}

// Pagination Query Parameters
export const PaginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

// Paginated Response
export interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

// Search Query Parameters
export const SearchQuerySchema = z.object({
  q: z.string().min(1).max(100),
  limit: z.coerce.number().min(1).max(50).default(20),
});

export type SearchQuery = z.infer<typeof SearchQuerySchema>;

// Presence Response
export interface PresenceResponseDTO {
  online: boolean;
  lastSeen: Date;
}

// Block/Unblock DTO
export const BlockUserDTOSchema = z.object({
  userId: z.string(),
});

export type BlockUserDTO = z.infer<typeof BlockUserDTOSchema>;
