import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { searchUsersByText, getUsersCollection } from '../models/user';
import { listCounterpartBlockIds, hasBlockBetween } from '../models/user-block';
import { getDatabase } from '../db';
import { logger } from '@repo/utils';

const MIN_QUERY_LENGTH = 2;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 20;

function encodeCursor(id: ObjectId) {
  return Buffer.from(id.toString()).toString('base64url');
}

function decodeCursor(cursor: unknown): ObjectId | null {
  if (!cursor || typeof cursor !== 'string') return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    return ObjectId.isValid(raw) ? new ObjectId(raw) : null;
  } catch {
    return null;
  }
}

function bioPreview(about?: string) {
  if (!about) return undefined;
  const trimmed = about.trim();
  if (!trimmed) return undefined;
  return trimmed.length > 140 ? `${trimmed.slice(0, 140).trimEnd()}...` : trimmed;
}

/**
 * Whether `viewer` can start a direct conversation with `candidate` right
 * now, and if not, whether a message request is the right next step. Mirrors
 * the enforcement in services/chats/src/contact-privacy.ts and
 * routes/message-requests.ts — kept in sync manually since the two services
 * do not share a code module, only the underlying collections.
 *
 * relationshipStatus is restricted to exactly five values: 'none',
 * 'pending_sent', 'pending_received', 'accepted', 'blocked'. The frontend
 * must never infer a security decision from this label alone — canMessage
 * and requiresMessageRequest are the authority.
 */
async function messagingState(viewerId: ObjectId, candidateId: ObjectId) {
  const db = getDatabase();

  // Block wins over everything else, including an existing chat record.
  if (await hasBlockBetween(viewerId, candidateId)) {
    return { relationshipStatus: 'blocked' as const, canMessage: false, requiresMessageRequest: false };
  }

  const sharedChat = await db.collection('chats').findOne({
    type: 'direct',
    participants: { $all: [viewerId, candidateId] },
    deletedAt: { $exists: false },
    endedAt: { $exists: false },
  });
  if (sharedChat) return { relationshipStatus: 'accepted' as const, canMessage: true, requiresMessageRequest: false };

  const settings = await db.collection('userSettings').findOne({ userId: candidateId });
  // Conservative P0 default: unset/unknown policy must never resolve to
  // 'everyone' — see services/users DEFAULT_USER_SETTINGS.
  const messagePrivacy = settings?.messagePrivacy || 'followers';

  if (messagePrivacy === 'everyone') {
    return { relationshipStatus: 'none' as const, canMessage: true, requiresMessageRequest: false };
  }

  if (messagePrivacy === 'followers') {
    const isFollower = await db.collection('profile_relationships').findOne({
      followerUserId: viewerId,
      targetUserId: candidateId,
      state: 'following',
    });
    // Being an approved follower unlocks messaging directly, but the label
    // stays 'none' (no pending/accepted relationship exists) — canMessage is
    // what actually authorizes the action.
    if (isFollower) return { relationshipStatus: 'none' as const, canMessage: true, requiresMessageRequest: false };
  }

  // messagePrivacy === 'no_one' never allows a request; 'followers' (for a
  // non-follower) routes through a message request instead of a hard block.
  if (messagePrivacy === 'no_one') {
    return { relationshipStatus: 'none' as const, canMessage: false, requiresMessageRequest: false };
  }

  const pendingSent = await db.collection('message_requests').findOne({
    senderId: viewerId,
    recipientId: candidateId,
    status: 'pending',
  });
  if (pendingSent) {
    return { relationshipStatus: 'pending_sent' as const, canMessage: false, requiresMessageRequest: false };
  }

  const pendingReceived = await db.collection('message_requests').findOne({
    senderId: candidateId,
    recipientId: viewerId,
    status: 'pending',
  });
  if (pendingReceived) {
    return { relationshipStatus: 'pending_received' as const, canMessage: false, requiresMessageRequest: false };
  }

  return { relationshipStatus: 'none' as const, canMessage: false, requiresMessageRequest: true };
}

export async function searchUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const currentUserId = (req as any).user?.userId;
    if (!currentUserId || !ObjectId.isValid(currentUserId)) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }
    const requesterId = new ObjectId(currentUserId);

    const { q, limit: limitParam, cursor: cursorParam } = req.query;

    if (!q || typeof q !== 'string' || q.trim().length < MIN_QUERY_LENGTH) {
      logger.info(
        { event: 'user_search.rejected_short_query', userId: currentUserId },
        'User search rejected: query too short'
      );
      res.status(400).json({
        error: 'Validation Error',
        message: `Search query must be at least ${MIN_QUERY_LENGTH} characters.`,
      });
      return;
    }

    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(limitParam) || DEFAULT_LIMIT));
    const cursor = decodeCursor(cursorParam);

    const currentUser = await getUsersCollection().findOne(
      { _id: requesterId },
      { projection: { blocked: 1 } }
    );
    // Unconditional, bidirectional: blocking is a safety floor, not a
    // togglable discovery preference (unlike discoveryHideBlocked, which
    // only governs the separate Discover-feed surface).
    const excludedIds = await listCounterpartBlockIds(requesterId);
    const excludeSet = new Set<string>([
      requesterId.toString(),
      ...excludedIds.map((id) => id.toString()),
      ...(currentUser?.blocked || []).map((id: ObjectId) => id.toString()),
    ]);

    const candidates = await searchUsersByText(
      q.trim(),
      Array.from(excludeSet).map((id) => new ObjectId(id)),
      { limit: limit + 1, after: cursor }
    );

    const filtered = [];
    for (const candidate of candidates) {
      const findability = (candidate as any).usernameFindability || 'everyone';
      if (findability === 'everyone') {
        filtered.push(candidate);
        continue;
      }
      if (findability === 'no_one') continue;
      if (findability === 'followers') {
        const relationship = await getDatabase().collection('profile_relationships').findOne({
          followerUserId: requesterId,
          targetUserId: candidate._id,
          state: 'following',
        });
        if (relationship) filtered.push(candidate);
        continue;
      }
      if (findability === 'contacts') {
        const sharedChat = await getDatabase().collection('chats').findOne({
          type: 'direct',
          participants: { $all: [requesterId, candidate._id] },
          deletedAt: { $exists: false },
          endedAt: { $exists: false },
        });
        if (sharedChat) filtered.push(candidate);
      }
    }

    const hasMore = filtered.length > limit;
    const page = filtered.slice(0, limit);

    const results = await Promise.all(
      page.map(async (user) => {
        const state = await messagingState(requesterId, user._id);
        return {
          id: user._id.toString(),
          username: user.username,
          displayName: user.name,
          avatarUrl: user.avatarUrl || undefined,
          bioPreview: bioPreview(user.about),
          isVerified: Boolean((user as any).emailVerified),
          profileHandle: (user as any).profileHandle || undefined,
          displayHandle: (user as any).profileHandle ? `@${(user as any).profileHandle}` : null,
          ...state,
        };
      })
    );

    logger.info(
      { event: 'user_search.completed', userId: currentUserId, resultCount: results.length },
      'User search completed'
    );

    res.status(200).json({
      users: results,
      nextCursor: hasMore && page.length > 0 ? encodeCursor(page[page.length - 1]._id) : null,
    });
  } catch (error) {
    logger.error({ error }, 'Error searching users');
    next(error);
  }
}
