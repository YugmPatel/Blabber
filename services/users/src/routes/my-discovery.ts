import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler } from '@repo/utils';
import { getUsersCollection } from '../models/user';
import { getUserInvitesCollection } from '../models/user-invite';
import { getOrCreateUserSettings, DEFAULT_USER_SETTINGS } from '../models/user-settings';

function appBaseUrl() {
  return (process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

/**
 * Basic "how can people find me" snapshot for the New Convo / discovery
 * surface: username, a shareable profile link (only when the user has set a
 * public-profile handle — there is no username-only public profile page in
 * the frontend yet), the most recent still-active invite link if one
 * exists, and the discoverability settings that govern all of it.
 */
export const getMyDiscoveryInfo = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId || !ObjectId.isValid(userId)) {
    res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
    return;
  }
  const userObjectId = new ObjectId(userId);

  const [user, settings, latestInvite] = await Promise.all([
    getUsersCollection().findOne(
      { _id: userObjectId },
      { projection: { username: 1, profileHandle: 1, profileVisibility: 1, usernameFindability: 1 } }
    ),
    getOrCreateUserSettings(userObjectId),
    getUserInvitesCollection().findOne(
      { inviterUserId: userObjectId, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
      { sort: { createdAt: -1 } }
    ),
  ]);

  if (!user) {
    res.status(404).json({ error: 'Not Found', message: 'User not found' });
    return;
  }

  const profileUrl = user.profileHandle ? `${appBaseUrl()}/p/${user.profileHandle}` : null;
  const inviteUrl = latestInvite ? `${appBaseUrl()}/invite/${latestInvite.token}` : null;

  res.status(200).json({
    username: user.username,
    profileUrl,
    inviteUrl,
    qrPayload: inviteUrl || profileUrl,
    discoverabilitySettings: {
      profileVisibility: user.profileVisibility || 'private',
      searchVisibility: (user as any).usernameFindability || 'everyone',
      emailDiscoverability: settings.emailDiscoverability ?? DEFAULT_USER_SETTINGS.emailDiscoverability,
    },
  });
});
