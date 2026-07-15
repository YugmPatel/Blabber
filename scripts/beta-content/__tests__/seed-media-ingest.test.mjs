import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { assertApplyMediaPreflight, isFatalSeedMediaRegistrationError } from '../apply.mjs';
import {
  approveSeedReelSource,
  assertSeedMediaRegistrationAvailable,
  validateSeedImagePolicy,
  validateSeedReelUploadPolicy,
} from '../seed-media-ingest.mjs';

function tinyJpeg() {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
}

function tinyMp4() {
  const buffer = Buffer.alloc(24);
  buffer.writeUInt32BE(24, 0);
  buffer.write('ftyp', 4, 'ascii');
  buffer.write('isom', 8, 'ascii');
  return buffer;
}

function fakeDb() {
  const calls = [];
  return {
    calls,
    collection(name) {
      return {
        updateOne: async (...args) => {
          calls.push({ name, op: 'updateOne', args });
          return { acknowledged: true };
        },
      };
    },
  };
}

describe('seed media registration preflight', () => {
  it('fails early when internal media registration is disabled/misconfigured', () => {
    expect(() => assertSeedMediaRegistrationAvailable({ BLABBER_DISABLE_INTERNAL_SEED_MEDIA_INGESTION: '1' })).toThrow('seed_media_registration_unavailable');
    expect(() => assertApplyMediaPreflight({ env: { BLABBER_DISABLE_INTERNAL_SEED_MEDIA_INGESTION: '1' }, ffmpegAvailable: true })).toThrow('seed_media_registration_unavailable');
  });

  it('classifies 401 as a fatal registration/configuration error', () => {
    expect(isFatalSeedMediaRegistrationError('reel_video_upload_rejected_401')).toBe(true);
    expect(isFatalSeedMediaRegistrationError('seed_media_registration_unavailable')).toBe(true);
    expect(isFatalSeedMediaRegistrationError('unsupported_stream')).toBe(false);
  });
});

describe('generated card/reel policy preflight', () => {
  it('accepts generated post cards with valid .jpg extension and image/jpeg content type', () => {
    expect(validateSeedImagePolicy({ buffer: tinyJpeg(), fileName: 'beta-card-blabber-001.jpg', declaredMimeType: 'image/jpeg' })).toMatchObject({
      category: 'image',
      mimeType: 'image/jpeg',
      extension: '.jpg',
    });
  });

  it('rejects generated post cards with missing extension before apply', () => {
    expect(() => validateSeedImagePolicy({ buffer: tinyJpeg(), fileName: 'beta-card-blabber-001', declaredMimeType: 'image/jpeg' })).toThrow('mime_mismatch');
  });

  it('accepts generated fallback reels as mp4 seed uploads', () => {
    expect(validateSeedReelUploadPolicy({ buffer: tinyMp4(), fileName: 'beta-reel-blabber-001.mp4', declaredMimeType: 'video/mp4' })).toMatchObject({
      category: 'video',
      mimeType: 'video/mp4',
      extension: '.mp4',
    });
  });
});

describe('internal seed reel ingestion path', () => {
  it('registers reel media internally without requiring a user JWT or returning 401', async () => {
    const db = fakeDb();
    const mediaId = new ObjectId();
    const reelId = new ObjectId();
    const userId = new ObjectId();
    await approveSeedReelSource(db, {
      mediaId,
      reelId,
      userId,
      localPath: `/tmp/${mediaId.toString()}.mp4`,
      fileName: 'beta-reel-test-001.mp4',
      s3Key: `beta-content/reels/${mediaId}.mp4`,
      buffer: tinyMp4(),
      importer: { source: 'generated' },
      now: new Date(),
      scanBuffer: async () => ({ ok: true, mode: 'mock' }),
      mkdir: () => undefined,
      writeFile: () => undefined,
    });

    expect(db.calls.some((call) => call.name === 'media' && call.op === 'updateOne')).toBe(true);
    expect(db.calls.some((call) => call.name === 'reels' && call.op === 'updateOne')).toBe(true);
  });
});
