import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getDatabase } from '../db';
import { getReportsCollection, ReportStatus, ReportTargetType, TrustReport } from '../models/report';
import { loadReadablePost } from './posts';
import { loadReadableCommunityPost } from './communities';

const reportSchema = z.object({
  targetType: z.enum(['user', 'message', 'group', 'post', 'post_comment', 'community', 'community_post', 'community_comment']),
  targetId: z.string().refine(ObjectId.isValid, 'Invalid target ID'),
  reason: z.string().trim().min(3).max(120),
  details: z.string().trim().max(1000).optional(),
});

const reviewSchema = z.object({
  status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']).optional(),
  internalNote: z.string().trim().max(2000).optional(),
});

function buildDuplicateKey(reporterUserId: ObjectId, targetType: ReportTargetType, targetId: ObjectId) {
  return `${reporterUserId.toString()}:${targetType}:${targetId.toString()}`;
}

async function buildEvidence(targetType: ReportTargetType, targetId: ObjectId, reporterUserId: ObjectId) {
  const db = getDatabase();
  if (targetType === 'user') {
    const user = await db.collection('users').findOne(
      { _id: targetId },
      { projection: { username: 1, name: 1, createdAt: 1 } }
    );
    if (!user) return null;
    return {
      targetUserId: targetId.toString(),
      username: user.username,
      name: user.name,
      userCreatedAt: user.createdAt,
    };
  }

  if (targetType === 'group') {
    const chat = await db.collection('chats').findOne(
      { _id: targetId, type: 'group', participants: reporterUserId, deletedAt: { $exists: false } },
      { projection: { title: 1, ownerId: 1, admins: 1, participants: 1, createdAt: 1 } }
    );
    if (!chat) return null;
    return {
      targetChatId: targetId.toString(),
      title: chat.title,
      ownerId: chat.ownerId?.toString(),
      adminCount: chat.admins?.length || 0,
      participantCount: chat.participants?.length || 0,
      chatCreatedAt: chat.createdAt,
    };
  }

  if (targetType === 'post') {
    const post = await loadReadablePost(targetId, reporterUserId);
    if (!post) return null;
    return {
      targetPostId: targetId.toString(),
      authorUserId: post.authorUserId.toString(),
      visibility: post.visibility,
      textSnapshot: (post.body || '').slice(0, 240),
      mediaType: post.mediaIds.length ? 'image' : null,
      mediaCount: post.mediaIds.length,
      createdAt: post.createdAt,
      availability: post.deletedAt ? 'deleted' : 'available',
    };
  }

  if (targetType === 'post_comment') {
    const comment = await db.collection('post_comments').findOne(
      { _id: targetId, deletedAt: { $exists: false } },
      { projection: { postId: 1, postAuthorUserId: 1, authorUserId: 1, body: 1, createdAt: 1 } }
    );
    if (!comment) return null;
    const post = await loadReadablePost(comment.postId, reporterUserId);
    if (!post) return null;
    return {
      targetCommentId: targetId.toString(),
      targetPostId: comment.postId.toString(),
      commentAuthorUserId: comment.authorUserId.toString(),
      postAuthorUserId: comment.postAuthorUserId.toString(),
      postVisibility: post.visibility,
      textSnapshot: String(comment.body || '').slice(0, 240),
      createdAt: comment.createdAt,
      availability: 'available',
    };
  }

  if (targetType === 'community') {
    const membership = await db.collection('community_memberships').findOne({ communityId: targetId, userId: reporterUserId });
    const community = membership
      ? await db.collection('communities').findOne(
          { _id: targetId, deletedAt: { $exists: false } },
          { projection: { name: 1, handle: 1, membershipMode: 1, postingPolicy: 1, ownerUserId: 1, memberCount: 1, createdAt: 1 } }
        )
      : null;
    if (!community) return null;
    return {
      targetCommunityId: targetId.toString(),
      handle: community.handle,
      membershipMode: community.membershipMode,
      postingPolicy: community.postingPolicy,
      ownerUserId: community.ownerUserId?.toString(),
      memberCount: community.memberCount || 0,
      createdAt: community.createdAt,
    };
  }

  if (targetType === 'community_post') {
    const post = await loadReadableCommunityPost(targetId, reporterUserId);
    if (!post) return null;
    return {
      targetCommunityPostId: targetId.toString(),
      targetCommunityId: post.communityId.toString(),
      authorUserId: post.authorUserId.toString(),
      textSnapshot: (post.body || '').slice(0, 240),
      mediaCount: post.mediaIds.length,
      createdAt: post.createdAt,
      availability: post.deletedAt ? 'deleted' : 'available',
    };
  }

  if (targetType === 'community_comment') {
    const comment = await db.collection('community_post_comments').findOne(
      { _id: targetId, deletedAt: { $exists: false } },
      { projection: { communityId: 1, communityPostId: 1, authorUserId: 1, body: 1, createdAt: 1 } }
    );
    if (!comment) return null;
    const post = await loadReadableCommunityPost(comment.communityPostId, reporterUserId);
    if (!post) return null;
    return {
      targetCommunityCommentId: targetId.toString(),
      targetCommunityPostId: comment.communityPostId.toString(),
      targetCommunityId: comment.communityId.toString(),
      commentAuthorUserId: comment.authorUserId.toString(),
      textSnapshot: String(comment.body || '').slice(0, 240),
      createdAt: comment.createdAt,
      availability: 'available',
    };
  }

  const message = await db.collection('messages').findOne(
    { _id: targetId, deletedFor: { $ne: reporterUserId } },
    { projection: { chatId: 1, senderId: 1, type: 1, createdAt: 1, media: 1, poll: 1, event: 1 } }
  );
  if (!message) return null;

  const chat = await db.collection('chats').findOne(
    { _id: message.chatId, participants: reporterUserId, deletedAt: { $exists: false } },
    { projection: { type: 1, title: 1 } }
  );
  if (!chat) return null;

  return {
    targetMessageId: targetId.toString(),
    targetChatId: message.chatId.toString(),
    senderId: message.senderId?.toString(),
    messageType: message.type || 'text',
    hasMedia: Boolean(message.media),
    hasPoll: Boolean(message.poll),
    hasEvent: Boolean(message.event),
    chatType: chat.type,
    chatTitle: chat.type === 'group' ? chat.title : undefined,
    messageCreatedAt: message.createdAt,
  };
}

function serializeMine(report: TrustReport) {
  return {
    id: report._id.toString(),
    targetType: report.targetType,
    status: report.status,
    reason: report.reason,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  };
}

function serializeModerator(report: TrustReport) {
  return {
    ...serializeMine(report),
    reporterUserId: report.reporterUserId.toString(),
    targetUserId: report.targetUserId?.toString(),
    targetMessageId: report.targetMessageId?.toString(),
    targetChatId: report.targetChatId?.toString(),
    targetPostId: report.targetPostId?.toString(),
    targetCommentId: report.targetCommentId?.toString(),
    targetCommunityId: report.targetCommunityId?.toString(),
    targetCommunityPostId: report.targetCommunityPostId?.toString(),
    targetCommunityCommentId: report.targetCommunityCommentId?.toString(),
    targetReelId: report.targetReelId?.toString(),
    targetReelCommentId: report.targetReelCommentId?.toString(),
    details: report.details,
    evidence: report.evidencePurgedAt ? { purged: true, purgedAt: report.evidencePurgedAt } : report.evidence,
    internalNote: report.internalNote,
    reviewedBy: report.reviewedBy?.toString(),
    reviewedAt: report.reviewedAt,
    retentionExpiresAt: report.retentionExpiresAt,
  };
}

export async function createReport(req: Request, res: Response, next: NextFunction) {
  try {
    const reporterId = (req as any).user?.userId;
    if (!reporterId) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }

    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation Error', message: 'Invalid report', details: parsed.error.errors });
      return;
    }

    const reporterUserId = new ObjectId(reporterId);
    const targetId = new ObjectId(parsed.data.targetId);
    const evidence = await buildEvidence(parsed.data.targetType, targetId, reporterUserId);
    if (!evidence) {
      res.status(404).json({ error: 'Not Found', message: 'Report target not found' });
      return;
    }

    const duplicateKey = buildDuplicateKey(reporterUserId, parsed.data.targetType, targetId);
    const cooldownSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existing = await getReportsCollection().findOne({ duplicateKey, createdAt: { $gte: cooldownSince } });
    if (existing) {
      res.status(200).json({ report: serializeMine(existing), duplicate: true });
      return;
    }

    const now = new Date();
    const report: TrustReport = {
      _id: new ObjectId(),
      reporterUserId,
      targetType: parsed.data.targetType,
      targetUserId: parsed.data.targetType === 'user' ? targetId : undefined,
      targetMessageId: parsed.data.targetType === 'message' ? targetId : undefined,
      targetChatId: parsed.data.targetType === 'group' ? targetId : undefined,
      targetPostId:
        parsed.data.targetType === 'post'
          ? targetId
          : parsed.data.targetType === 'post_comment'
            ? (evidence as any).targetPostId
              ? new ObjectId(String((evidence as any).targetPostId))
              : undefined
            : undefined,
      targetCommentId: parsed.data.targetType === 'post_comment' ? targetId : undefined,
      targetCommunityId:
        parsed.data.targetType === 'community'
          ? targetId
          : (evidence as any).targetCommunityId
            ? new ObjectId(String((evidence as any).targetCommunityId))
            : undefined,
      targetCommunityPostId:
        parsed.data.targetType === 'community_post'
          ? targetId
          : (evidence as any).targetCommunityPostId
            ? new ObjectId(String((evidence as any).targetCommunityPostId))
            : undefined,
      targetCommunityCommentId: parsed.data.targetType === 'community_comment' ? targetId : undefined,
      reason: parsed.data.reason,
      details: parsed.data.details,
      status: 'open',
      duplicateKey,
      evidence,
      createdAt: now,
      updatedAt: now,
      retentionExpiresAt: new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000),
    };

    await getReportsCollection().insertOne(report);
    res.status(201).json({ report: serializeMine(report) });
  } catch (error) {
    next(error);
  }
}

export async function listMyReports(req: Request, res: Response, next: NextFunction) {
  try {
    const reporterId = (req as any).user?.userId;
    if (!reporterId) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }
    const reports = await getReportsCollection()
      .find({ reporterUserId: new ObjectId(reporterId) })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    res.status(200).json({ reports: reports.map(serializeMine) });
  } catch (error) {
    next(error);
  }
}

export async function listModerationReports(_req: Request, res: Response, next: NextFunction) {
  try {
    const reports = await getReportsCollection().find({}).sort({ createdAt: -1 }).limit(100).toArray();
    res.status(200).json({ reports: reports.map(serializeModerator) });
  } catch (error) {
    next(error);
  }
}

export async function getModerationReport(req: Request, res: Response, next: NextFunction) {
  try {
    if (!ObjectId.isValid(req.params.reportId)) {
      res.status(400).json({ error: 'Validation Error', message: 'Invalid report ID' });
      return;
    }
    const report = await getReportsCollection().findOne({ _id: new ObjectId(req.params.reportId) });
    if (!report) {
      res.status(404).json({ error: 'Not Found', message: 'Report not found' });
      return;
    }
    res.status(200).json({ report: serializeModerator(report) });
  } catch (error) {
    next(error);
  }
}

export async function updateModerationReport(req: Request, res: Response, next: NextFunction) {
  try {
    const reviewerId = (req as any).user?.userId;
    if (!ObjectId.isValid(req.params.reportId)) {
      res.status(400).json({ error: 'Validation Error', message: 'Invalid report ID' });
      return;
    }
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation Error', message: 'Invalid review', details: parsed.error.errors });
      return;
    }
    const set: Partial<TrustReport> = { updatedAt: new Date() };
    if (parsed.data.status) set.status = parsed.data.status as ReportStatus;
    if (parsed.data.internalNote !== undefined) set.internalNote = parsed.data.internalNote;
    if (parsed.data.status || parsed.data.internalNote !== undefined) {
      set.reviewedAt = new Date();
      set.reviewedBy = new ObjectId(reviewerId);
    }

    const result = await getReportsCollection().findOneAndUpdate(
      { _id: new ObjectId(req.params.reportId) },
      { $set: set },
      { returnDocument: 'after' }
    );
    if (!result) {
      res.status(404).json({ error: 'Not Found', message: 'Report not found' });
      return;
    }
    res.status(200).json({ report: serializeModerator(result) });
  } catch (error) {
    next(error);
  }
}
