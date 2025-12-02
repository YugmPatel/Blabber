import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from './app.js';

describe('Gateway App', () => {
  describe('GET /healthz', () => {
    it('should return 200 with status ok', async () => {
      const response = await request(app).get('/healthz');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should return a valid ISO timestamp', async () => {
      const response = await request(app).get('/healthz');

      expect(response.status).toBe(200);
      const timestamp = new Date(response.body.timestamp);
      expect(timestamp.toString()).not.toBe('Invalid Date');
    });
  });
});
