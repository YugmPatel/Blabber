import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { ObjectId } from 'mongodb';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { getMediaCollection } from '../models/media';
import { scanBuffer } from '../media-scanner';
import { presign, uploadLocalMedia, uploadMultipartMedia } from './presign';

vi.mock('../models/media', () => ({
  getMediaCollection: vi.fn(),
}));

vi.mock('../media-quota', () => ({
  assertUserUploadQuota: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../media-scanner', () => ({
  scanBuffer: vi.fn().mockResolvedValue({ ok: true, mode: 'mock' }),
}));

vi.mock('child_process', async () => {
  const fsPromises = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    execFile: vi.fn((command: string, args: string[], _options: unknown, callback: (error: Error | null, stdout?: string, stderr?: string) => void) => {
      if (command === 'ffprobe') {
        callback(null, JSON.stringify({ streams: [{ width: 1200, height: 900 }] }), '');
        return;
      }
      if (command === 'heif-info') {
        callback(null, 'image: 1200x900', '');
        return;
      }
      if (command === 'heif-convert') {
        const outputPath = args[args.length - 1];
        const jpegBuffer = Buffer.alloc(512, 1);
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(jpegBuffer, 0);
        fsPromises.writeFile(outputPath, jpegBuffer)
          .then(() => callback(null, '', ''))
          .catch((error) => callback(error));
        return;
      }
      if (command === 'ffmpeg') {
        const outputPath = args[args.length - 1];
        const jpegBuffer = Buffer.alloc(512, 1);
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(jpegBuffer, 0);
        fsPromises.writeFile(outputPath, jpegBuffer)
          .then(() => callback(null, '', ''))
          .catch((error) => callback(error));
        return;
      }
      callback(new Error(`Unexpected command ${command}`));
    }),
  };
});

vi.mock('@repo/utils', () => ({
  asyncHandler: (fn: any) => fn,
}));

const userId = '507f1f77bcf86cd799439012';
const otherUserId = '507f1f77bcf86cd799439013';
const genericUploadMessage = 'This file could not be uploaded.';

type StoredMedia = Record<string, any>;

function makePngBuffer(size = 128) {
  const buffer = Buffer.alloc(size, 1);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  return buffer;
}

function makeJpegBuffer(size = 128) {
  const buffer = Buffer.alloc(size, 1);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(buffer, 0);
  return buffer;
}

function makeHeicBuffer(size = 256) {
  const buffer = Buffer.alloc(size, 0);
  buffer.writeUInt32BE(24, 0);
  buffer.write('ftyp', 4, 'ascii');
  buffer.write('heic', 8, 'ascii');
  buffer.write('mif1heic', 16, 'ascii');
  return buffer;
}

function makePdfBuffer(size = 128) {
  const buffer = Buffer.alloc(size, 1);
  buffer.write('%PDF', 0, 'ascii');
  return buffer;
}

function matchesFilter(doc: StoredMedia, filter: StoredMedia) {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = doc[key];
    if (expected && typeof expected === 'object' && '$in' in expected) return expected.$in.includes(actual);
    if (actual instanceof ObjectId && expected instanceof ObjectId) return actual.equals(expected);
    return actual === expected;
  });
}

describe('media local upload contract', () => {
  let app: express.Express;
  let mediaDocs: StoredMedia[];
  let uploadRoot: string;

  beforeEach(async () => {
    mediaDocs = [];
    uploadRoot = await fs.mkdtemp(join(tmpdir(), 'blabber-media-test-'));
    process.env.LOCAL_MEDIA_DIR = uploadRoot;
    process.env.PUBLIC_MEDIA_BASE_URL = 'https://media.test/api/media';
    process.env.LOCAL_MEDIA_UPLOAD_BASE_URL = 'https://media.test/api/media';
    process.env.MEDIA_MESSAGE_TOTAL_BYTES = String(30 * 1024 * 1024);
    process.env.MEDIA_MAX_IMAGE_BYTES = String(10 * 1024 * 1024);
    process.env.MEDIA_MAX_AUDIO_BYTES = String(25 * 1024 * 1024);
    process.env.MEDIA_MAX_DOCUMENT_BYTES = String(25 * 1024 * 1024);
    vi.mocked(scanBuffer).mockResolvedValue({ ok: true, mode: 'mock' });
    vi.mocked(execFile).mockClear();
    vi.mocked(getMediaCollection).mockReturnValue({
      insertOne: vi.fn(async (doc: StoredMedia) => {
        mediaDocs.push({ ...doc });
        return { acknowledged: true, insertedId: doc._id };
      }),
      findOne: vi.fn(async (filter: StoredMedia) => mediaDocs.find((doc) => matchesFilter(doc, filter)) || null),
      updateOne: vi.fn(async (filter: StoredMedia, update: StoredMedia, options?: { upsert?: boolean }) => {
        let doc = mediaDocs.find((candidate) => matchesFilter(candidate, filter));
        if (!doc && options?.upsert) {
          doc = { ...filter, ...(update.$setOnInsert || {}) };
          mediaDocs.push(doc);
        }
        if (doc) Object.assign(doc, update.$set || {});
        return { acknowledged: true, matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 };
      }),
      aggregate: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
    } as any);

    app = express();
    app.use(express.json());
    app.use(express.raw({ type: 'image/*', limit: '50mb' }));
    app.use(express.raw({ type: 'application/pdf', limit: '50mb' }));
    app.use((req: any, _res, next) => {
      req.user = { userId };
      next();
    });
    app.post('/presign', presign);
    app.put('/local/:id', uploadLocalMedia);
    app.post('/multipart', express.raw({ type: 'multipart/form-data', limit: '50mb' }), uploadMultipartMedia);
  });

  it('creates a pending authenticated local upload contract without retired S3 fields', async () => {
    const response = await request(app).post('/presign').send({
      fileName: 'test-image.png',
      fileType: 'image/png',
      fileSize: 1024,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      mediaUrl: expect.stringContaining('/local/'),
      publicUrl: expect.stringContaining('/local/'),
      storage: 'local',
      fileName: 'test-image.png',
      mimeType: 'image/png',
      size: 1024,
      status: 'pending',
      uploadMethod: 'PUT',
      uploadAuthRequired: true,
    });
    expect(response.body).toHaveProperty('mediaId');
    expect(response.body).toHaveProperty('storageKey');
    expect(response.body.uploadUrl).toContain('/local/');
    expect(response.body).not.toHaveProperty('expiresIn');
    expect(response.body.uploadUrl).not.toContain('s3.amazonaws.com');
  });

  it('accepts allowed audio and document metadata at initiation', async () => {
    const audio = await request(app).post('/presign').send({
      fileName: 'test-audio.mp3',
      fileType: 'audio/mpeg',
      fileSize: 5 * 1024 * 1024,
    });
    const document = await request(app).post('/presign').send({
      fileName: 'test-document.pdf',
      fileType: 'application/pdf',
      fileSize: 10 * 1024 * 1024,
    });

    expect(audio.status).toBe(200);
    expect(audio.body.status).toBe('pending');
    expect(document.status).toBe(200);
    expect(document.body.status).toBe('pending');
  });

  it('accepts HEIC metadata at initiation', async () => {
    const response = await request(app).post('/presign').send({
      fileName: 'phone-photo.heic',
      fileType: 'image/heic',
      fileSize: 1024,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      fileName: 'phone-photo.heic',
      mimeType: 'image/heic',
      status: 'pending',
    });
  });

  it('returns generic validation errors for unsupported initiation metadata', async () => {
    const response = await request(app).post('/presign').send({
      fileName: 'test.exe',
      fileType: 'application/x-msdownload',
      fileSize: 1024,
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Validation Error', message: genericUploadMessage });
  });

  it('rejects video metadata from the general message upload initiation contract', async () => {
    const response = await request(app).post('/presign').send({
      fileName: 'ordinary.mp4',
      fileType: 'video/mp4',
      fileSize: 1024,
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(genericUploadMessage);
  });

  it('rejects missing, zero, negative, and total-limit file sizes at initiation', async () => {
    const cases = [
      { fileName: 'test.png', fileType: 'image/png' },
      { fileName: 'test.png', fileType: 'image/png', fileSize: 0 },
      { fileName: 'test.png', fileType: 'image/png', fileSize: -1 },
      { fileName: 'test.png', fileType: 'image/png', fileSize: 31 * 1024 * 1024 },
    ];

    for (const body of cases) {
      const response = await request(app).post('/presign').send(body);
      expect(response.status).toBe(400);
      expect(response.body.message).toBe(genericUploadMessage);
    }
  });

  it('rejects unauthenticated initiation requests', async () => {
    const appNoAuth = express();
    appNoAuth.use(express.json());
    appNoAuth.post('/presign', presign);

    const response = await request(appNoAuth).post('/presign').send({
      fileName: 'test.png',
      fileType: 'image/png',
      fileSize: 1024,
    });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Unauthorized');
  });

  it('approves a matching local PUT upload and stores a normalized JPEG derivative', async () => {
    const init = await request(app).post('/presign').send({
      fileName: 'safe.png',
      fileType: 'image/png',
      fileSize: 1024,
    });

    const upload = await request(app)
      .put(`/local/${init.body.mediaId}`)
      .set('Content-Type', 'image/png')
      .send(makePngBuffer(256));

    expect(upload.status).toBe(200);
    expect(upload.body).toMatchObject({
      mediaId: init.body.mediaId,
      status: 'approved',
      mimeType: 'image/jpeg',
      detectedMimeType: 'image/png',
      fileName: 'safe.jpg',
      size: 512,
      storage: 'local',
    });
    expect(upload.body).not.toHaveProperty('scanResult');
    expect(mediaDocs[0]).toMatchObject({
      fileName: 'safe.jpg',
      fileType: 'image/jpeg',
      detectedFileType: 'image/png',
      fileSize: 512,
      scanResult: 'clean',
    });
  });

  it('accepts JPEG browser MIME aliases and JFIF-style filenames after byte inspection', async () => {
    const init = await request(app).post('/presign').send({
      fileName: 'camera-photo.jfif',
      fileType: 'image/pjpeg',
      fileSize: 1024,
    });

    expect(init.status).toBe(200);

    const upload = await request(app)
      .put(`/local/${init.body.mediaId}`)
      .set('Content-Type', 'image/pjpeg')
      .send(makeJpegBuffer(256));

    expect(upload.status).toBe(200);
    expect(upload.body).toMatchObject({
      mediaId: init.body.mediaId,
      status: 'approved',
      mimeType: 'image/jpeg',
      detectedMimeType: 'image/jpeg',
      fileName: 'camera-photo.jpg',
      size: 512,
      storage: 'local',
    });
  });

  it('normalizes HEIC local PUT uploads to browser-compatible JPEG after scanning original bytes', async () => {
    const init = await request(app).post('/presign').send({
      fileName: 'phone-photo.heic',
      fileType: 'image/heic',
      fileSize: 2048,
    });

    const upload = await request(app)
      .put(`/local/${init.body.mediaId}`)
      .set('Content-Type', 'image/heic')
      .send(makeHeicBuffer(1024));

    expect(upload.status).toBe(200);
    expect(upload.body).toMatchObject({
      mediaId: init.body.mediaId,
      status: 'approved',
      mimeType: 'image/jpeg',
      detectedMimeType: 'image/heic',
      fileName: 'phone-photo.jpg',
      size: 512,
      storage: 'local',
    });
    expect(upload.body).not.toHaveProperty('scanResult');
    expect(scanBuffer).toHaveBeenCalledWith(expect.objectContaining({ length: 1024 }));
    expect(execFile).toHaveBeenCalledWith('heif-info', expect.any(Array), expect.any(Object), expect.any(Function));
    expect(execFile).toHaveBeenCalledWith('heif-convert', expect.any(Array), expect.any(Object), expect.any(Function));
    expect(execFile).toHaveBeenCalledWith('ffprobe', expect.any(Array), expect.any(Object), expect.any(Function));
    expect(execFile).toHaveBeenCalledWith('ffmpeg', expect.any(Array), expect.any(Object), expect.any(Function));
    expect(mediaDocs[0]).toMatchObject({
      fileName: 'phone-photo.jpg',
      fileType: 'image/jpeg',
      detectedFileType: 'image/heic',
      fileSize: 512,
      scanResult: 'clean',
      status: 'approved',
    });
  });

  it('rejects foreign-owned, incomplete, quarantined, deleted, or unknown local upload states', async () => {
    const validId = new ObjectId();
    const rejectedId = new ObjectId();
    const quarantinedId = new ObjectId();
    const deletedId = new ObjectId();
    const otherId = new ObjectId();
    mediaDocs.push(
      { _id: validId, userId: new ObjectId(userId), storage: 'local', status: 'approved', localPath: join(uploadRoot, 'approved.png'), fileName: 'safe.png', fileType: 'image/png', fileSize: 1024, s3Key: 'local/safe.png', url: 'https://media.test/api/media/local/safe', createdAt: new Date() },
      { _id: rejectedId, userId: new ObjectId(userId), storage: 'local', status: 'rejected', localPath: join(uploadRoot, 'rejected.png'), fileName: 'safe.png', fileType: 'image/png', fileSize: 1024, s3Key: 'local/rejected.png', url: 'https://media.test/api/media/local/rejected', createdAt: new Date() },
      { _id: quarantinedId, userId: new ObjectId(userId), storage: 'local', status: 'quarantined', localPath: join(uploadRoot, 'quarantined.png'), fileName: 'safe.png', fileType: 'image/png', fileSize: 1024, s3Key: 'local/quarantined.png', url: 'https://media.test/api/media/local/quarantined', createdAt: new Date() },
      { _id: deletedId, userId: new ObjectId(userId), storage: 'local', status: 'deleted', localPath: join(uploadRoot, 'deleted.png'), fileName: 'safe.png', fileType: 'image/png', fileSize: 1024, s3Key: 'local/deleted.png', url: 'https://media.test/api/media/local/deleted', createdAt: new Date() },
      { _id: otherId, userId: new ObjectId(otherUserId), storage: 'local', status: 'pending', localPath: join(uploadRoot, 'other.png'), fileName: 'safe.png', fileType: 'image/png', fileSize: 1024, s3Key: 'local/other.png', url: 'https://media.test/api/media/local/other', createdAt: new Date() }
    );

    for (const id of [validId, quarantinedId, deletedId, otherId, new ObjectId()]) {
      const response = await request(app).put(`/local/${id.toString()}`).set('Content-Type', 'image/png').send(makePngBuffer());
      expect(response.status).toBe(404);
      expect(response.body.message).toBe(genericUploadMessage);
    }

    const retryRejected = await request(app).put(`/local/${rejectedId.toString()}`).set('Content-Type', 'image/png').send(makePngBuffer());
    expect(retryRejected.status).toBe(200);
    expect(retryRejected.body.status).toBe('approved');
  });

  it('rejects upload bytes that exceed declared size or category limits at upload time', async () => {
    process.env.MEDIA_MAX_IMAGE_BYTES = '64';
    const image = await request(app).post('/presign').send({
      fileName: 'large.png',
      fileType: 'image/png',
      fileSize: 1024,
    });
    const categoryLimit = await request(app)
      .put(`/local/${image.body.mediaId}`)
      .set('Content-Type', 'image/png')
      .send(makePngBuffer(128));

    const document = await request(app).post('/presign').send({
      fileName: 'small.pdf',
      fileType: 'application/pdf',
      fileSize: 32,
    });
    const declaredSize = await request(app)
      .put(`/local/${document.body.mediaId}`)
      .set('Content-Type', 'application/pdf')
      .send(makePdfBuffer(128));

    expect(categoryLimit.status).toBe(400);
    expect(categoryLimit.body.message).toBe(genericUploadMessage);
    expect(declaredSize.status).toBe(400);
    expect(declaredSize.body.message).toBe(genericUploadMessage);
  });

  it('rejects malformed content and scanner failures with generic upload errors', async () => {
    const malformed = await request(app).post('/presign').send({
      fileName: 'safe.png',
      fileType: 'image/png',
      fileSize: 1024,
    });
    const malformedUpload = await request(app)
      .put(`/local/${malformed.body.mediaId}`)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('not a png'));

    const infected = await request(app).post('/presign').send({
      fileName: 'infected.png',
      fileType: 'image/png',
      fileSize: 1024,
    });
    vi.mocked(scanBuffer).mockResolvedValueOnce({ ok: false, mode: 'mock', category: 'infected' });
    const infectedUpload = await request(app)
      .put(`/local/${infected.body.mediaId}`)
      .set('Content-Type', 'image/png')
      .send(makePngBuffer());

    expect(malformedUpload.status).toBe(400);
    expect(malformedUpload.body.message).toBe(genericUploadMessage);
    expect(infectedUpload.status).toBe(400);
    expect(infectedUpload.body.message).toBe(genericUploadMessage);
    expect(mediaDocs.find((doc) => doc._id.toString() === infected.body.mediaId)?.status).toBe('quarantined');
  });

  it('supports direct multipart upload only for the expected file field', async () => {
    const approved = await request(app)
      .post('/multipart')
      .attach('file', makePngBuffer(), { filename: 'direct.png', contentType: 'image/png' });
    const wrongField = await request(app)
      .post('/multipart')
      .attach('upload', makePngBuffer(), { filename: 'direct.png', contentType: 'image/png' });

    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe('approved');
    expect(wrongField.status).toBe(400);
    expect(wrongField.body.message).toBe(genericUploadMessage);
  });
});
