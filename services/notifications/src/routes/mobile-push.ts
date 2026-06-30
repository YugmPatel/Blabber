import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { logger } from '@repo/utils';
import {
  encryptPushToken,
  getMobilePushDevicesCollection,
  hashInstallationId,
  hashPushToken,
  hashVerificationChallenge,
  newVerificationChallenge,
  serializeMobilePushDeviceStatus,
} from '../models/mobile-push-device';
import { sendMobileVerificationPush } from '../mobile-push-provider';
import { getDatabase } from '../db';

const registerSchema = z.object({
  token: z.string().trim().min(20).max(512),
  platform: z.enum(['ios', 'android']),
  installationId: z.string().trim().min(12).max(128),
  appVersion: z.string().trim().max(40).optional(),
});

const verifySchema = z.object({
  installationId: z.string().trim().min(12).max(128),
  challenge: z.string().trim().min(16).max(128),
});

const deregisterSchema = z.object({
  installationId: z.string().trim().min(12).max(128),
});

function userId(req: Request) {
  const raw = (req as any).user?.userId;
  return raw && ObjectId.isValid(raw) ? new ObjectId(raw) : null;
}

async function requireActiveUser(id: ObjectId) {
  return getDatabase().collection('users').findOne({ _id: id, deletedAt: { $exists: false }, deactivatedAt: { $exists: false } });
}

export async function getMobilePushStatus(req: Request, res: Response) {
  const id = userId(req);
  if (!id || !(await requireActiveUser(id))) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  const installationId = typeof req.query.installationId === 'string' ? req.query.installationId : '';
  const installationHash = installationId ? hashInstallationId(installationId) : '';
  const device = installationHash ? await getMobilePushDevicesCollection().findOne({ userId: id, installationHash }) : null;
  return res.status(200).json({ device: serializeMobilePushDeviceStatus(device) });
}

export async function registerMobilePushDevice(req: Request, res: Response) {
  const id = userId(req);
  if (!id || !(await requireActiveUser(id))) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation Error', message: 'Mobile notifications are unavailable.' });

  const now = new Date();
  const tokenHash = hashPushToken(parsed.data.token);
  const installationHash = hashInstallationId(parsed.data.installationId);
  const challenge = newVerificationChallenge();
  const challengeHash = hashVerificationChallenge(challenge);
  const collection = getMobilePushDevicesCollection();

  await collection.updateMany({ $or: [{ tokenHash }, { installationHash }] }, { $set: { disabledAt: now, updatedAt: now } });
  const device = await collection.findOneAndUpdate(
    { tokenHash },
    {
      $set: {
        userId: id,
        encryptedToken: encryptPushToken(parsed.data.token),
        provider: 'expo',
        platform: parsed.data.platform,
        appVersion: parsed.data.appVersion,
        installationHash,
        verificationChallengeHash: challengeHash,
        verificationExpiresAt: new Date(now.getTime() + 10 * 60 * 1000),
        lastSeenAt: now,
        failureCount: 0,
        encryptionKeyVersion: 'v1',
        updatedAt: now,
      },
      $unset: { verifiedAt: '', disabledAt: '' },
      $setOnInsert: { _id: new ObjectId(), createdAt: now },
    },
    { upsert: true, returnDocument: 'after' }
  );
  if (!device) return res.status(503).json({ error: 'Unavailable', message: 'Mobile notifications are unavailable.' });
  await sendMobileVerificationPush(device, challenge).catch((error) => logger.warn({ error: error?.message }, 'Mobile push verification could not be sent'));
  return res.status(202).json({ device: serializeMobilePushDeviceStatus(device) });
}

export async function verifyMobilePushDevice(req: Request, res: Response) {
  const id = userId(req);
  if (!id || !(await requireActiveUser(id))) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation Error', message: 'Mobile notifications are unavailable.' });
  const now = new Date();
  const result = await getMobilePushDevicesCollection().findOneAndUpdate(
    {
      userId: id,
      installationHash: hashInstallationId(parsed.data.installationId),
      verificationChallengeHash: hashVerificationChallenge(parsed.data.challenge),
      verificationExpiresAt: { $gt: now },
      disabledAt: { $exists: false },
    },
    { $set: { verifiedAt: now, lastSeenAt: now, updatedAt: now }, $unset: { verificationChallengeHash: '', verificationExpiresAt: '' } },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(400).json({ error: 'Validation Error', message: 'Mobile notifications are unavailable.' });
  return res.status(200).json({ device: serializeMobilePushDeviceStatus(result) });
}

export async function deregisterMobilePushDevice(req: Request, res: Response) {
  const id = userId(req);
  if (!id) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  const parsed = deregisterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(204).send();
  await getMobilePushDevicesCollection().updateMany(
    { userId: id, installationHash: hashInstallationId(parsed.data.installationId) },
    { $set: { disabledAt: new Date(), updatedAt: new Date() } }
  );
  return res.status(204).send();
}
