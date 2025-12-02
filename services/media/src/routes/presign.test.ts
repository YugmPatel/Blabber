import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { presign } from './presign';

// Mock AWS SDK
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
  PutObjectCommand: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/test-bucket/presigned-url'),
}));

// Mock database
vi.mock('../models/media', () => ({
  getMediaCollection: vi.fn().mockReturnValue({
    insertOne: vi.fn().mockResolvedValue({
      insertedId: { toString: () => '507f1f77bcf86cd799439011' },
    }),
  }),
}));

// Mock config
vi.mock('@repo/config', () => ({
  loadS3Config: vi.fn().mockReturnValue({
    S3_MEDIA_BUCKET: 'test-bucket',
    S3_REGION: 'us-east-1',
    MEDIA_BASE_URL: 'https://test.cloudfront.net',
  }),
}));

// Mock utils
vi.mock('@repo/utils', () => ({
  asyncHandler: (fn: any) => fn,
}));

describe('POST /presign', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Mock auth middleware
    app.use((req: any, _res, next) => {
      req.user = { userId: '507f1f77bcf86cd799439012' };
      next();
    });

    app.post('/presign', presign);
  });

  it('should generate presigned URL for valid image upload', async () => {
    const response = await request(app).post('/presign').send({
      fileName: 'test-image.jpg',
      fileType: 'image/jpeg',
      fileSize: 1024000, // 1MB
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('uploadUrl');
    expect(response.body).toHaveProperty('mediaId');
    expect(response.body).toHaveProperty('expiresIn', 300);
    expect(response.body.uploadUrl).toContain('s3.amazonaws.com');
  });

  it('should generate presigned URL for valid audio upload', async () => {
    const response = await request(app)
      .post('/presign')
      .send({
        fileName: 'test-audio.mp3',
        fileType: 'audio/mpeg',
        fileSize: 5 * 1024 * 1024, // 5MB
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('uploadUrl');
    expect(response.body).toHaveProperty('mediaId');
  });

  it('should generate presigned URL for valid document upload', async () => {
    const response = await request(app)
      .post('/presign')
      .send({
        fileName: 'test-document.pdf',
        fileType: 'application/pdf',
        fileSize: 10 * 1024 * 1024, // 10MB
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('uploadUrl');
    expect(response.body).toHaveProperty('mediaId');
  });

  it('should reject invalid file type', async () => {
    const response = await request(app).post('/presign').send({
      fileName: 'test.exe',
      fileType: 'application/x-msdownload',
      fileSize: 1024000,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
    expect(response.body.message).toContain('File type must be one of');
  });

  it('should reject image exceeding size limit', async () => {
    const response = await request(app)
      .post('/presign')
      .send({
        fileName: 'large-image.jpg',
        fileType: 'image/jpeg',
        fileSize: 15 * 1024 * 1024, // 15MB (exceeds 10MB limit)
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
    expect(response.body.message).toContain('exceeds maximum allowed size');
  });

  it('should reject audio exceeding size limit', async () => {
    const response = await request(app)
      .post('/presign')
      .send({
        fileName: 'large-audio.mp3',
        fileType: 'audio/mpeg',
        fileSize: 25 * 1024 * 1024, // 25MB (exceeds 20MB limit)
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
    expect(response.body.message).toContain('exceeds maximum allowed size');
  });

  it('should reject document exceeding size limit', async () => {
    const response = await request(app)
      .post('/presign')
      .send({
        fileName: 'large-document.pdf',
        fileType: 'application/pdf',
        fileSize: 60 * 1024 * 1024, // 60MB (exceeds 50MB limit)
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
    expect(response.body.message).toContain('exceeds maximum allowed size');
  });

  it('should reject missing fileName', async () => {
    const response = await request(app).post('/presign').send({
      fileType: 'image/jpeg',
      fileSize: 1024000,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
  });

  it('should reject missing fileType', async () => {
    const response = await request(app).post('/presign').send({
      fileName: 'test.jpg',
      fileSize: 1024000,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
  });

  it('should reject missing fileSize', async () => {
    const response = await request(app).post('/presign').send({
      fileName: 'test.jpg',
      fileType: 'image/jpeg',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
  });

  it('should reject negative fileSize', async () => {
    const response = await request(app).post('/presign').send({
      fileName: 'test.jpg',
      fileType: 'image/jpeg',
      fileSize: -1000,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
  });

  it('should reject request without authentication', async () => {
    const appNoAuth = express();
    appNoAuth.use(express.json());
    appNoAuth.post('/presign', presign);

    const response = await request(appNoAuth).post('/presign').send({
      fileName: 'test.jpg',
      fileType: 'image/jpeg',
      fileSize: 1024000,
    });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Unauthorized');
  });
});
