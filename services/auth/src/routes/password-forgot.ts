import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { ObjectId } from 'mongodb';
import { PasswordResetRequestDTOSchema } from '@repo/types';
import { asyncHandler, logger, ValidationError } from '@repo/utils';
import { getUsersCollection } from '../models/user';
import { getPasswordResetTokensCollection } from '../models/password-reset-token';
import { sendPasswordResetEmail } from '../utils/email';

const GENERIC_PASSWORD_RESET_MESSAGE =
  'If an account with that email exists, a password reset link has been sent.';

export const passwordForgot = asyncHandler(async (req: Request, res: Response) => {
  logger.info({ event: 'password_reset.request_received' }, 'Password reset request received');

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
    logger.info(
      { event: 'password_reset.account_not_matched' },
      'Password reset request did not match an account'
    );

    return res.status(200).json({
      success: true,
      message: GENERIC_PASSWORD_RESET_MESSAGE,
    });
  }

  logger.info(
    { event: 'password_reset.account_matched', userId: user._id.toString() },
    'Password reset request matched an account'
  );

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

  logger.info(
    { event: 'password_reset.token_created', userId: user._id.toString() },
    'Password reset token created'
  );

  logger.info(
    { event: 'password_reset.email_send_started', userId: user._id.toString() },
    'Password reset email send started'
  );

  const emailSent = await sendPasswordResetEmail(user.email, resetToken);
  if (emailSent) {
    logger.info(
      { event: 'password_reset.email_send_succeeded', userId: user._id.toString() },
      'Password reset email send succeeded'
    );
  }

  return res.status(200).json({
    success: true,
    message: GENERIC_PASSWORD_RESET_MESSAGE,
  });
});
