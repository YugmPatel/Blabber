import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { ObjectId } from 'mongodb';
import { PasswordResetRequestDTOSchema } from '@repo/types';
import { asyncHandler, ValidationError } from '@repo/utils';
import { getUsersCollection } from '../models/user';
import { getPasswordResetTokensCollection } from '../models/password-reset-token';

export const passwordForgot = asyncHandler(async (req: Request, res: Response) => {
  // Validate request body
  const validation = PasswordResetRequestDTOSchema.safeParse(req.body);

  if (!validation.success) {
    throw new ValidationError('Invalid request data');
  }

  const { email } = validation.data;

  const usersCollection = getUsersCollection();

  // Find user by email
  const user = await usersCollection.findOne({ email });

  // Always return success to prevent email enumeration
  // Even if user doesn't exist, we return success
  if (!user) {
    return res.status(200).json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.',
    });
  }

  // Generate secure reset token (32 bytes = 64 hex characters)
  const resetToken = randomBytes(32).toString('hex');

  // Hash the token for storage
  const tokenHash = await bcrypt.hash(resetToken, 10);

  // Token expires in 1 hour
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  // Store reset token in database
  const passwordResetTokensCollection = getPasswordResetTokensCollection();

  // Invalidate any existing reset tokens for this user
  await passwordResetTokensCollection.deleteMany({ userId: user._id });

  // Create new reset token
  await passwordResetTokensCollection.insertOne({
    _id: new ObjectId(),
    userId: user._id,
    tokenHash,
    expiresAt,
    createdAt: new Date(),
    used: false,
  });

  // In a real application, you would send an email here with the reset token
  // For now, we'll just log it (in development) or return success
  // TODO: Integrate email service to send reset link
  // Example: await sendPasswordResetEmail(user.email, resetToken);

  res.status(200).json({
    success: true,
    message: 'If an account with that email exists, a password reset link has been sent.',
    // In development, include the token for testing purposes
    ...(process.env.NODE_ENV === 'development' && { resetToken }),
  });
});
