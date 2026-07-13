import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler, logger, ValidationError } from '@repo/utils';
import {
  ContactPrivacy,
  EmailDiscoverability,
  DEFAULT_USER_SETTINGS,
  getOrCreateUserSettings,
  getUserSettingsCollection,
} from '../models/user-settings';
import { getUsersCollection } from '../models/user';

/**
 * Unified privacy surface requested for the discovery/New-Convo work. Maps
 * onto the pre-existing, already-enforced fields rather than replacing them:
 * messagePermission/groupAddPermission/searchVisibility are the real
 * messagePrivacy/groupInvitePrivacy/usernameFindability enums (kept at their
 * real granularity — collapsing them to fewer values would silently regress
 * settings the Discovery/Privacy pages already expose). callPermission is
 * derived from the existing incomingCallsEnabled boolean. emailDiscoverability
 * is newly added here, defaulting closed.
 */
const MESSAGE_PERMISSION_VALUES: ContactPrivacy[] = ['everyone', 'followers', 'no_one'];
const GROUP_ADD_PERMISSION_VALUES: ContactPrivacy[] = ['everyone', 'followers', 'contacts', 'no_one'];
const SEARCH_VISIBILITY_VALUES = ['everyone', 'followers', 'contacts', 'no_one'] as const;
const EMAIL_DISCOVERABILITY_VALUES: EmailDiscoverability[] = ['exact_match', 'nobody'];
const PROFILE_VISIBILITY_VALUES = ['public', 'private'] as const;
const CALL_PERMISSION_VALUES = ['everyone', 'no_one'] as const;

function requireUserId(req: Request) {
  const userId = (req as any).user?.userId;
  if (!userId || !ObjectId.isValid(userId)) return null;
  return new ObjectId(userId);
}

async function buildPrivacySnapshot(userId: ObjectId) {
  const [settings, user] = await Promise.all([
    getOrCreateUserSettings(userId),
    getUsersCollection().findOne({ _id: userId }, { projection: { profileVisibility: 1, usernameFindability: 1 } }),
  ]);

  return {
    profileVisibility: user?.profileVisibility || 'private',
    searchVisibility: (user as any)?.usernameFindability || 'everyone',
    emailDiscoverability: settings.emailDiscoverability ?? DEFAULT_USER_SETTINGS.emailDiscoverability,
    messagePermission: settings.messagePrivacy,
    groupAddPermission: settings.groupInvitePrivacy,
    callPermission: settings.incomingCallsEnabled ? 'everyone' : 'no_one',
    updatedAt: settings.updatedAt,
  };
}

export const getMyPrivacy = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
    return;
  }
  res.status(200).json({ privacy: await buildPrivacySnapshot(userId) });
});

export const updateMyPrivacy = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
    return;
  }

  const settingsPatch: Record<string, unknown> = {};
  const userPatch: Record<string, unknown> = {};

  if ('profileVisibility' in req.body) {
    if (!PROFILE_VISIBILITY_VALUES.includes(req.body.profileVisibility)) {
      throw new ValidationError('profileVisibility must be public or private');
    }
    userPatch.profileVisibility = req.body.profileVisibility;
  }

  if ('searchVisibility' in req.body) {
    if (!SEARCH_VISIBILITY_VALUES.includes(req.body.searchVisibility)) {
      throw new ValidationError('searchVisibility must be everyone, followers, contacts, or no_one');
    }
    userPatch.usernameFindability = req.body.searchVisibility;
  }

  if ('emailDiscoverability' in req.body) {
    if (!EMAIL_DISCOVERABILITY_VALUES.includes(req.body.emailDiscoverability)) {
      throw new ValidationError('emailDiscoverability must be exact_match or nobody');
    }
    settingsPatch.emailDiscoverability = req.body.emailDiscoverability;
  }

  if ('messagePermission' in req.body) {
    if (!MESSAGE_PERMISSION_VALUES.includes(req.body.messagePermission)) {
      throw new ValidationError('messagePermission must be everyone, followers, or no_one');
    }
    settingsPatch.messagePrivacy = req.body.messagePermission;
  }

  if ('groupAddPermission' in req.body) {
    if (!GROUP_ADD_PERMISSION_VALUES.includes(req.body.groupAddPermission)) {
      throw new ValidationError('groupAddPermission must be everyone, followers, contacts, or no_one');
    }
    settingsPatch.groupInvitePrivacy = req.body.groupAddPermission;
  }

  if ('callPermission' in req.body) {
    if (!CALL_PERMISSION_VALUES.includes(req.body.callPermission)) {
      throw new ValidationError('callPermission must be everyone or no_one');
    }
    settingsPatch.incomingCallsEnabled = req.body.callPermission === 'everyone';
  }

  if (Object.keys(settingsPatch).length === 0 && Object.keys(userPatch).length === 0) {
    throw new ValidationError('No valid privacy settings provided');
  }

  if (Object.keys(userPatch).length > 0) {
    await getUsersCollection().updateOne({ _id: userId }, { $set: { ...userPatch, updatedAt: new Date() } });
  }

  if (Object.keys(settingsPatch).length > 0) {
    await getOrCreateUserSettings(userId);
    await getUserSettingsCollection().updateOne(
      { userId },
      { $set: { ...settingsPatch, updatedAt: new Date() } }
    );
  }

  logger.info(
    { event: 'privacy_settings.updated', userId: userId.toString(), fields: [...Object.keys(userPatch), ...Object.keys(settingsPatch)] },
    'Privacy settings updated'
  );

  res.status(200).json({ privacy: await buildPrivacySnapshot(userId) });
});
