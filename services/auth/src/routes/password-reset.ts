import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { PasswordResetDTOSchema } from '@repo/types';
import { asyncHandler, ValidationError, UnauthorizedError } from '@repo/utils';
import { getUsersCollection } from '../models/user';
import { getPasswordResetTokensCollection } from '../models/password-reset-token';

export const passwordReset = asyncHandler(async (req: Request, res: Response) => {
  // Validate request body
  const validation = PasswordResetDTOSchema.safeParse(req.body);

  if (!validation.success) {
    throw new ValidationError('Invalid request data');
  }

  const { token, newPassword } = validation.data;

  const passwordResetTokensCollection = getPasswordResetTokensCollection();

  // Find all non-expired, unused reset tokens
  const resetTokens = await passwordResetTokensCollection
    .find({
      expiresAt: { $gt: new Date() },
      used: false,
    })
    .toArray();

  // Find matching token by comparing hashes
  let matchingToken = null;
  for (const tokenDoc of resetTokens) {
    const isMatch = await bcrypt.compare(token, tokenDoc.tokenHash);
    if (isMatch) {
      matchingToken = tokenDoc;
      break;
    }
  }

  if (!matchingToken) {
    throw new UnauthorizedError('Invalid or expired reset token');
  }

  // Mark token as used
  await passwordResetTokensCollection.updateOne(
    { _id: matchingToken._id },
    { $set: { used: true } }
  );

  // Hash new password
  const passwordHash = await bcrypt.hash(newPassword, 10);

  // Update user's password
  const usersCollection = getUsersCollection();
  await usersCollection.updateOne(
    { _id: matchingToken.userId },
    {
      $set: {
        passwordHash,
        updatedAt: new Date(),
      },
    }
  );

  res.status(200).json({
    success: true,
    message: 'Password has been reset successfully.',
  });
});
