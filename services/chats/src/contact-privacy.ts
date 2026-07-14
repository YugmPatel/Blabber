import { ObjectId } from 'mongodb';
import { getDatabase } from './db';

/**
 * Contact-privacy enforcement for starting direct chats and adding people to
 * groups. Settings are written by the users service into the shared
 * `userSettings` collection; follower relationships live in
 * `profile_relationships`. Defaults to 'followers' when a user has never
 * saved settings (conservative P0 posture), matching the users service
 * defaults.
 */
export type ContactPrivacy = 'everyone' | 'followers' | 'contacts' | 'no_one';

const VALID_VALUES = new Set<ContactPrivacy>(['everyone', 'followers', 'contacts', 'no_one']);

function normalize(value: unknown, fallback: ContactPrivacy): ContactPrivacy {
  return VALID_VALUES.has(value as ContactPrivacy) ? (value as ContactPrivacy) : fallback;
}

export async function getContactPrivacy(
  userId: ObjectId
): Promise<{ messagePrivacy: ContactPrivacy; groupInvitePrivacy: ContactPrivacy }> {
  const settings = await getDatabase().collection('userSettings').findOne({ userId });
  return {
    // Conservative P0 default: unknown/unset messaging policy must never
    // resolve to 'everyone' — see services/users DEFAULT_USER_SETTINGS.
    messagePrivacy: normalize(settings?.messagePrivacy, 'followers'),
    groupInvitePrivacy: normalize(settings?.groupInvitePrivacy, 'everyone'),
  };
}

/** actor is an approved follower of target */
async function isFollowerOf(actorId: ObjectId, targetId: ObjectId): Promise<boolean> {
  const relationship = await getDatabase().collection('profile_relationships').findOne({
    followerUserId: actorId,
    targetUserId: targetId,
    state: 'following',
  });
  return Boolean(relationship);
}

/** actor and target already share a live direct chat */
export async function sharesDirectChat(actorId: ObjectId, targetId: ObjectId): Promise<boolean> {
  const chat = await getDatabase().collection('chats').findOne({
    type: 'direct',
    participants: { $all: [actorId, targetId] },
    deletedAt: { $exists: false },
    endedAt: { $exists: false },
  });
  return Boolean(chat);
}

async function isAllowedBy(policy: ContactPrivacy, actorId: ObjectId, targetId: ObjectId): Promise<boolean> {
  if (actorId.equals(targetId)) return true;
  if (policy === 'everyone') return true;
  if (policy === 'no_one') return false;
  if (policy === 'followers') return isFollowerOf(actorId, targetId);
  return sharesDirectChat(actorId, targetId); // 'contacts'
}

/** Whether actor may start a NEW direct chat with target. */
export async function canStartDirectChat(actorId: ObjectId, targetId: ObjectId): Promise<boolean> {
  const { messagePrivacy } = await getContactPrivacy(targetId);
  return isAllowedBy(messagePrivacy, actorId, targetId);
}

/** Whether actor may add target to a group. */
export async function canAddToGroup(actorId: ObjectId, targetId: ObjectId): Promise<boolean> {
  const { groupInvitePrivacy } = await getContactPrivacy(targetId);
  return isAllowedBy(groupInvitePrivacy, actorId, targetId);
}
