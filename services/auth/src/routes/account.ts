import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { asyncHandler, UnauthorizedError, ValidationError } from '@repo/utils';
import { getUsersCollection, UserDocument } from '../models/user';
import {
  compareRefreshToken,
  getDeviceSessionsCollection,
} from '../models/device-session';
import { getPasswordResetTokensCollection } from '../models/password-reset-token';
import {
  getAccountDeletionsCollection,
  getCapturedEmailsCollection,
  getDataExportsCollection,
  getEmailVerificationTokensCollection,
  getPendingEmailChangesCollection,
  hashToken,
  randomToken,
} from '../models/account-security';
import {
  sendDeletionCancelledEmail,
  sendDeletionRequestedEmail,
  sendEmailChangedNotice,
  sendEmailChangeConfirmation,
  sendEmailChangeNotice,
  sendVerifyEmail,
} from '../utils/account-email';
import { getRefreshCookieOptions } from '../utils/cookies';
import { DataExportProcessor, AccountDeletionProcessor } from '../account-processors';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DELETE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const GENERIC_LINK_UNAVAILABLE = 'This verification link is unavailable. Request a new one from Settings.';

const emailSchema = z.string().email().max(320);
const tokenSchema = z.object({ token: z.string().min(20).max(300) });
const passwordSchema = z.object({ currentPassword: z.string().min(1).max(100) });
const emailChangeRequestSchema = z.object({
  newEmail: emailSchema,
  currentPassword: z.string().min(1).max(100).optional(),
});
const deletionRequestSchema = z.object({
  confirmation: z.literal('DELETE'),
  currentPassword: z.string().min(1).max(100).optional(),
});

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function safeUser(user: UserDocument) {
  return {
    _id: user._id.toString(),
    username: user.username,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    avatarSource: user.avatarSource ?? (user.googleId && user.avatarUrl ? 'google' : user.avatarUrl ? 'upload' : 'none'),
    about: user.about,
    role: user.role,
    department: user.department,
    authProvider: user.authProvider || 'password',
    emailVerified: Boolean(user.emailVerified),
    deactivatedAt: user.deactivatedAt,
    deletionScheduledAt: user.deletionScheduledAt,
  };
}

async function requireUser(req: Request) {
  const userId = req.user?.userId;
  if (!userId || !ObjectId.isValid(userId)) throw new UnauthorizedError('User not authenticated');
  const user = await getUsersCollection().findOne({ _id: new ObjectId(userId) });
  if (!user || user.deactivatedAt) throw new UnauthorizedError('User not found');
  return user;
}

async function requireUserIncludingDeactivated(req: Request) {
  const userId = req.user?.userId;
  if (!userId || !ObjectId.isValid(userId)) throw new UnauthorizedError('User not authenticated');
  const user = await getUsersCollection().findOne({ _id: new ObjectId(userId) });
  if (!user) throw new UnauthorizedError('User not found');
  return user;
}

async function requireVerified(user: UserDocument) {
  if (!user.emailVerified) {
    throw new ValidationError('Verify your email before continuing.');
  }
}

async function requireRecentAuth(user: UserDocument, currentPassword?: string) {
  const provider = user.authProvider || 'password';
  if (provider === 'google' && !currentPassword) {
    throw new ValidationError('Password confirmation is not available for this Google-only account.');
  }
  if (!currentPassword || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new UnauthorizedError('Current password is required.');
  }
}

async function findCurrentSession(req: Request, userId: ObjectId) {
  const refreshToken = req.cookies?.refreshToken;
  if (!refreshToken) return null;
  const sessions = await getDeviceSessionsCollection()
    .find({ userId, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } } as any)
    .sort({ lastActiveAt: -1, createdAt: -1 })
    .toArray();
  for (const session of sessions) {
    if (await compareRefreshToken(refreshToken, session.refreshTokenHash)) return session;
  }
  return null;
}

function deviceMetadata(userAgent = '') {
  const ua = userAgent.toLowerCase();
  const browser = ua.includes('firefox')
    ? 'Firefox'
    : ua.includes('edg')
      ? 'Edge'
      : ua.includes('opr') || ua.includes('opera')
        ? 'Opera'
        : ua.includes('samsungbrowser')
          ? 'Samsung Internet'
          : ua.includes('chrome') || ua.includes('crios')
            ? 'Chrome'
            : ua.includes('safari')
              ? 'Safari'
              : 'Browser';
  const operatingSystem = ua.includes('iphone') || ua.includes('ipad')
    ? 'iOS'
    : ua.includes('android')
      ? 'Android'
      : ua.includes('mac')
        ? 'macOS'
        : ua.includes('win')
          ? 'Windows'
          : ua.includes('linux')
            ? 'Linux'
            : 'Device';
  const deviceType = ua.includes('ipad') || ua.includes('tablet')
    ? 'tablet'
    : ua.includes('iphone') || ua.includes('android') || ua.includes('mobile')
      ? 'mobile'
      : operatingSystem === 'Device'
        ? 'unknown'
        : 'desktop';

  return {
    browser,
    operatingSystem,
    deviceType,
    label: `${browser} on ${operatingSystem}`,
  };
}

function serializeSession(session: any, currentSessionId?: string) {
  const metadata = deviceMetadata(session.userAgent);
  return {
    id: session._id.toString(),
    current: session._id.toString() === currentSessionId,
    ...metadata,
    userAgent: session.userAgent || '',
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt || session.createdAt,
    expiresAt: session.expiresAt,
    status: session.revokedAt ? 'revoked' : session.expiresAt <= new Date() ? 'expired' : 'active',
  };
}

async function createVerificationToken(user: UserDocument) {
  const token = randomToken();
  await getEmailVerificationTokensCollection().deleteMany({ userId: user._id, usedAt: { $exists: false } });
  await getEmailVerificationTokensCollection().insertOne({
    _id: new ObjectId(),
    userId: user._id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + DAY_MS),
    createdAt: new Date(),
    sentToEmail: user.email,
  });
  await sendVerifyEmail(user._id, user.email, token);
}

export const getAccountStatus = asyncHandler(async (req: Request, res: Response) => {
  const user = await requireUser(req);
  const deletion = await getAccountDeletionsCollection().findOne({ userId: user._id, status: 'pending' });
  const latestExport = await getDataExportsCollection().find({ userId: user._id }).sort({ requestedAt: -1 }).limit(1).next();
  res.status(200).json({
    user: safeUser(user),
    deletion: deletion ? { status: deletion.status, scheduledFor: deletion.scheduledFor } : null,
    export: latestExport ? {
      id: latestExport._id.toString(),
      status: latestExport.expiresAt <= new Date() && latestExport.status === 'ready' ? 'expired' : latestExport.status,
      requestedAt: latestExport.requestedAt,
      readyAt: latestExport.readyAt,
      expiresAt: latestExport.expiresAt,
    } : null,
  });
});

export const resendVerification = asyncHandler(async (req: Request, res: Response) => {
  const user = await requireUser(req);
  if (user.emailVerified) return res.status(200).json({ success: true, emailVerified: true });
  const recent = await getEmailVerificationTokensCollection().findOne({ userId: user._id, createdAt: { $gt: new Date(Date.now() - 60_000) } });
  if (recent) return res.status(429).json({ error: 'Too Many Requests', message: 'Please wait before requesting another verification email.' });
  await createVerificationToken(user);
  return res.status(200).json({ success: true });
});

export const confirmVerification = asyncHandler(async (req: Request, res: Response) => {
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError(GENERIC_LINK_UNAVAILABLE);
  const tokenHash = hashToken(parsed.data.token);
  const token = await getEmailVerificationTokensCollection().findOne({ tokenHash, usedAt: { $exists: false }, expiresAt: { $gt: new Date() } });
  if (!token) throw new ValidationError(GENERIC_LINK_UNAVAILABLE);
  await getEmailVerificationTokensCollection().updateOne({ _id: token._id, usedAt: { $exists: false } }, { $set: { usedAt: new Date() } });
  await getUsersCollection().updateOne({ _id: token.userId }, { $set: { emailVerified: true, updatedAt: new Date() } });
  res.status(200).json({ success: true });
});

export const requestEmailChange = asyncHandler(async (req: Request, res: Response) => {
  const user = await requireUser(req);
  await requireVerified(user);
  const parsed = emailChangeRequestSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Invalid email change request.');
  await requireRecentAuth(user, parsed.data.currentPassword);
  const newEmail = normalizeEmail(parsed.data.newEmail);
  const existing = await getUsersCollection().findOne({ email: newEmail });
  if (existing && !existing._id.equals(user._id)) {
    return res.status(409).json({ error: 'Conflict', message: 'That email cannot be used.' });
  }
  const token = randomToken();
  await getPendingEmailChangesCollection().deleteMany({ userId: user._id, confirmedAt: { $exists: false } });
  await getPendingEmailChangesCollection().insertOne({
    _id: new ObjectId(),
    userId: user._id,
    newEmail,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + DAY_MS),
    createdAt: new Date(),
  });
  await sendEmailChangeNotice(user._id, user.email);
  await sendEmailChangeConfirmation(user._id, newEmail, token);
  return res.status(200).json({ success: true, message: 'Check your new email to confirm the change.' });
});

export const confirmEmailChange = asyncHandler(async (req: Request, res: Response) => {
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('This email change link is unavailable.');
  const change = await getPendingEmailChangesCollection().findOne({
    tokenHash: hashToken(parsed.data.token),
    confirmedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  });
  if (!change) throw new ValidationError('This email change link is unavailable.');
  const user = await getUsersCollection().findOne({ _id: change.userId });
  if (!user || user.deactivatedAt) throw new ValidationError('This email change link is unavailable.');
  const existing = await getUsersCollection().findOne({ email: change.newEmail });
  if (existing && !existing._id.equals(user._id)) throw new ValidationError('This email change link is unavailable.');

  await getUsersCollection().updateOne(
    { _id: user._id },
    { $set: { email: change.newEmail, emailVerified: true, updatedAt: new Date() } }
  );
  await getPendingEmailChangesCollection().updateOne({ _id: change._id }, { $set: { confirmedAt: new Date() } });
  await getDeviceSessionsCollection().deleteMany({ userId: user._id });
  await getPasswordResetTokensCollection().deleteMany({ userId: user._id });
  await getEmailVerificationTokensCollection().deleteMany({ userId: user._id });
  await getPendingEmailChangesCollection().deleteMany({ userId: user._id, _id: { $ne: change._id } });
  await sendEmailChangedNotice(user._id, user.email);
  res.clearCookie('refreshToken', getRefreshCookieOptions());
  res.status(200).json({ success: true, requiresLogin: true });
});

export const listSessions = asyncHandler(async (req: Request, res: Response) => {
  const user = await requireUser(req);
  const current = await findCurrentSession(req, user._id);
  const sessions = await getDeviceSessionsCollection()
    .find({ userId: user._id, expiresAt: { $gt: new Date() }, revokedAt: { $exists: false } } as any)
    .sort({ lastActiveAt: -1, createdAt: -1 })
    .toArray();
  res.status(200).json({ sessions: sessions.map((session) => serializeSession(session, current?._id.toString())) });
});

export const revokeSession = asyncHandler(async (req: Request, res: Response) => {
  const user = await requireUser(req);
  if (!ObjectId.isValid(req.params.sessionId)) throw new ValidationError('Invalid session.');
  const current = await findCurrentSession(req, user._id);
  const sessionId = new ObjectId(req.params.sessionId);
  if (current?._id.equals(sessionId)) {
    await getDeviceSessionsCollection().deleteOne({ _id: sessionId, userId: user._id });
    res.clearCookie('refreshToken', getRefreshCookieOptions());
    return res.status(200).json({ success: true, currentRevoked: true });
  }
  const result = await getDeviceSessionsCollection().deleteOne({ _id: sessionId, userId: user._id });
  if (result.deletedCount === 0) return res.status(404).json({ error: 'Not Found', message: 'Session not found' });
  return res.status(200).json({ success: true });
});

export const logoutOtherSessions = asyncHandler(async (req: Request, res: Response) => {
  const user = await requireUser(req);
  const current = await findCurrentSession(req, user._id);
  const query: any = { userId: user._id };
  if (current) query._id = { $ne: current._id };
  const result = await getDeviceSessionsCollection().deleteMany(query);
  res.status(200).json({ success: true, revoked: result.deletedCount });
});

export const requestDataExport = asyncHandler(async (req: Request, res: Response) => {
  const user = await requireUser(req);
  await requireVerified(user);
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Current password is required.');
  await requireRecentAuth(user, parsed.data.currentPassword);
  const recent = await getDataExportsCollection().findOne({ userId: user._id, requestedAt: { $gt: new Date(Date.now() - HOUR_MS) } });
  if (recent) return res.status(429).json({ error: 'Too Many Requests', message: 'Please wait before requesting another export.' });
  const now = new Date();
  const result = await getDataExportsCollection().insertOne({
    _id: new ObjectId(),
    userId: user._id,
    status: 'preparing',
    requestedAt: now,
    expiresAt: new Date(now.getTime() + DAY_MS),
  });
  void new DataExportProcessor().runOnce();
  return res.status(202).json({ export: { id: result.insertedId.toString(), status: 'preparing', requestedAt: now } });
});

export const listDataExports = asyncHandler(async (req: Request, res: Response) => {
  const user = await requireUser(req);
  const exports = await getDataExportsCollection().find({ userId: user._id }).sort({ requestedAt: -1 }).limit(5).toArray();
  res.status(200).json({
    exports: exports.map((item) => ({
      id: item._id.toString(),
      status: item.expiresAt <= new Date() && item.status === 'ready' ? 'expired' : item.status,
      requestedAt: item.requestedAt,
      readyAt: item.readyAt,
      expiresAt: item.expiresAt,
    })),
  });
});

export const downloadDataExport = asyncHandler(async (req: Request, res: Response) => {
  const user = await requireUser(req);
  if (!ObjectId.isValid(req.params.exportId)) throw new ValidationError('Invalid export.');
  const item = await getDataExportsCollection().findOne({
    _id: new ObjectId(req.params.exportId),
    userId: user._id,
    status: 'ready',
    expiresAt: { $gt: new Date() },
  });
  if (!item?.zipData) return res.status(404).json({ error: 'Not Found', message: 'Export unavailable' });
  const zipValue = item.zipData as any;
  const zipBuffer = Buffer.isBuffer(zipValue)
    ? zipValue
    : zipValue?.buffer
      ? Buffer.from(zipValue.buffer)
      : Buffer.from(zipValue);
  res.setHeader('Content-Type', item.contentType || 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${item.fileName || 'blabber-data-export.zip'}"`);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(zipBuffer);
});

export const requestAccountDeletion = asyncHandler(async (req: Request, res: Response) => {
  const user = await requireUser(req);
  await requireVerified(user);
  const parsed = deletionRequestSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Type DELETE and confirm your password to delete your account.');
  await requireRecentAuth(user, parsed.data.currentPassword);
  const now = new Date();
  const scheduledFor = new Date(now.getTime() + DELETE_WINDOW_MS);
  const token = randomToken();
  await getAccountDeletionsCollection().deleteMany({ userId: user._id, status: { $ne: 'finalized' } });
  const result = await getAccountDeletionsCollection().insertOne({
    _id: new ObjectId(),
    userId: user._id,
    status: 'pending',
    requestedAt: now,
    scheduledFor,
    cancelTokenHash: hashToken(token),
    cancelTokenExpiresAt: scheduledFor,
  });
  await getUsersCollection().updateOne({ _id: user._id }, { $set: { deactivatedAt: now, deletionScheduledAt: scheduledFor, updatedAt: now } });
  await getDeviceSessionsCollection().deleteMany({ userId: user._id });
  await sendDeletionRequestedEmail(user._id, user.email, token, scheduledFor);
  res.clearCookie('refreshToken', getRefreshCookieOptions());
  res.status(202).json({ deletion: { id: result.insertedId.toString(), status: 'pending', scheduledFor } });
});

export const getAccountDeletion = asyncHandler(async (req: Request, res: Response) => {
  const user = await requireUser(req);
  const deletion = await getAccountDeletionsCollection().findOne({ userId: user._id, status: 'pending' });
  res.status(200).json({ deletion: deletion ? { status: deletion.status, scheduledFor: deletion.scheduledFor } : null });
});

export const cancelAccountDeletion = asyncHandler(async (req: Request, res: Response) => {
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('This cancellation link is unavailable.');
  const deletion = await getAccountDeletionsCollection().findOne({
    cancelTokenHash: hashToken(parsed.data.token),
    status: 'pending',
    cancelTokenExpiresAt: { $gt: new Date() },
    scheduledFor: { $gt: new Date() },
  });
  if (!deletion) throw new ValidationError('This cancellation link is unavailable.');
  const user = await getUsersCollection().findOne({ _id: deletion.userId });
  if (!user) throw new ValidationError('This cancellation link is unavailable.');
  await getAccountDeletionsCollection().updateOne({ _id: deletion._id }, { $set: { status: 'cancelled', cancelledAt: new Date() } });
  await getUsersCollection().updateOne({ _id: deletion.userId }, { $unset: { deactivatedAt: '', deletionScheduledAt: '' }, $set: { updatedAt: new Date() } });
  await sendDeletionCancelledEmail(user._id, user.email);
  res.status(200).json({ success: true, requiresLogin: true });
});

export const runDeletionWorker = asyncHandler(async (req: Request, res: Response) => {
  if (process.env.ACCOUNT_WORKER_HTTP_ENABLED !== 'true') {
    return res.status(404).json({ error: 'Not Found', message: 'Not found' });
  }
  await requireUser(req);
  const requestedNow = typeof req.body?.now === 'string' ? new Date(req.body.now) : null;
  const now = requestedNow && !Number.isNaN(requestedNow.getTime()) ? requestedNow : new Date();
  const result = await new AccountDeletionProcessor().runOnce(now);
  return res.status(200).json(result);
});

export const getCapturedMailbox = asyncHandler(async (req: Request, res: Response) => {
  if (process.env.ACCOUNT_MAIL_CAPTURE !== 'true') {
    return res.status(404).json({ error: 'Not Found', message: 'Not found' });
  }
  const user = await requireUserIncludingDeactivated(req);
  const messages = await getCapturedEmailsCollection()
    .find({ userId: user._id })
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();
  return res.status(200).json({
    messages: messages.map((message) => ({
      id: message._id.toString(),
      subject: message.subject,
      text: message.text,
      purpose: message.purpose,
      createdAt: message.createdAt,
    })),
  });
});
