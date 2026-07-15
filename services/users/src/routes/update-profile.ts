import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { updateUserProfile } from '../models/user';
import { logger } from '@repo/utils';

const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().trim().refine((value) => {
    if (value === '') return true;
    if (value.startsWith('/api/media/local/')) return true;
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Avatar URL is invalid.').optional(),
  about: z.string().max(500).optional().or(z.literal('')),
  role: z.string().max(120).optional().or(z.literal('')),
  department: z.string().max(120).optional().or(z.literal('')),
});

export async function updateProfile(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    // Validate request body
    const validation = updateProfileSchema.safeParse(req.body);

    if (!validation.success) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid input data',
        details: validation.error.errors,
      });
      return;
    }

    const updates = validation.data;

    // Remove empty strings and convert to undefined
    const cleanedUpdates: any = {};
    if (updates.name !== undefined) {
      cleanedUpdates.name = updates.name;
    }
    if (updates.avatarUrl !== undefined) {
      cleanedUpdates.avatarUrl = updates.avatarUrl === '' ? undefined : updates.avatarUrl;
    }
    if (updates.about !== undefined) {
      cleanedUpdates.about = updates.about === '' ? undefined : updates.about;
    }
    if (updates.role !== undefined) {
      cleanedUpdates.role = updates.role === '' ? undefined : updates.role;
    }
    if (updates.department !== undefined) {
      cleanedUpdates.department = updates.department === '' ? undefined : updates.department;
    }

    // Update user profile
    const updatedUser = await updateUserProfile(userId, cleanedUpdates);

    if (!updatedUser) {
      res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
      return;
    }

    // Return updated user without sensitive information
    res.status(200).json({
      user: {
        _id: updatedUser._id,
        username: updatedUser.username,
        name: updatedUser.name,
        avatarUrl: updatedUser.avatarUrl,
        avatarSource: updatedUser.avatarSource ?? (updatedUser.avatarUrl ? 'upload' : 'none'),
        about: updatedUser.about,
        role: updatedUser.role,
        department: updatedUser.department,
        lastSeen: updatedUser.lastSeen,
      },
    });
  } catch (error) {
    logger.error({ error, userId: (req as any).user?.userId }, 'Error updating profile');
    next(error);
  }
}
