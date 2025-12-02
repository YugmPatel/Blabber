import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from './app';

describe('Messages Service App', () => {
  describe('GET /healthz', () => {
    it('should return health check status', async () => {
      const response = await request(app).get('/healthz');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: 'ok',
        service: 'messages',
      });
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('404 handler', () => {
    it('should return 404 for unknown PUT routes', async () => {
      const response = await request(app).put('/unknown-route');

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        error: 'Not Found',
        message: 'Route PUT /unknown-route not found',
      });
    });
  });
});
