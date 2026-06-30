import { ObjectId } from 'mongodb';
import { logger } from '@repo/utils';
import { getDatabase } from './db';
import { decryptPushToken, MobilePushDevice } from './models/mobile-push-device';

export type MobilePushPayload = {
  kind: string;
  notificationRef?: string;
  schema: 'blabber.mobile_push.v1';
};

export type MobilePushDeliveryResult = 'delivered' | 'temporary_failure' | 'invalid_token';

export async function sendMobileVerificationPush(device: MobilePushDevice, challenge: string) {
  if (process.env.MOBILE_PUSH_PROVIDER_MODE === 'fake') {
    await getFakeDeliveries().insertOne({
      _id: new ObjectId(),
      deviceId: device._id,
      userId: device.userId,
      kind: 'verification',
      challenge,
      createdAt: new Date(),
    });
    return;
  }
  logger.info({ deviceId: device._id.toString() }, 'Mobile push verification is pending provider configuration');
}

export async function sendMobilePush(device: MobilePushDevice, payload: MobilePushPayload): Promise<MobilePushDeliveryResult> {
  const token = decryptPushToken(device.encryptedToken);
  if (process.env.MOBILE_PUSH_PROVIDER_MODE === 'fake') {
    if (token.includes('invalid')) return 'invalid_token';
    if (token.includes('temporary')) return 'temporary_failure';
    await getFakeDeliveries().insertOne({
      _id: new ObjectId(),
      deviceId: device._id,
      userId: device.userId,
      kind: payload.kind,
      notificationRef: payload.notificationRef || null,
      schema: payload.schema,
      createdAt: new Date(),
    });
    return 'delivered';
  }
  return 'temporary_failure';
}

function getFakeDeliveries() {
  // Local deterministic adapter only. Documents intentionally omit raw provider token and payload text.
  return getDatabase().collection('mobile_push_fake_deliveries');
}
