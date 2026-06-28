import { ObjectId } from 'mongodb';
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

function iso(value?: Date) {
  return value ? value.toISOString() : undefined;
}

function oid(value: any) {
  return value instanceof ObjectId ? value.toString() : value;
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
    saves,
    archiveState,
    actions,
    notificationPreferences,
    blocks,
    reports,
    following,
    incomingFollowRequests,
  ] = await Promise.all([
    db.collection('userSettings').findOne({ userId }),
    db.collection('deviceSessions').find({ userId }).project({ refreshTokenHash: 0, ipAddress: 0 }).toArray(),
    db.collection('messages').find({ senderId: userId }).project({ body: 1, type: 1, chatId: 1, createdAt: 1, editedAt: 1 }).toArray(),
    db.collection('messages').find({ 'reactions.userId': userId }).project({ chatId: 1, reactions: 1, createdAt: 1 }).toArray(),
    db.collection('moment_reactions').find({ viewerUserId: userId }).project({ momentId: 1, authorUserId: 1, emoji: 1, createdAt: 1, updatedAt: 1 }).toArray(),
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
  ]);

  const followTargetIds = following.map((item: any) => item.targetUserId).filter(Boolean);
  const requestUserIds = incomingFollowRequests.map((item: any) => item.followerUserId).filter(Boolean);
  const visibleProfileUsers = await db.collection('users')
    .find({ _id: { $in: [...followTargetIds, ...requestUserIds] }, deactivatedAt: { $exists: false }, deletedAt: { $exists: false } })
    .project({ profileHandle: 1, name: 1 })
    .toArray();
  const visibleProfileUserById = new Map(visibleProfileUsers.map((item: any) => [item._id.toString(), item]));

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
    await count('notificationPreferences', db.collection('notificationPreferences').deleteMany({ userId }));
    await count('userSettings', db.collection('userSettings').deleteMany({ userId }));
    await count('userChatPreferences', db.collection('userChatPreferences').deleteMany({ userId }));
    await count('savedMessages', db.collection('savedMessages').deleteMany({ userId }));
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
