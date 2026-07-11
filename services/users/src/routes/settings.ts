import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { asyncHandler, ValidationError } from '@repo/utils';
import {
  ContactPrivacy,
  DEFAULT_USER_SETTINGS,
  getOrCreateUserSettings,
  getUserSettingsCollection,
  ThemePreference,
} from '../models/user-settings';

// 'contacts' is intentionally not offered for messagePrivacy: a "contact" is
// someone you already share a direct chat with, so contacts-only messaging
// would be indistinguishable from no_one for new conversations.
const MESSAGE_PRIVACY_VALUES: ContactPrivacy[] = ['everyone', 'followers', 'no_one'];
const GROUP_INVITE_PRIVACY_VALUES: ContactPrivacy[] = ['everyone', 'followers', 'contacts', 'no_one'];

const booleanFields = [
  'readReceiptsEnabled',
  'presenceVisible',
  'lastSeenVisible',
  'incomingCallsEnabled',
  'chatIntelligenceEnabled',
  'momentArchiveEnabled',
] as const;

function serializeSettings(settings: any) {
  return {
    readReceiptsEnabled: settings.readReceiptsEnabled ?? DEFAULT_USER_SETTINGS.readReceiptsEnabled,
    presenceVisible: settings.presenceVisible ?? DEFAULT_USER_SETTINGS.presenceVisible,
    lastSeenVisible: settings.lastSeenVisible ?? DEFAULT_USER_SETTINGS.lastSeenVisible,
    incomingCallsEnabled: settings.incomingCallsEnabled ?? DEFAULT_USER_SETTINGS.incomingCallsEnabled,
    themePreference: settings.themePreference ?? DEFAULT_USER_SETTINGS.themePreference,
    chatIntelligenceEnabled:
      settings.chatIntelligenceEnabled ?? DEFAULT_USER_SETTINGS.chatIntelligenceEnabled,
    momentArchiveEnabled: settings.momentArchiveEnabled ?? DEFAULT_USER_SETTINGS.momentArchiveEnabled,
    messagePrivacy: settings.messagePrivacy ?? DEFAULT_USER_SETTINGS.messagePrivacy,
    groupInvitePrivacy: settings.groupInvitePrivacy ?? DEFAULT_USER_SETTINGS.groupInvitePrivacy,
    timezone: settings.timezone ?? DEFAULT_USER_SETTINGS.timezone,
    updatedAt: settings.updatedAt,
  };
}

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export const getMySettings = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
    return;
  }

  const settings = await getOrCreateUserSettings(new ObjectId(userId));
  res.status(200).json({ settings: serializeSettings(settings) });
});

export const updateMySettings = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
    return;
  }

  const patch: Record<string, boolean | ThemePreference | string> = {};
  for (const field of booleanFields) {
    if (field in req.body) {
      if (typeof req.body[field] !== 'boolean') {
        throw new ValidationError(`${field} must be a boolean`);
      }
      patch[field] = req.body[field];
    }
  }

  if ('themePreference' in req.body) {
    if (!['light', 'dark', 'system'].includes(req.body.themePreference)) {
      throw new ValidationError('themePreference must be light, dark, or system');
    }
    patch.themePreference = req.body.themePreference;
  }

  if ('timezone' in req.body) {
    if (typeof req.body.timezone !== 'string' || !isValidTimezone(req.body.timezone)) {
      throw new ValidationError('timezone must be a valid IANA timezone');
    }
    patch.timezone = req.body.timezone;
  }

  if ('messagePrivacy' in req.body) {
    if (!MESSAGE_PRIVACY_VALUES.includes(req.body.messagePrivacy)) {
      throw new ValidationError('messagePrivacy must be everyone, followers, or no_one');
    }
    patch.messagePrivacy = req.body.messagePrivacy;
  }

  if ('groupInvitePrivacy' in req.body) {
    if (!GROUP_INVITE_PRIVACY_VALUES.includes(req.body.groupInvitePrivacy)) {
      throw new ValidationError('groupInvitePrivacy must be everyone, followers, contacts, or no_one');
    }
    patch.groupInvitePrivacy = req.body.groupInvitePrivacy;
  }

  if (Object.keys(patch).length === 0) {
    throw new ValidationError('No valid settings provided');
  }

  const userObjectId = new ObjectId(userId);
  await getOrCreateUserSettings(userObjectId);
  const result = await getUserSettingsCollection().findOneAndUpdate(
    { userId: userObjectId },
    { $set: { ...patch, updatedAt: new Date() } },
    { returnDocument: 'after' }
  );

  res.status(200).json({ settings: serializeSettings(result ?? { ...DEFAULT_USER_SETTINGS, updatedAt: new Date() }) });
});

export const getPublicSettings = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    res.status(400).json({ error: 'Bad Request', message: 'Invalid user ID format' });
    return;
  }

  const settings = await getOrCreateUserSettings(new ObjectId(id));
  res.status(200).json({
    settings: {
      presenceVisible: settings.presenceVisible,
      lastSeenVisible: settings.lastSeenVisible,
      incomingCallsEnabled: settings.incomingCallsEnabled,
      chatIntelligenceEnabled: settings.chatIntelligenceEnabled,
    },
  });
});
