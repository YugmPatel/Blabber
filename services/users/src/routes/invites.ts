import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler, AppError } from '@repo/utils';
import { createUserInvite, findActiveInviteByToken, getUserInvitesCollection } from '../models/user-invite';
import { getUsersCollection } from '../models/user';
import { serializeProfileForViewer } from './profiles';

function appBaseUrl() {
  return (process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

export const createInvite = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId || !ObjectId.isValid(userId)) {
    res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
    return;
  }

  const invite = await createUserInvite(new ObjectId(userId));
  res.status(201).json({
    token: invite.token,
    url: `${appBaseUrl()}/invite/${invite.token}`,
    expiresAt: invite.expiresAt,
  });
});

// Resolving an invite still goes through the same profile visibility/block
// checks any other profile lookup does — an invite link is a way to find
// the inviter, not a way to bypass their privacy settings.
export const getInviteProfile = asyncHandler(async (req: Request, res: Response) => {
  const viewerUserId = (req as any).user?.userId;
  if (!viewerUserId || !ObjectId.isValid(viewerUserId)) {
    res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
    return;
  }

  const invite = await findActiveInviteByToken(req.params.token);
  if (!invite) throw new AppError(404, 'This invite link is unavailable.', 'INVITE_UNAVAILABLE');

  const inviter = await getUsersCollection().findOne({ _id: invite.inviterUserId });
  if (!inviter || inviter.deactivatedAt || inviter.deletedAt) {
    throw new AppError(404, 'This invite link is unavailable.', 'INVITE_UNAVAILABLE');
  }

  await getUserInvitesCollection().updateOne({ _id: invite._id }, { $inc: { useCount: 1 } });

  res.status(200).json(await serializeProfileForViewer(inviter, new ObjectId(viewerUserId)));
});
