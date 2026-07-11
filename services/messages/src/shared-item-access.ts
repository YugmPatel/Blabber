import { ObjectId } from 'mongodb';
import { getDatabase } from './db';

export interface ResolvedSharedItem {
  text?: string;
  authorName?: string;
  thumbnailUrl?: string;
  createdAt: Date;
}

async function hasBlockBetween(a: ObjectId, b: ObjectId) {
  return Boolean(
    await getDatabase()
      .collection('user_blocks')
      .findOne({
        $or: [
          { blockerUserId: a, blockedUserId: b },
          { blockerUserId: b, blockedUserId: a },
        ],
      })
  );
}

function truncate(text: string | undefined, max: number) {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

/**
 * Re-validates a post is safe to share at send-time — the same public
 * visibility + public author profile rule the Feed's Share button already
 * gates on client-side. Returns null when the content can't be shared
 * (private, deleted, or the sharer is blocked with the author), so callers
 * never trust the client-supplied metadata for what gets stored/displayed.
 */
export async function resolveShareablePost(
  postId: ObjectId,
  sharerUserId: ObjectId
): Promise<ResolvedSharedItem | null> {
  const db = getDatabase();
  const post = await db.collection('posts').findOne({ _id: postId, deletedAt: { $exists: false } });
  if (!post || post.visibility !== 'public') return null;

  const author = await db.collection('users').findOne({ _id: post.authorUserId });
  if (!author || author.deletedAt || author.deactivatedAt || author.profileVisibility !== 'public') return null;
  if (await hasBlockBetween(sharerUserId, post.authorUserId)) return null;

  const mediaIds: ObjectId[] = Array.isArray(post.mediaIds) ? post.mediaIds : [];
  return {
    text: truncate(post.body, 200),
    authorName: author.name || author.username || undefined,
    thumbnailUrl: mediaIds.length > 0 ? `/api/posts/${postId.toString()}/media/${mediaIds[0].toString()}` : undefined,
    createdAt: post.createdAt,
  };
}

/** Same re-validation as resolveShareablePost, for Reels. */
export async function resolveShareableReel(
  reelId: ObjectId,
  sharerUserId: ObjectId
): Promise<ResolvedSharedItem | null> {
  const db = getDatabase();
  const reel = await db.collection('reels').findOne({
    _id: reelId,
    deletedAt: { $exists: false },
    moderationRemovedAt: { $exists: false },
  });
  if (!reel || reel.visibility !== 'public' || reel.publishState !== 'published' || reel.processingStatus !== 'ready') {
    return null;
  }

  const author = await db.collection('users').findOne({ _id: reel.authorUserId });
  if (!author || author.deletedAt || author.deactivatedAt || author.profileVisibility !== 'public') return null;
  if (await hasBlockBetween(sharerUserId, reel.authorUserId)) return null;

  return {
    text: truncate(reel.caption, 200),
    authorName: author.name || author.username || undefined,
    thumbnailUrl: reel.posterPath ? `/api/reels/${reelId.toString()}/poster` : undefined,
    createdAt: reel.createdAt,
  };
}
