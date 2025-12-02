import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

// Create mock Redis client
const mockRedisClient = {
  get: vi.fn(),
  setex: vi.fn(),
};

// Mock axios
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

// Mock Redis
vi.mock('../redis', () => ({
  getRedisClient: vi.fn(() => mockRedisClient),
}));

// Mock utils
vi.mock('@repo/utils', () => ({
  asyncHandler: (fn: any) => fn,
}));

import axios from 'axios';
import { linkPreview } from './link-preview';

describe('GET /link-preview', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.get('/link-preview', linkPreview);

    // Reset mocks
    mockRedisClient.get.mockReset();
    mockRedisClient.setex.mockReset();
    vi.mocked(axios.get).mockReset();
  });

  it('should return link preview with OpenGraph tags', async () => {
    const mockHtml = `
      <html>
        <head>
          <meta property="og:title" content="Example Title" />
          <meta property="og:description" content="Example Description" />
          <meta property="og:image" content="https://example.com/image.jpg" />
        </head>
      </html>
    `;

    mockRedisClient.get.mockResolvedValue(null);
    vi.mocked(axios.get).mockResolvedValue({ data: mockHtml } as any);

    const response = await request(app).get('/link-preview').query({ url: 'https://example.com' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      title: 'Example Title',
      description: 'Example Description',
      image: 'https://example.com/image.jpg',
      url: 'https://example.com',
    });

    expect(mockRedisClient.setex).toHaveBeenCalledWith(
      expect.stringContaining('link-preview:'),
      24 * 60 * 60,
      expect.any(String)
    );
  });

  it('should return link preview with Twitter Card tags', async () => {
    const mockHtml = `
      <html>
        <head>
          <meta name="twitter:title" content="Twitter Title" />
          <meta name="twitter:description" content="Twitter Description" />
          <meta name="twitter:image" content="https://example.com/twitter-image.jpg" />
        </head>
      </html>
    `;

    mockRedisClient.get.mockResolvedValue(null);
    vi.mocked(axios.get).mockResolvedValue({ data: mockHtml } as any);

    const response = await request(app).get('/link-preview').query({ url: 'https://example.com' });

    expect(response.status).toBe(200);
    expect(response.body.title).toBe('Twitter Title');
    expect(response.body.description).toBe('Twitter Description');
    expect(response.body.image).toBe('https://example.com/twitter-image.jpg');
  });

  it('should fallback to standard HTML tags', async () => {
    const mockHtml = `
      <html>
        <head>
          <title>HTML Title</title>
          <meta name="description" content="HTML Description" />
        </head>
      </html>
    `;

    mockRedisClient.get.mockResolvedValue(null);
    vi.mocked(axios.get).mockResolvedValue({ data: mockHtml } as any);

    const response = await request(app).get('/link-preview').query({ url: 'https://example.com' });

    expect(response.status).toBe(200);
    expect(response.body.title).toBe('HTML Title');
    expect(response.body.description).toBe('HTML Description');
  });

  it('should convert relative image URLs to absolute', async () => {
    const mockHtml = `
      <html>
        <head>
          <meta property="og:title" content="Test" />
          <meta property="og:image" content="/images/test.jpg" />
        </head>
      </html>
    `;

    mockRedisClient.get.mockResolvedValue(null);
    vi.mocked(axios.get).mockResolvedValue({ data: mockHtml } as any);

    const response = await request(app)
      .get('/link-preview')
      .query({ url: 'https://example.com/page' });

    expect(response.status).toBe(200);
    expect(response.body.image).toBe('https://example.com/images/test.jpg');
  });

  it('should return cached data from Redis', async () => {
    const cachedData = {
      title: 'Cached Title',
      description: 'Cached Description',
      image: 'https://example.com/cached.jpg',
      url: 'https://example.com',
    };

    mockRedisClient.get.mockResolvedValue(JSON.stringify(cachedData));

    const response = await request(app).get('/link-preview').query({ url: 'https://example.com' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(cachedData);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('should reject invalid URL', async () => {
    const response = await request(app).get('/link-preview').query({ url: 'not-a-valid-url' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
    expect(response.body.message).toContain('must be a valid URL');
  });

  it('should reject missing URL parameter', async () => {
    const response = await request(app).get('/link-preview');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Validation Error');
  });

  it('should handle fetch errors gracefully', async () => {
    mockRedisClient.get.mockResolvedValue(null);
    vi.mocked(axios.get).mockRejectedValue(new Error('Network error'));

    const response = await request(app).get('/link-preview').query({ url: 'https://example.com' });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Link Preview Error');
    expect(response.body.message).toContain('Failed to fetch link preview');
  });

  it('should handle timeout errors', async () => {
    mockRedisClient.get.mockResolvedValue(null);
    vi.mocked(axios.get).mockRejectedValue({ code: 'ECONNABORTED', message: 'timeout' });

    const response = await request(app)
      .get('/link-preview')
      .query({ url: 'https://slow-site.com' });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('Link Preview Error');
  });

  it('should handle protocol-relative image URLs', async () => {
    const mockHtml = `
      <html>
        <head>
          <meta property="og:title" content="Test" />
          <meta property="og:image" content="//cdn.example.com/image.jpg" />
        </head>
      </html>
    `;

    mockRedisClient.get.mockResolvedValue(null);
    vi.mocked(axios.get).mockResolvedValue({ data: mockHtml } as any);

    const response = await request(app).get('/link-preview').query({ url: 'https://example.com' });

    expect(response.status).toBe(200);
    expect(response.body.image).toBe('https://cdn.example.com/image.jpg');
  });

  it('should trim whitespace from extracted data', async () => {
    const mockHtml = `
      <html>
        <head>
          <meta property="og:title" content="  Title with spaces  " />
          <meta property="og:description" content="  Description with spaces  " />
        </head>
      </html>
    `;

    mockRedisClient.get.mockResolvedValue(null);
    vi.mocked(axios.get).mockResolvedValue({ data: mockHtml } as any);

    const response = await request(app).get('/link-preview').query({ url: 'https://example.com' });

    expect(response.status).toBe(200);
    expect(response.body.title).toBe('Title with spaces');
    expect(response.body.description).toBe('Description with spaces');
  });
});
