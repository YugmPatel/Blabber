import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from './app';

describe('Media Service App', () => {
  describe('GET /healthz', () => {
    it('should return health check status', async () => {
      const response = await request(app).get('/healthz');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: 'ok',
        service: 'media',
      });
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('404 handler', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app).get('/unknown-route');

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        error: 'Not Found',
        message: 'Route GET /unknown-route not found',
      });
    });
  });

  describe('structured body limits', () => {
    it('returns a safe oversized JSON error before route handling', async () => {
      const response = await request(app)
        .post('/reels/upload-init')
        .set('Content-Type', 'application/json')
        .send({ payload: 'x'.repeat(300 * 1024) });

      expect(response.status).toBe(413);
      expect(response.body.error).toBe('PayloadTooLargeError');
      expect(response.body.message).not.toContain('256');
    });

    it('returns a safe oversized URL-encoded error before route handling', async () => {
      const response = await request(app)
        .post('/reels/upload-init')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`payload=${'x'.repeat(300 * 1024)}`);

      expect(response.status).toBe(413);
      expect(response.body.error).toBe('PayloadTooLargeError');
      expect(response.body.message).not.toContain('256');
    });
  });
});
