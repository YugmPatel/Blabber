import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from './app';

describe('Notifications Service App', () => {
  describe('GET /healthz', () => {
    it('should return 200 with status ok', async () => {
      const response = await request(app).get('/healthz');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: 'ok',
        service: 'notifications',
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
});
