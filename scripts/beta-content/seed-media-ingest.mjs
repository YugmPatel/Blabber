import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const SEED_MEDIA_REGISTRATION_ERROR = 'seed_media_registration_unavailable';

export function assertSeedMediaRegistrationAvailable(env = process.env) {
  if (env.BLABBER_DISABLE_INTERNAL_SEED_MEDIA_INGESTION === '1') {
    throw new Error(SEED_MEDIA_REGISTRATION_ERROR);
  }
  return { ok: true, path: 'internal_seed_media_ingestion' };
}

function safeExtension(fileName) {
  const match = String(fileName || '').toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match?.[1] || '';
}

export function detectSeedImageMime(buffer) {
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function validateSeedImagePolicy({ buffer, fileName, declaredMimeType }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('unsafe_type');
  const extension = safeExtension(fileName);
  const detected = detectSeedImageMime(buffer);
  const declared = String(declaredMimeType || '').split(';')[0].toLowerCase();
  const expected = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : null;
  if (!expected || !detected || expected !== detected) throw new Error('mime_mismatch');
  if (declared && declared !== expected) throw new Error('mime_mismatch');
  return { category: 'image', mimeType: expected, extension };
}

export function validateSeedReelUploadPolicy({ buffer, fileName, declaredMimeType }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('unsafe_type');
  if (safeExtension(fileName) !== '.mp4') throw new Error('unsafe_type');
  if (String(declaredMimeType || '').split(';')[0].toLowerCase() !== 'video/mp4') throw new Error('mime_mismatch');
  if (buffer.length < 12 || buffer.toString('ascii', 4, 8) !== 'ftyp') throw new Error('mime_mismatch');
  return { category: 'video', mimeType: 'video/mp4', extension: '.mp4' };
}

async function defaultScanBuffer(buffer) {
  if (existsSync('/app/services/media/dist/media-scanner.js')) {
    const module = await import('file:///app/services/media/dist/media-scanner.js');
    return module.scanBuffer(buffer);
  }
  if (buffer.includes(Buffer.from('EICAR')) || buffer.includes(Buffer.from('BLABBER_MOCK_MALWARE'))) {
    return { ok: false, mode: 'mock', category: 'infected' };
  }
  return { ok: true, mode: 'mock' };
}

export async function approveSeedImageMedia(db, { mediaId, userId, localPath, fileName, s3Key, url, buffer, importer, now, scanBuffer = defaultScanBuffer, mkdir = mkdirSync, writeFile = writeFileSync }) {
  assertSeedMediaRegistrationAvailable();
  const policy = validateSeedImagePolicy({ buffer, fileName, declaredMimeType: 'image/jpeg' });
  const scan = await scanBuffer(buffer);
  if (!scan.ok) throw new Error(scan.category === 'infected' ? 'malware_detected' : 'scanner_unavailable');
  mkdir(dirname(localPath), { recursive: true });
  writeFile(localPath, buffer);
  await db.collection('media').updateOne(
    { _id: mediaId },
    {
      $setOnInsert: { _id: mediaId, createdAt: now },
      $set: {
        userId,
        fileName,
        originalFileName: fileName,
        fileType: policy.mimeType,
        detectedFileType: policy.mimeType,
        fileSize: buffer.length,
        s3Key,
        url,
        storage: 'local',
        localPath,
        status: 'approved',
        purpose: 'general',
        scanMode: scan.mode,
        scanResult: 'clean',
        uploadedAt: now,
        approvedAt: now,
        importer,
        updatedAt: now,
      },
      $unset: { scanErrorCategory: '', rejectedAt: '', quarantinedAt: '' },
    },
    { upsert: true }
  );
}

export async function approveSeedReelSource(db, { mediaId, reelId, userId, localPath, fileName, s3Key, buffer, importer, now, scanBuffer = defaultScanBuffer, mkdir = mkdirSync, writeFile = writeFileSync }) {
  assertSeedMediaRegistrationAvailable();
  const policy = validateSeedReelUploadPolicy({ buffer, fileName, declaredMimeType: 'video/mp4' });
  const scan = await scanBuffer(buffer);
  if (!scan.ok) {
    await db.collection('reels').updateOne({ _id: reelId }, { $set: { processingStatus: 'rejected', validationFailureCategory: scan.category, updatedAt: now } });
    throw new Error(scan.category === 'infected' ? 'malware_detected' : 'scanner_unavailable');
  }
  mkdir(dirname(localPath), { recursive: true });
  writeFile(localPath, buffer);
  await db.collection('media').updateOne(
    { _id: mediaId },
    {
      $setOnInsert: { _id: mediaId, createdAt: now },
      $set: {
        userId,
        fileName,
        originalFileName: fileName,
        fileType: policy.mimeType,
        detectedFileType: policy.mimeType,
        fileSize: buffer.length,
        s3Key,
        url: '',
        storage: 'local',
        localPath,
        status: 'approved',
        purpose: 'reel_source',
        reelId,
        scanMode: scan.mode,
        scanResult: 'clean',
        uploadedAt: now,
        approvedAt: now,
        importer,
        updatedAt: now,
      },
      $unset: { scanErrorCategory: '', rejectedAt: '', quarantinedAt: '' },
    },
    { upsert: true }
  );
  await db.collection('reels').updateOne({ _id: reelId, processingStatus: 'upload_initiated' }, { $set: { processingStatus: 'uploaded', updatedAt: now } });
}
