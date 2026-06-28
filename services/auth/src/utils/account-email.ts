import { ObjectId } from 'mongodb';
import { logger } from '@repo/utils';
import { sendEmail } from './email';
import { getCapturedEmailsCollection, hashEmail } from '../models/account-security';

const DAY_MS = 24 * 60 * 60 * 1000;

function appBaseUrl() {
  return (process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
}

async function captureEmail(params: {
  userId?: ObjectId;
  to: string;
  subject: string;
  text: string;
  purpose: string;
}) {
  if (process.env.ACCOUNT_MAIL_CAPTURE !== 'true' && process.env.NODE_ENV === 'production') return;
  await getCapturedEmailsCollection().insertOne({
    _id: new ObjectId(),
    userId: params.userId,
    toHash: hashEmail(params.to),
    subject: params.subject,
    text: params.text,
    purpose: params.purpose,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + DAY_MS),
  });
}

async function sendAccountEmail(params: {
  userId?: ObjectId;
  to: string;
  subject: string;
  text: string;
  purpose: string;
}) {
  await captureEmail(params);
  const sent = await sendEmail({ to: params.to, subject: params.subject, text: params.text });
  logger.info(
    {
      event: 'account_email.queued',
      userId: params.userId?.toString(),
      purpose: params.purpose,
      sent,
    },
    'Account email processed'
  );
  return sent;
}

export function emailVerificationUrl(token: string) {
  return `${appBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`;
}

export function emailChangeUrl(token: string) {
  return `${appBaseUrl()}/change-email/confirm?token=${encodeURIComponent(token)}`;
}

export function deletionCancelUrl(token: string) {
  return `${appBaseUrl()}/account-deletion/cancel?token=${encodeURIComponent(token)}`;
}

export async function sendVerifyEmail(userId: ObjectId, to: string, token: string) {
  return sendAccountEmail({
    userId,
    to,
    purpose: 'email_verification',
    subject: 'Verify your Blabber email',
    text: [
      'Verify your Blabber email address.',
      '',
      `Open this link to verify your email: ${emailVerificationUrl(token)}`,
      '',
      'This link expires in 24 hours. If you did not create this account, you can ignore this email.',
    ].join('\n'),
  });
}

export async function sendEmailChangeNotice(userId: ObjectId, to: string) {
  return sendAccountEmail({
    userId,
    to,
    purpose: 'email_change_notice',
    subject: 'Blabber email change requested',
    text: 'A change to your Blabber account email was requested. If this was not you, secure your account.',
  });
}

export async function sendEmailChangeConfirmation(userId: ObjectId, to: string, token: string) {
  return sendAccountEmail({
    userId,
    to,
    purpose: 'email_change_confirmation',
    subject: 'Confirm your new Blabber email',
    text: [
      'Confirm this new email address for your Blabber account.',
      '',
      `Open this link to confirm the change: ${emailChangeUrl(token)}`,
      '',
      'This link expires in 24 hours.',
    ].join('\n'),
  });
}

export async function sendEmailChangedNotice(userId: ObjectId, to: string) {
  return sendAccountEmail({
    userId,
    to,
    purpose: 'email_changed_notice',
    subject: 'Your Blabber email was changed',
    text: 'Your Blabber account email was changed. All sessions were signed out.',
  });
}

export async function sendExportReadyEmail(userId: ObjectId, to: string) {
  return sendAccountEmail({
    userId,
    to,
    purpose: 'data_export_ready',
    subject: 'Your Blabber data export is ready',
    text: 'Your Blabber data export is ready in Settings. The download expires in 24 hours.',
  });
}

export async function sendDeletionRequestedEmail(userId: ObjectId, to: string, token: string, scheduledFor: Date) {
  return sendAccountEmail({
    userId,
    to,
    purpose: 'account_deletion_requested',
    subject: 'Blabber account deletion requested',
    text: [
      'Your Blabber account has been deactivated and is scheduled for deletion.',
      `Scheduled deletion: ${scheduledFor.toISOString()}`,
      '',
      `Open this link before then to cancel deletion: ${deletionCancelUrl(token)}`,
    ].join('\n'),
  });
}

export async function sendDeletionCancelledEmail(userId: ObjectId, to: string) {
  return sendAccountEmail({
    userId,
    to,
    purpose: 'account_deletion_cancelled',
    subject: 'Blabber account deletion cancelled',
    text: 'Your Blabber account deletion request was cancelled. Sign in again to continue using Blabber.',
  });
}
