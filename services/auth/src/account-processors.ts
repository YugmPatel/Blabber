import { promises as fs } from 'fs';
import { ObjectId } from 'mongodb';
import { join, resolve, sep } from 'path';
import { logger } from '@repo/utils';
import { getDatabase } from './db';
import {
  getAccountDeletionAuditsCollection,
  getAccountDeletionsCollection,
  getDataExportsCollection,
  hashToken,
  hashUserId,
  randomToken,
} from './models/account-security';
import { getUsersCollection } from './models/user';
import { buildZip } from './utils/zip';
import { sendExportReadyEmail } from './utils/account-email';

const PROCESSOR_INTERVAL_MS = Number(process.env.ACCOUNT_PROCESSOR_INTERVAL_MS || 15 * 60 * 1000);
const LOCAL_MEDIA_DIR = process.env.LOCAL_MEDIA_DIR || '/data/blabber-media';

function iso(value?: Date) {
  return value ? value.toISOString() : undefined;
}

function oid(value: any) {
  return value instanceof ObjectId ? value.toString() : value;
}

function safeLocalMediaPath(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const root = resolve(LOCAL_MEDIA_DIR);
  const target = resolve(value);
  return target === root || target.startsWith(`${root}${sep}`) ? target : null;
}

async function cleanupReelLocalFiles(reels: any[], mediaDocs: any[]) {
  const paths = new Set<string>();
  for (const media of mediaDocs) {
    const path = safeLocalMediaPath(media.localPath);
    if (path) paths.add(path);
  }
  for (const reel of reels) {
    for (const value of [reel.fallbackPath, reel.posterPath, reel.hlsPlaylistPath]) {
      const path = safeLocalMediaPath(value);
      if (path) paths.add(path);
    }
    for (const segment of reel.hlsSegments || []) {
      const path = safeLocalMediaPath(segment?.path);
      if (path) paths.add(path);
    }
    const outputDir = safeLocalMediaPath(join(LOCAL_MEDIA_DIR, 'reels', reel._id.toString()));
    if (outputDir) paths.add(outputDir);
  }

  let removed = 0;
  for (const path of paths) {
    await fs.rm(path, { recursive: true, force: true }).then(() => { removed += 1; }).catch(() => undefined);
  }
  return removed;
}

async function buildExportFiles(userId: ObjectId) {
  const db = getDatabase();
  const user = await db.collection('users').findOne({ _id: userId });
  if (!user) throw new Error('user_not_found');

  const [
    settings,
    sessions,
    messages,
    reactions,
    momentReactions,
    authoredPosts,
    myPostComments,
    myPostReactions,
    saves,
    archiveState,
    actions,
    notificationPreferences,
    blocks,
    reports,
    following,
    incomingFollowRequests,
    ownedCommunities,
    communityMemberships,
    authoredCommunityPosts,
    myCommunityComments,
    myCommunityReactions,
    discoveryPreferences,
    discoveryFeedback,
    discoverySignals,
    discoveryAffinities,
    authoredReels,
    myReelComments,
    myReelReactions,
    savedReels,
    myReelSignals,
    myReelAffinities,
  ] = await Promise.all([
    db.collection('userSettings').findOne({ userId }),
    db.collection('deviceSessions').find({ userId }).project({ refreshTokenHash: 0, ipAddress: 0 }).toArray(),
    db.collection('messages').find({ senderId: userId }).project({ body: 1, type: 1, chatId: 1, createdAt: 1, editedAt: 1 }).toArray(),
    db.collection('messages').find({ 'reactions.userId': userId }).project({ chatId: 1, reactions: 1, createdAt: 1 }).toArray(),
    db.collection('moment_reactions').find({ viewerUserId: userId }).project({ momentId: 1, authorUserId: 1, emoji: 1, createdAt: 1, updatedAt: 1 }).toArray(),
    db.collection('posts').find({ authorUserId: userId }).project({ body: 1, visibility: 1, discoverable: 1, discoveryTopicIds: 1, mediaIds: 1, commentCount: 1, reactionCounts: 1, createdAt: 1, updatedAt: 1, editedAt: 1, deletedAt: 1 }).toArray(),
    db.collection('post_comments').find({ authorUserId: userId }).project({ postId: 1, postAuthorUserId: 1, body: 1, createdAt: 1, deletedAt: 1 }).toArray(),
    db.collection('post_reactions').find({ reactingUserId: userId }).project({ postId: 1, authorUserId: 1, emoji: 1, createdAt: 1, updatedAt: 1 }).toArray(),
    db.collection('savedMessages').find({ userId }).toArray(),
    db.collection('userChatPreferences').find({ userId }).toArray(),
    db.collection('chat_actions').find({
      deletedAt: { $exists: false },
      $or: [
        { visibility: 'personal', personalOwnerUserId: userId },
        { 'assignedTo.userId': userId.toString() },
        { 'createdBy.userId': userId.toString() },
      ],
    }).toArray(),
    db.collection('notificationPreferences').findOne({ userId }),
    db.collection('user_blocks').find({ blockerUserId: userId }).toArray(),
    db.collection('reports').find({ reporterUserId: userId }).project({
      targetType: 1,
      reason: 1,
      status: 1,
      createdAt: 1,
      updatedAt: 1,
    }).toArray(),
    db.collection('profile_relationships').find({ followerUserId: userId }).project({
      targetUserId: 1,
      state: 1,
      createdAt: 1,
      updatedAt: 1,
      approvedAt: 1,
    }).toArray(),
    db.collection('profile_relationships').find({ targetUserId: userId, state: 'requested' }).project({
      followerUserId: 1,
      createdAt: 1,
    }).toArray(),
    db.collection('communities').find({ ownerUserId: userId, deletedAt: { $exists: false } }).project({
      name: 1,
      handle: 1,
      description: 1,
      membershipMode: 1,
      communityDiscoverable: 1,
      communityTopicIds: 1,
      postingPolicy: 1,
      memberCount: 1,
      createdAt: 1,
      updatedAt: 1,
    }).toArray(),
    db.collection('community_memberships').find({ userId }).project({
      communityId: 1,
      role: 1,
      postingRestricted: 1,
      joinedAt: 1,
    }).toArray(),
    db.collection('community_posts').find({ authorUserId: userId }).project({
      communityId: 1,
      body: 1,
      mediaIds: 1,
      commentCount: 1,
      reactionCounts: 1,
      createdAt: 1,
      updatedAt: 1,
      editedAt: 1,
      deletedAt: 1,
    }).toArray(),
    db.collection('community_post_comments').find({ authorUserId: userId }).project({
      communityId: 1,
      communityPostId: 1,
      body: 1,
      createdAt: 1,
      deletedAt: 1,
    }).toArray(),
    db.collection('community_post_reactions').find({ reactingUserId: userId }).project({
      communityId: 1,
      communityPostId: 1,
      postAuthorUserId: 1,
      emoji: 1,
      createdAt: 1,
      updatedAt: 1,
    }).toArray(),
    db.collection('discovery_preferences').findOne({ userId }),
    db.collection('discovery_feedback').find({ userId }).project({
      targetType: 1,
      targetId: 1,
      feedbackType: 1,
      createdAt: 1,
      updatedAt: 1,
    }).toArray(),
    db.collection('discovery_events').find({ userId }).project({
      eventType: 1,
      sourceContext: 1,
      topicIds: 1,
      dwellBucket: 1,
      createdAt: 1,
    }).toArray(),
    db.collection('discovery_affinities').find({ userId }).project({
      surface: 1,
      affinityType: 1,
      score: 1,
      lastSignalAt: 1,
      updatedAt: 1,
    }).toArray(),
    db.collection('reels').find({ authorUserId: userId }).project({
      caption: 1,
      visibility: 1,
      topicIds: 1,
      reelDiscoverable: 1,
      reelTopicIds: 1,
      processingStatus: 1,
      publishState: 1,
      durationSeconds: 1,
      width: 1,
      height: 1,
      publishedAt: 1,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: 1,
    }).toArray(),
    db.collection('reel_comments').find({ authorUserId: userId }).project({ reelId: 1, reelAuthorUserId: 1, body: 1, createdAt: 1, deletedAt: 1 }).toArray(),
    db.collection('reel_reactions').find({ reactingUserId: userId }).project({ reelId: 1, authorUserId: 1, emoji: 1, createdAt: 1, updatedAt: 1 }).toArray(),
    db.collection('reel_saves').find({ userId }).project({ reelId: 1, createdAt: 1 }).toArray(),
    db.collection('discovery_events').find({ userId, targetType: 'reel' }).project({ eventType: 1, sourceContext: 1, topicIds: 1, dwellBucket: 1, createdAt: 1 }).toArray(),
    db.collection('discovery_affinities').find({ userId, surface: 'reels' }).project({ affinityType: 1, lastSignalAt: 1, updatedAt: 1 }).toArray(),
  ]);

  const followTargetIds = following.map((item: any) => item.targetUserId).filter(Boolean);
  const requestUserIds = incomingFollowRequests.map((item: any) => item.followerUserId).filter(Boolean);
  const visibleProfileUsers = await db.collection('users')
    .find({ _id: { $in: [...followTargetIds, ...requestUserIds] }, deactivatedAt: { $exists: false }, deletedAt: { $exists: false } })
    .project({ profileHandle: 1, name: 1 })
    .toArray();
  const visibleProfileUserById = new Map(visibleProfileUsers.map((item: any) => [item._id.toString(), item]));
  const feedbackCreatorIds = discoveryFeedback
    .filter((item: any) => item.targetType === 'creator' && item.targetId instanceof ObjectId)
    .map((item: any) => item.targetId);
  const feedbackCommunityIds = discoveryFeedback
    .filter((item: any) => item.targetType === 'community' && item.targetId instanceof ObjectId)
    .map((item: any) => item.targetId);
  const [feedbackCreators, feedbackCommunities] = await Promise.all([
    feedbackCreatorIds.length
      ? db.collection('users').find({ _id: { $in: feedbackCreatorIds }, deactivatedAt: { $exists: false }, deletedAt: { $exists: false } }).project({ profileHandle: 1 }).toArray()
      : [],
    feedbackCommunityIds.length
      ? db.collection('communities').find({ _id: { $in: feedbackCommunityIds }, deletedAt: { $exists: false } }).project({ handle: 1 }).toArray()
      : [],
  ]);
  const feedbackCreatorById = new Map(feedbackCreators.map((item: any) => [item._id.toString(), item]));
  const feedbackCommunityById = new Map(feedbackCommunities.map((item: any) => [item._id.toString(), item]));

  const safeActions = actions.map((action: any) => ({
    id: oid(action._id),
    chatId: oid(action.chatId),
    title: action.title,
    description: action.description,
    status: action.status,
    visibility: action.visibility,
    assignedTo: action.assignedTo,
    createdBy: action.createdBy,
    dueAt: iso(action.dueAt),
    createdAt: iso(action.createdAt),
    updatedAt: iso(action.updatedAt),
  }));

  const files = [
    {
      name: 'profile.json',
      content: {
        displayName: user.name,
        handle: user.profileHandle || null,
        bio: user.profileBio || '',
        website: user.profileWebsite || null,
        visibility: user.profileVisibility || 'private',
        profileUpdatedAt: iso(user.profileUpdatedAt || user.updatedAt),
        handleChangedAt: iso(user.profileHandleChangedAt),
      },
    },
    {
      name: 'following.json',
      content: following.map((item: any) => {
        const target = visibleProfileUserById.get(item.targetUserId?.toString?.() || String(item.targetUserId));
        return {
          state: item.state,
          targetHandle: target?.profileHandle || null,
          followedAt: iso(item.approvedAt || item.createdAt),
          requestedAt: item.state === 'requested' ? iso(item.createdAt) : undefined,
        };
      }),
    },
    {
      name: 'incoming-follow-requests.json',
      content: incomingFollowRequests.flatMap((item: any) => {
        const requester = visibleProfileUserById.get(item.followerUserId?.toString?.() || String(item.followerUserId));
        return requester
          ? [{
              requesterHandle: requester.profileHandle || null,
              requesterDisplayName: requester.name,
              requestedAt: iso(item.createdAt),
            }]
          : [];
      }),
    },
    { name: 'settings.json', content: settings || {} },
    {
      name: 'account-security.json',
      content: {
        sessions: sessions.map((session: any) => ({
          id: oid(session._id),
          createdAt: iso(session.createdAt),
          lastActiveAt: iso(session.lastActiveAt),
          expiresAt: iso(session.expiresAt),
          revokedAt: iso(session.revokedAt),
        })),
      },
    },
    {
      name: 'messages-authored-by-me.json',
      content: messages.map((message: any) => ({
        id: oid(message._id),
        chatId: oid(message.chatId),
        type: message.type || 'text',
        body: message.body,
        createdAt: iso(message.createdAt),
        editedAt: iso(message.editedAt),
      })),
    },
    {
      name: 'my-reactions.json',
      content: reactions.flatMap((message: any) =>
        (message.reactions || [])
          .filter((reaction: any) => reaction.userId?.toString() === userId.toString())
          .map((reaction: any) => ({
            messageId: oid(message._id),
            chatId: oid(message.chatId),
            emoji: reaction.emoji,
            createdAt: iso(reaction.createdAt),
          }))
      ),
    },
    {
      name: 'my-saved-message-references.json',
      content: saves.map((save: any) => ({
        chatId: oid(save.chatId),
        messageId: oid(save.messageId),
        savedAt: iso(save.savedAt),
      })),
    },
    {
      name: 'my-moment-reactions.json',
      content: momentReactions.map((reaction: any) => ({
        momentId: oid(reaction.momentId),
        authorUserId: oid(reaction.authorUserId),
        emoji: reaction.emoji,
        createdAt: iso(reaction.createdAt),
        updatedAt: iso(reaction.updatedAt),
      })),
    },
    {
      name: 'posts-authored-by-me.json',
      content: authoredPosts.map((post: any) => ({
        id: oid(post._id),
        body: post.body || '',
        visibility: post.visibility,
        discoverable: Boolean(post.discoverable),
        discoveryTopicIds: Array.isArray(post.discoveryTopicIds) ? post.discoveryTopicIds : [],
        mediaCount: Array.isArray(post.mediaIds) ? post.mediaIds.length : 0,
        commentCount: post.commentCount || 0,
        reactionCounts: post.reactionCounts || {},
        createdAt: iso(post.createdAt),
        updatedAt: iso(post.updatedAt),
        editedAt: iso(post.editedAt),
        deletedAt: iso(post.deletedAt),
      })),
    },
    {
      name: 'my-post-comments.json',
      content: myPostComments.map((comment: any) => ({
        id: oid(comment._id),
        postId: oid(comment.postId),
        postAuthorUserId: oid(comment.postAuthorUserId),
        body: comment.body || '',
        createdAt: iso(comment.createdAt),
        deletedAt: iso(comment.deletedAt),
      })),
    },
    {
      name: 'my-post-reactions.json',
      content: myPostReactions.map((reaction: any) => ({
        postId: oid(reaction.postId),
        authorUserId: oid(reaction.authorUserId),
        emoji: reaction.emoji,
        createdAt: iso(reaction.createdAt),
        updatedAt: iso(reaction.updatedAt),
      })),
    },
    {
      name: 'communities-owned-by-me.json',
      content: ownedCommunities.map((community: any) => ({
        id: oid(community._id),
        name: community.name,
        handle: community.handle,
        description: community.description || '',
        membershipMode: community.membershipMode,
        communityDiscoverable: Boolean(community.communityDiscoverable),
        communityTopicIds: Array.isArray(community.communityTopicIds) ? community.communityTopicIds : [],
        postingPolicy: community.postingPolicy,
        memberCount: community.memberCount || 0,
        createdAt: iso(community.createdAt),
        updatedAt: iso(community.updatedAt),
      })),
    },
    {
      name: 'my-community-memberships.json',
      content: communityMemberships.map((membership: any) => ({
        communityId: oid(membership.communityId),
        role: membership.role,
        postingRestricted: Boolean(membership.postingRestricted),
        joinedAt: iso(membership.joinedAt),
      })),
    },
    {
      name: 'community-posts-authored-by-me.json',
      content: authoredCommunityPosts.map((post: any) => ({
        id: oid(post._id),
        communityId: oid(post.communityId),
        body: post.body || '',
        mediaCount: Array.isArray(post.mediaIds) ? post.mediaIds.length : 0,
        commentCount: post.commentCount || 0,
        reactionCounts: post.reactionCounts || {},
        createdAt: iso(post.createdAt),
        updatedAt: iso(post.updatedAt),
        editedAt: iso(post.editedAt),
        deletedAt: iso(post.deletedAt),
      })),
    },
    {
      name: 'my-community-comments.json',
      content: myCommunityComments.map((comment: any) => ({
        id: oid(comment._id),
        communityId: oid(comment.communityId),
        communityPostId: oid(comment.communityPostId),
        body: comment.body || '',
        createdAt: iso(comment.createdAt),
        deletedAt: iso(comment.deletedAt),
      })),
    },
    {
      name: 'my-community-reactions.json',
      content: myCommunityReactions.map((reaction: any) => ({
        communityId: oid(reaction.communityId),
        communityPostId: oid(reaction.communityPostId),
        postAuthorUserId: oid(reaction.postAuthorUserId),
        emoji: reaction.emoji,
        createdAt: iso(reaction.createdAt),
        updatedAt: iso(reaction.updatedAt),
      })),
    },
    {
      name: 'discovery-preferences.json',
      content: {
        personalizedDiscoveryEnabled: discoveryPreferences?.personalizedDiscoveryEnabled !== false,
        followedTopics: discoveryPreferences?.followedTopicIds || [],
        mutedTopics: discoveryPreferences?.mutedTopicIds || [],
        updatedAt: iso(discoveryPreferences?.updatedAt),
      },
    },
    {
      name: 'my-discovery-feedback.json',
      content: discoveryFeedback.flatMap((item: any) => {
        if (item.targetType === 'creator') {
          const creator = feedbackCreatorById.get(item.targetId?.toString?.() || String(item.targetId));
          return creator?.profileHandle ? [{ targetType: 'creator', feedbackType: item.feedbackType, handle: creator.profileHandle, createdAt: iso(item.createdAt), updatedAt: iso(item.updatedAt) }] : [];
        }
        if (item.targetType === 'community') {
          const community = feedbackCommunityById.get(item.targetId?.toString?.() || String(item.targetId));
          return community?.handle ? [{ targetType: 'community', feedbackType: item.feedbackType, handle: community.handle, createdAt: iso(item.createdAt), updatedAt: iso(item.updatedAt) }] : [];
        }
        if (item.targetType === 'topic') {
          return [{ targetType: 'topic', feedbackType: item.feedbackType, topicId: item.targetId, createdAt: iso(item.createdAt), updatedAt: iso(item.updatedAt) }];
        }
        return [{ targetType: 'post', feedbackType: item.feedbackType, createdAt: iso(item.createdAt), updatedAt: iso(item.updatedAt) }];
      }),
    },
    {
      name: 'my-discovery-signals.json',
      content: discoverySignals.map((event: any) => ({
        eventType: event.eventType,
        sourceContext: event.sourceContext,
        topicIds: Array.isArray(event.topicIds) ? event.topicIds : [],
        dwellBucket: event.dwellBucket || null,
        createdAt: iso(event.createdAt),
      })),
    },
    {
      name: 'my-for-you-recommendation-state.json',
      content: discoveryAffinities.filter((item: any) => !item.surface || item.surface === 'posts').map((item: any) => ({
        affinityType: item.affinityType,
        score: item.score,
        lastSignalAt: iso(item.lastSignalAt),
        updatedAt: iso(item.updatedAt),
      })),
    },
    {
      name: 'reels-authored-by-me.json',
      content: authoredReels.map((reel: any) => ({
        caption: reel.caption || '',
        visibility: reel.visibility,
        topicIds: Array.isArray(reel.topicIds) ? reel.topicIds : [],
        reelDiscoverable: Boolean(reel.reelDiscoverable),
        reelTopicIds: Array.isArray(reel.reelTopicIds) ? reel.reelTopicIds : [],
        processingStatus: reel.processingStatus,
        publishState: reel.publishState,
        durationSeconds: reel.durationSeconds || null,
        dimensions: reel.width && reel.height ? { width: reel.width, height: reel.height } : null,
        publishedAt: iso(reel.publishedAt),
        createdAt: iso(reel.createdAt),
        updatedAt: iso(reel.updatedAt),
        deletedAt: iso(reel.deletedAt),
      })),
    },
    {
      name: 'reel-comments-authored-by-me.json',
      content: myReelComments.map((comment: any) => ({
        reelId: oid(comment.reelId),
        reelAuthorUserId: oid(comment.reelAuthorUserId),
        body: comment.body || '',
        createdAt: iso(comment.createdAt),
        deletedAt: iso(comment.deletedAt),
      })),
    },
    {
      name: 'my-reel-reactions.json',
      content: myReelReactions.map((reaction: any) => ({
        reelId: oid(reaction.reelId),
        authorUserId: oid(reaction.authorUserId),
        emoji: reaction.emoji,
        createdAt: iso(reaction.createdAt),
        updatedAt: iso(reaction.updatedAt),
      })),
    },
    {
      name: 'saved-reels.json',
      content: savedReels.map((save: any) => ({
        reelId: oid(save.reelId),
        savedAt: iso(save.createdAt),
      })),
    },
    {
      name: 'my-reel-watch-signals.json',
      content: myReelSignals.map((event: any) => ({
        eventType: event.eventType,
        sourceContext: event.sourceContext,
        topicIds: Array.isArray(event.topicIds) ? event.topicIds : [],
        bucket: event.dwellBucket || null,
        createdAt: iso(event.createdAt),
      })),
    },
    {
      name: 'my-reel-personalization-data.json',
      content: {
        signals: myReelSignals.map((event: any) => ({
          eventType: event.eventType,
          sourceContext: event.sourceContext,
          topicIds: Array.isArray(event.topicIds) ? event.topicIds : [],
          bucket: event.dwellBucket || null,
          createdAt: iso(event.createdAt),
        })),
        affinities: myReelAffinities.map((item: any) => ({
          affinityType: item.affinityType,
          lastSignalAt: iso(item.lastSignalAt),
          updatedAt: iso(item.updatedAt),
        })),
      },
    },
    {
      name: 'my-chat-archive-state.json',
      content: archiveState.map((preference: any) => ({
        chatId: oid(preference.chatId),
        pinned: Boolean(preference.pinned),
        archived: Boolean(preference.archived),
        archivedAt: iso(preference.archivedAt),
      })),
    },
    { name: 'my-actions.json', content: safeActions },
    {
      name: 'my-blocked-users.json',
      content: blocks.map((block: any) => ({
        blockedUserId: oid(block.blockedUserId),
        blockedAt: iso(block.createdAt),
      })),
    },
    {
      name: 'my-report-history.json',
      content: reports.map((report: any) => ({
        id: oid(report._id),
        targetType: report.targetType,
        reason: report.reason,
        status: report.status,
        createdAt: iso(report.createdAt),
        updatedAt: iso(report.updatedAt),
      })),
    },
    { name: 'notification-preferences.json', content: notificationPreferences || {} },
    {
      name: 'export-manifest.json',
      content: {
        generatedAt: new Date().toISOString(),
        expiresAfterHours: 24,
        files: [
          'profile.json',
          'following.json',
          'incoming-follow-requests.json',
          'settings.json',
          'account-security.json',
          'messages-authored-by-me.json',
          'my-reactions.json',
          'my-moment-reactions.json',
          'posts-authored-by-me.json',
          'my-post-comments.json',
          'my-post-reactions.json',
          'communities-owned-by-me.json',
          'my-community-memberships.json',
          'community-posts-authored-by-me.json',
          'my-community-comments.json',
          'my-community-reactions.json',
          'discovery-preferences.json',
          'my-discovery-feedback.json',
          'my-discovery-signals.json',
          'my-for-you-recommendation-state.json',
          'reels-authored-by-me.json',
          'reel-comments-authored-by-me.json',
          'my-reel-reactions.json',
          'saved-reels.json',
          'my-reel-watch-signals.json',
          'my-reel-personalization-data.json',
          'my-saved-message-references.json',
          'my-chat-archive-state.json',
          'my-actions.json',
          'my-blocked-users.json',
          'my-report-history.json',
          'notification-preferences.json',
        ],
      },
    },
  ];
  return files;
}

export class DataExportProcessor {
  async runOnce() {
    const jobs = await getDataExportsCollection()
      .find({ status: 'preparing', expiresAt: { $gt: new Date() } })
      .limit(10)
      .toArray();
    let ready = 0;
    let failed = 0;
    for (const job of jobs) {
      try {
        const user = await getUsersCollection().findOne({ _id: job.userId });
        if (!user || user.deactivatedAt) throw new Error('user_not_exportable');
        const token = randomToken();
        const zipData = buildZip(await buildExportFiles(job.userId));
        await getDataExportsCollection().updateOne(
          { _id: job._id, status: 'preparing' },
          {
            $set: {
              status: 'ready',
              readyAt: new Date(),
              zipData,
              fileName: 'blabber-data-export.zip',
              contentType: 'application/zip',
              downloadTokenHash: hashToken(token),
            },
          }
        );
        await sendExportReadyEmail(job.userId, user.email);
        ready += 1;
      } catch (error) {
        await getDataExportsCollection().updateOne(
          { _id: job._id },
          { $set: { status: 'failed', failedAt: new Date(), errorCode: 'export_failed' }, $unset: { zipData: '' } }
        );
        failed += 1;
      }
    }
    return { checked: jobs.length, ready, failed };
  }
}

export class AccountDeletionProcessor {
  private interval: NodeJS.Timeout | null = null;

  async runOnce(now = new Date()) {
    const deletions = await getAccountDeletionsCollection()
      .find({ status: 'pending', scheduledFor: { $lte: now } })
      .limit(20)
      .toArray();
    let finalized = 0;
    for (const deletion of deletions) {
      const audit = await this.finalize(deletion._id, deletion.userId, now);
      if (audit) finalized += 1;
    }
    return { checked: deletions.length, finalized };
  }

  private async finalize(deletionId: ObjectId, userId: ObjectId, now: Date) {
    const existingAudit = await getAccountDeletionAuditsCollection().findOne({ deletionId });
    if (existingAudit) return null;
    const db = getDatabase();
    const stats: Record<string, number> = {};
    const count = async (name: string, promise: Promise<any>) => {
      const result = await promise;
      stats[name] = result.deletedCount ?? result.modifiedCount ?? 0;
      return result;
    };

    const user = await db.collection('users').findOne({ _id: userId, deactivatedAt: { $exists: true } });
    if (!user) return null;

    await count('sessions', db.collection('deviceSessions').deleteMany({ userId }));
    await count('passwordResetTokens', db.collection('passwordResetTokens').deleteMany({ userId }));
    await count('emailVerificationTokens', db.collection('emailVerificationTokens').deleteMany({ userId }));
    await count('pendingEmailChanges', db.collection('pendingEmailChanges').deleteMany({ userId }));
    await count('dataExports', db.collection('dataExports').deleteMany({ userId }));
    await count('pushSubscriptions', db.collection('pushSubscriptions').deleteMany({ userId }));
    await count('mobilePushDevices', db.collection('mobile_push_devices').deleteMany({ userId }));
    await count('notificationPreferences', db.collection('notificationPreferences').deleteMany({ userId }));
    await count('userSettings', db.collection('userSettings').deleteMany({ userId }));
    await count('userChatPreferences', db.collection('userChatPreferences').deleteMany({ userId }));
    await count('savedMessages', db.collection('savedMessages').deleteMany({ userId }));
    await count('discoveryPreferences', db.collection('discovery_preferences').deleteMany({ userId }));
    await count('discoveryFeedbackOwned', db.collection('discovery_feedback').deleteMany({ $or: [{ userId }, { targetId: userId }] }));
    await count('discoveryEventsOwned', db.collection('discovery_events').deleteMany({ $or: [{ userId }, { targetId: userId }] }));
    await count('discoveryCandidateTokensOwned', db.collection('discovery_candidate_tokens').deleteMany({ $or: [{ viewerUserId: userId }, { targetId: userId }] }));
    await count('discoveryAffinitiesOwned', db.collection('discovery_affinities').deleteMany({ $or: [{ userId }, { affinityKey: userId }] }));
    await count('discoveryForYouSessionsOwned', db.collection('discovery_for_you_sessions').deleteMany({ userId }));
    await count('reelForYouSessionsOwned', db.collection('reel_for_you_sessions').deleteMany({ userId }));
    const authoredReelsForDeletion = await db.collection('reels').find({ authorUserId: userId }).project({ _id: 1, sourceMediaId: 1, fallbackPath: 1, posterPath: 1, hlsPlaylistPath: 1, hlsSegments: 1 }).toArray();
    const authoredReelIds = authoredReelsForDeletion.map((reel) => reel._id);
    const authoredReelSourceIds = authoredReelsForDeletion.map((reel: any) => reel.sourceMediaId).filter(Boolean);
    const reelMediaForDeletion = await db.collection('media').find({ $or: [{ _id: { $in: authoredReelSourceIds } }, { reelId: { $in: authoredReelIds } }] }).project({ localPath: 1 }).toArray();
    stats.reelLocalFiles = await cleanupReelLocalFiles(authoredReelsForDeletion, reelMediaForDeletion);
    await count('reelPlaybackSessionsOwned', db.collection('reel_playback_sessions').deleteMany({ $or: [{ viewerUserId: userId }, { reelId: { $in: authoredReelIds } }] }));
    await count('reelCommentsAuthoredReels', db.collection('reel_comments').deleteMany({ reelId: { $in: authoredReelIds } }));
    await count('reelReactionsAuthoredReels', db.collection('reel_reactions').deleteMany({ reelId: { $in: authoredReelIds } }));
    await count('reelSavesAuthoredReels', db.collection('reel_saves').deleteMany({ reelId: { $in: authoredReelIds } }));
    await count('reelNotificationCooldowns', db.collection('reel_notification_cooldowns').deleteMany({
      $or: [
        { reelId: { $in: authoredReelIds } },
        { actorUserId: userId },
        { recipientUserId: userId },
      ],
    }));
    await count('reelCommentsAuthoredByUser', db.collection('reel_comments').deleteMany({ authorUserId: userId }));
    await count('reelReactionsAuthoredByUser', db.collection('reel_reactions').deleteMany({ reactingUserId: userId }));
    await count('reelSavesAuthoredByUser', db.collection('reel_saves').deleteMany({ userId }));
    await count('discoveryFeedbackReels', db.collection('discovery_feedback').deleteMany({ targetId: { $in: authoredReelIds } }));
    await count('discoveryEventsReels', db.collection('discovery_events').deleteMany({ targetId: { $in: authoredReelIds } }));
    await count('discoveryTokensReels', db.collection('discovery_candidate_tokens').deleteMany({ targetId: { $in: authoredReelIds } }));
    await count('reelForYouSessionsAuthoredReels', db.collection('reel_for_you_sessions').deleteMany({ orderedReelIds: { $in: authoredReelIds } }));
    await count('authoredReels', db.collection('reels').deleteMany({ authorUserId: userId }));
    await count('reelSourceMedia', db.collection('media').deleteMany({ $or: [{ _id: { $in: authoredReelSourceIds } }, { reelId: { $in: authoredReelIds } }] }));

    const ownedCommunities = await db.collection('communities').find({ ownerUserId: userId, deletedAt: { $exists: false } }).toArray();
    for (const community of ownedCommunities) {
      let successor: any = null;
      for (const role of ['admin', 'moderator', 'member']) {
        successor = await db.collection('community_memberships').findOne(
          { communityId: community._id, userId: { $ne: userId }, role },
          { sort: { joinedAt: 1 } }
        );
        if (successor) break;
      }
      if (successor) {
        await db.collection('communities').updateOne(
          { _id: community._id },
          { $set: { ownerUserId: successor.userId, communityDiscoverable: false, discoverableUpdatedAt: now, updatedAt: now } }
        );
        await db.collection('community_memberships').updateOne(
          { _id: successor._id },
          { $set: { role: 'owner', updatedAt: now } }
        );
        stats.communitiesTransferred = (stats.communitiesTransferred || 0) + 1;
      } else {
        await db.collection('communities').updateOne(
          { _id: community._id },
          { $set: { deletedAt: now, updatedAt: now, memberCount: 0, communityDiscoverable: false, discoverableUpdatedAt: now } }
        );
        stats.communitiesDeleted = (stats.communitiesDeleted || 0) + 1;
      }
      if (community.handle) {
        await db.collection('community_handle_reservations').updateOne(
          { handle: community.handle },
          {
            $set: {
              reason: 'deleted',
              reservedUntil: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
              createdAt: now,
            },
            $setOnInsert: { _id: new ObjectId() },
          },
          { upsert: true }
        );
      }
    }

    const authoredCommunityPosts = await db.collection('community_posts').find({ authorUserId: userId }).project({ _id: 1, mediaIds: 1 }).toArray();
    const authoredCommunityPostIds = authoredCommunityPosts.map((post) => post._id);
    const authoredCommunityPostMediaIds = authoredCommunityPosts.flatMap((post: any) => post.mediaIds || []);
    const communityInteractionPostIds = [
      ...(await db.collection('community_post_comments').find({ authorUserId: userId }).project({ communityPostId: 1 }).toArray()).map((item: any) => item.communityPostId),
      ...(await db.collection('community_post_reactions').find({ reactingUserId: userId }).project({ communityPostId: 1 }).toArray()).map((item: any) => item.communityPostId),
    ].filter((postId: any) => postId && !authoredCommunityPostIds.some((authoredId) => authoredId.equals?.(postId)));
    await count('communityPostCommentsAuthoredPosts', db.collection('community_post_comments').deleteMany({ communityPostId: { $in: authoredCommunityPostIds } }));
    await count('communityPostReactionsAuthoredPosts', db.collection('community_post_reactions').deleteMany({ communityPostId: { $in: authoredCommunityPostIds } }));
    await count('authoredCommunityPosts', db.collection('community_posts').deleteMany({ authorUserId: userId }));
    await count('discoveryFeedbackCommunityPosts', db.collection('discovery_feedback').deleteMany({ targetId: { $in: authoredCommunityPostIds } }));
    await count('discoveryEventsCommunityPosts', db.collection('discovery_events').deleteMany({ targetId: { $in: authoredCommunityPostIds } }));
    await count('discoveryTokensCommunityPosts', db.collection('discovery_candidate_tokens').deleteMany({ targetId: { $in: authoredCommunityPostIds } }));
    await count('communityCommentsAuthoredByUser', db.collection('community_post_comments').deleteMany({ authorUserId: userId }));
    await count('communityReactionsAuthoredByUser', db.collection('community_post_reactions').deleteMany({ reactingUserId: userId }));
    await count('communityMemberships', db.collection('community_memberships').deleteMany({ userId }));
    await count('communityJoinRequests', db.collection('community_join_requests').deleteMany({ requesterUserId: userId }));
    await count('communityBans', db.collection('community_bans').deleteMany({ $or: [{ userId }, { bannedByUserId: userId }] }));
    await count('communityInvites', db.collection('community_invites').deleteMany({ createdByUserId: userId }));
    await count('communityActivityIdentity', db.collection('community_moderation_activity').updateMany(
      { $or: [{ actorUserId: userId }, { targetUserId: userId }] },
      { $set: { actorDeletedAt: now, targetDeletedAt: now }, $unset: { actorUserId: '', targetUserId: '' } } as any
    ));
    const affectedCommunityPostIds = Array.from(new Set(communityInteractionPostIds.map((postId: any) => postId.toString()))).map((postId) => new ObjectId(postId));
    for (const postId of affectedCommunityPostIds) {
      const [commentCount, reactionCounts] = await Promise.all([
        db.collection('community_post_comments').countDocuments({ communityPostId: postId, deletedAt: { $exists: false } }),
        db.collection('community_post_reactions').aggregate<{ _id: string; count: number }>([
          { $match: { communityPostId: postId } },
          { $group: { _id: '$emoji', count: { $sum: 1 } } },
        ]).toArray(),
      ]);
      await db.collection('community_posts').updateOne(
        { _id: postId },
        {
          $set: {
            commentCount,
            reactionCounts: Object.fromEntries(reactionCounts.map((item) => [item._id, item.count])),
            updatedAt: now,
          },
        }
      );
    }
    const affectedCommunityIds = await db.collection('communities').find({ deletedAt: { $exists: false } }).project({ _id: 1 }).toArray();
    for (const community of affectedCommunityIds) {
      const memberCount = await db.collection('community_memberships').countDocuments({ communityId: community._id });
      await db.collection('communities').updateOne({ _id: community._id }, { $set: { memberCount, updatedAt: now } });
    }

    const authoredPosts = await db.collection('posts').find({ authorUserId: userId }).project({ _id: 1, mediaIds: 1 }).toArray();
    const authoredPostIds = authoredPosts.map((post) => post._id);
    const authoredPostMediaIds = authoredPosts.flatMap((post: any) => post.mediaIds || []);
    const postInteractionIds = [
      ...(await db.collection('post_comments').find({ authorUserId: userId }).project({ postId: 1 }).toArray()).map((item: any) => item.postId),
      ...(await db.collection('post_reactions').find({ reactingUserId: userId }).project({ postId: 1 }).toArray()).map((item: any) => item.postId),
    ].filter((postId: any) => postId && !authoredPostIds.some((authoredId) => authoredId.equals?.(postId)));
    await count('postCommentsAuthoredPosts', db.collection('post_comments').deleteMany({ postId: { $in: authoredPostIds } }));
    await count('postReactionsAuthoredPosts', db.collection('post_reactions').deleteMany({ postId: { $in: authoredPostIds } }));
    await count('postNotificationCooldownsAuthoredPosts', db.collection('post_notification_cooldowns').deleteMany({
      $or: [
        { postId: { $in: authoredPostIds } },
        { actorUserId: userId },
        { recipientUserId: userId },
      ],
    }));
    await count('authoredPosts', db.collection('posts').deleteMany({ authorUserId: userId }));
    await count('discoveryFeedbackAuthoredPosts', db.collection('discovery_feedback').deleteMany({ targetId: { $in: authoredPostIds } }));
    await count('discoveryEventsAuthoredPosts', db.collection('discovery_events').deleteMany({ targetId: { $in: authoredPostIds } }));
    await count('discoveryTokensAuthoredPosts', db.collection('discovery_candidate_tokens').deleteMany({ targetId: { $in: authoredPostIds } }));
    await count('discoveryForYouSessionsAuthoredPosts', db.collection('discovery_for_you_sessions').deleteMany({ candidatePostIds: { $in: authoredPostIds } }));
    await count('postCommentsAuthoredByUser', db.collection('post_comments').deleteMany({ authorUserId: userId }));
    await count('postReactionsAuthoredByUser', db.collection('post_reactions').deleteMany({ reactingUserId: userId }));
    const affectedPostIds = Array.from(new Set(postInteractionIds.map((postId: any) => postId.toString()))).map((postId) => new ObjectId(postId));
    for (const postId of affectedPostIds) {
      const [commentCount, reactionCounts] = await Promise.all([
        db.collection('post_comments').countDocuments({ postId, deletedAt: { $exists: false } }),
        db.collection('post_reactions').aggregate<{ _id: string; count: number }>([
          { $match: { postId } },
          { $group: { _id: '$emoji', count: { $sum: 1 } } },
        ]).toArray(),
      ]);
      await db.collection('posts').updateOne(
        { _id: postId },
        {
          $set: {
            commentCount,
            reactionCounts: Object.fromEntries(reactionCounts.map((item) => [item._id, item.count])),
            updatedAt: now,
          },
        }
      );
    }
    const authoredMoments = await db.collection('moments').find({ authorUserId: userId }).project({ _id: 1 }).toArray();
    const authoredMomentIds = authoredMoments.map((moment) => moment._id);
    await count('authoredMoments', db.collection('moments').deleteMany({ authorUserId: userId }));
    await count('momentViewsAuthored', db.collection('moment_views').deleteMany({ momentId: { $in: authoredMomentIds } }));
    await count('momentViewsViewer', db.collection('moment_views').deleteMany({ viewerUserId: userId }));
    await count('momentReactionsAuthoredMoments', db.collection('moment_reactions').deleteMany({ momentId: { $in: authoredMomentIds } }));
    await count('momentReactionsViewer', db.collection('moment_reactions').deleteMany({ viewerUserId: userId }));
    await count('momentReactionsAuthor', db.collection('moment_reactions').deleteMany({ authorUserId: userId }));
    await count('momentNotificationCooldowns', db.collection('moment_notification_cooldowns').deleteMany({
      $or: [
        { momentId: { $in: authoredMomentIds } },
        { authorUserId: userId },
        { recipientUserId: userId },
        { viewerUserId: userId },
      ],
    }));
    await count('momentReplyMetadata', db.collection('messages').updateMany(
      {
        $or: [
          { 'momentReply.momentId': { $in: authoredMomentIds } },
          { 'momentReply.authorUserId': userId },
        ],
      },
      { $unset: { momentReply: '' } }
    ));
    await count('momentAudienceSnapshots', db.collection('moments').updateMany(
      { audienceSnapshotUserIds: userId },
      { $pull: { audienceSnapshotUserIds: userId } } as any
    ));
    await count('closeFriends', db.collection('close_friends').deleteMany({ $or: [{ ownerUserId: userId }, { friendUserId: userId }] }));
    await count('personalActions', db.collection('chat_actions').deleteMany({ visibility: 'personal', personalOwnerUserId: userId }));
    await count('aiSummaries', db.collection('chat_summaries').deleteMany({ generatedByUserId: userId }));
    await count('aiDecisions', db.collection('chat_decisions').deleteMany({ generatedByUserId: userId }));
    await count('aiWaitingOn', db.collection('chat_waiting_on').deleteMany({ generatedByUserId: userId }));
    await count('userBlocks', db.collection('user_blocks').deleteMany({ $or: [{ blockerUserId: userId }, { blockedUserId: userId }] }));
    await count('profileRelationships', db.collection('profile_relationships').deleteMany({ $or: [{ followerUserId: userId }, { targetUserId: userId }] }));
    if (user.profileHandle) {
      await db.collection('profile_handle_reservations').updateOne(
        { handle: user.profileHandle },
        {
          $set: {
            reason: 'deleted',
            reservedUntil: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            createdAt: now,
          },
          $setOnInsert: { _id: new ObjectId() },
        },
        { upsert: true }
      );
    }
    await count('reportReporterIdentity', db.collection('reports').updateMany(
      { reporterUserId: userId },
      { $set: { reporterDeletedAt: now, updatedAt: now }, $unset: { reporterUserId: '', details: '' } } as any
    ));
    await count('reportTargetIdentity', db.collection('reports').updateMany(
      { targetUserId: userId },
      { $set: { targetUserDeletedAt: now, updatedAt: now }, $unset: { targetUserId: '' } } as any
    ));
    await count('reportTargetPostIdentity', db.collection('reports').updateMany(
      { targetPostId: { $in: authoredPostIds } },
      { $set: { targetPostDeletedAt: now, updatedAt: now }, $unset: { targetPostId: '', targetCommentId: '', details: '' } } as any
    ));
    await count('reportTargetCommunityPostIdentity', db.collection('reports').updateMany(
      { targetCommunityPostId: { $in: authoredCommunityPostIds } },
      { $set: { targetCommunityPostDeletedAt: now, updatedAt: now }, $unset: { targetCommunityPostId: '', targetCommunityCommentId: '', details: '' } } as any
    ));

    const authored = await db.collection('messages').find({ senderId: userId }).project({ _id: 1 }).toArray();
    const authoredIds = authored.map((message) => message._id);
    await count('messagePins', db.collection('messagePins').deleteMany({ $or: [{ messageId: { $in: authoredIds } }, { pinnedBy: userId }] }));
    await count('authoredMessages', db.collection('messages').deleteMany({ senderId: userId }));
    await count('messageReactions', db.collection('messages').updateMany({ 'reactions.userId': userId }, { $pull: { reactions: { userId } } } as any));
    await count('messageMentions', db.collection('messages').updateMany({ 'mentions.userId': userId }, { $pull: { mentions: { userId } } } as any));
    await count('pollVoteRecords', db.collection('messages').updateMany({ 'poll.votes.userId': userId }, { $pull: { 'poll.votes': { userId } } } as any));
    await count('pollOptionVotes', db.collection('messages').updateMany({ 'poll.options.votes': userId }, { $pull: { 'poll.options.$[].votes': userId } } as any));
    await count('eventRsvps', db.collection('messages').updateMany({ 'event.rsvps.userId': userId }, { $pull: { 'event.rsvps': { userId } } } as any));
    await count('replyPreviews', db.collection('messages').updateMany(
      { 'replyTo.messageId': { $in: authoredIds } },
      { $set: { 'replyTo.body': 'Original message unavailable.', 'replyTo.unavailable': true }, $unset: { 'replyTo.senderDisplayName': '' } }
    ));

    const deletedPerson = { name: 'Deleted account' };
    await count('groupActionAssignedIdentity', db.collection('chat_actions').updateMany(
      { 'assignedTo.userId': userId.toString(), visibility: { $ne: 'personal' } },
      { $set: { assignedTo: deletedPerson, updatedAt: now }, $unset: { sourceText: '' } } as any
    ));
    await count('groupActionCreatorIdentity', db.collection('chat_actions').updateMany(
      { 'createdBy.userId': userId.toString(), visibility: { $ne: 'personal' } },
      { $set: { createdBy: deletedPerson, updatedAt: now }, $unset: { sourceText: '' } } as any
    ));
    await count('groupActionGeneratedIdentity', db.collection('chat_actions').updateMany(
      { generatedByUserId: userId, visibility: { $ne: 'personal' } },
      { $set: { updatedAt: now }, $unset: { generatedByUserId: '', sourceText: '' } } as any
    ));

    const chats = await db.collection('chats').find({ participants: userId }).toArray();
    for (const chat of chats) {
      const remainingParticipants = (chat.participants || []).filter((id: ObjectId) => !id.equals(userId));
      const remainingAdmins = (chat.admins || []).filter((id: ObjectId) => !id.equals(userId));
      if (chat.type === 'group') {
        if (remainingParticipants.length === 0) {
          await db.collection('chats').updateOne({ _id: chat._id }, { $set: { deletedAt: now, updatedAt: now } });
          stats.deletedEmptyGroups = (stats.deletedEmptyGroups || 0) + 1;
        } else {
          const ownerDeleted = chat.ownerId?.equals(userId);
          const ownerId = ownerDeleted ? (remainingAdmins[0] || remainingParticipants[0]) : chat.ownerId;
          await db.collection('chats').updateOne(
            { _id: chat._id },
            {
              $set: { participants: remainingParticipants, admins: remainingAdmins, ownerId, updatedAt: now },
              $pull: { memberRestrictions: { userId } },
            } as any
          );
          stats.groupsUpdated = (stats.groupsUpdated || 0) + 1;
        }
      } else {
        await db.collection('chats').updateOne({ _id: chat._id }, { $set: { deletedAt: now, updatedAt: now } });
        stats.directChatsDeleted = (stats.directChatsDeleted || 0) + 1;
      }
    }

    if (authoredPostMediaIds.length) {
      await db.collection('media').updateMany(
        { _id: { $in: authoredPostMediaIds }, userId },
        { $set: { status: 'deleted', deletedAt: now }, $unset: { url: '', publicUrl: '' } } as any
      );
    }
    if (authoredCommunityPostMediaIds.length) {
      await db.collection('media').updateMany(
        { _id: { $in: authoredCommunityPostMediaIds }, userId },
        { $set: { status: 'deleted', deletedAt: now }, $unset: { url: '', publicUrl: '' } } as any
      );
    }
    await db.collection('media').deleteMany({ userId });
    await db.collection('users').deleteOne({ _id: userId });
    await getAccountDeletionsCollection().updateOne({ _id: deletionId }, { $set: { status: 'finalized', finalizedAt: now } });
    await getAccountDeletionAuditsCollection().insertOne({
      _id: new ObjectId(),
      userIdHash: hashUserId(userId),
      deletionId,
      finalizedAt: now,
      stats,
    });
    return stats;
  }

  start() {
    if (this.interval || process.env.ACCOUNT_DELETION_PROCESSOR_ENABLED === 'false') return;
    void this.runOnce().catch((error) => logger.error({ error }, 'Account deletion processor failed'));
    this.interval = setInterval(() => {
      void this.runOnce().catch((error) => logger.error({ error }, 'Account deletion processor failed'));
    }, PROCESSOR_INTERVAL_MS);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }
}
