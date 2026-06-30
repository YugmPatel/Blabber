import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'crypto';
import { Collection, ObjectId } from 'mongodb';
import { getDatabase } from '../db';

export type MobilePushPlatform = 'ios' | 'android';
export type MobilePushProvider = 'expo';

export interface MobilePushDevice {
  _id: ObjectId;
  userId: ObjectId;
  tokenHash: string;
  encryptedToken: string;
  provider: MobilePushProvider;
  platform: MobilePushPlatform;
  appVersion?: string;
  installationHash: string;
  verificationChallengeHash?: string;
  verificationExpiresAt?: Date;
  verifiedAt?: Date;
  lastSeenAt: Date;
  disabledAt?: Date;
  failureCount: number;
  encryptionKeyVersion: string;
  createdAt: Date;
  updatedAt: Date;
}

const KEY_VERSION = 'v1';

export function getMobilePushDevicesCollection(): Collection<MobilePushDevice> {
  return getDatabase().collection<MobilePushDevice>('mobile_push_devices');
}

export async function createMobilePushDeviceIndexes() {
  const collection = getMobilePushDevicesCollection();
  await collection.createIndex({ userId: 1, disabledAt: 1, verifiedAt: 1 });
  await collection.createIndex({ tokenHash: 1 }, { unique: true });
  await collection.createIndex({ installationHash: 1 });
  await collection.createIndex({ verificationExpiresAt: 1 }, { expireAfterSeconds: 0 });
}

function encryptionKey() {
  const raw = process.env.MOBILE_PUSH_TOKEN_ENCRYPTION_KEY || process.env.JWT_ACCESS_SECRET || '';
  if (raw.length < 32) throw new Error('MOBILE_PUSH_TOKEN_ENCRYPTION_KEY must be configured');
  return createHash('sha256').update(raw).digest();
}

export function hashPushToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function hashInstallationId(installationId: string) {
  return createHash('sha256').update(installationId).digest('hex');
}

export function hashVerificationChallenge(challenge: string) {
  return createHash('sha256').update(challenge).digest('hex');
}

export function encryptPushToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${KEY_VERSION}:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decryptPushToken(value: string) {
  const [version, iv, tag, ciphertext] = value.split(':');
  if (version !== KEY_VERSION || !iv || !tag || !ciphertext) throw new Error('invalid_encrypted_token');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

export function newVerificationChallenge() {
  return randomUUID().replace(/-/g, '') + randomBytes(8).toString('hex');
}

export function serializeMobilePushDeviceStatus(device: MobilePushDevice | null) {
  if (!device || device.disabledAt) return { state: 'not_enabled' as const };
  if (!device.verifiedAt) return { state: 'verifying_device' as const };
  return { state: 'enabled' as const, verifiedAt: device.verifiedAt };
}
