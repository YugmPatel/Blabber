import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express, { type Request, type Response } from 'express';
import app from '../app.js';

// Mock services for testing
const mockAuthService = express();
mockAuthService.use(express.json());
mockAuthService.get('/healthz', (req: Request, res: Response) => {
  res.json({ service: 'auth', status: 'ok' });
});
mockAuthService.post('/register', (req: Request, res: Response) => {
  res.status(201).json({ user: { id: '1', username: 'testuser' } });
});

const mockUsersService = express();
mockUsersService.use(express.json());
mockUsersService.get('/:id', (req: Request, res: Response) => {
  res.json({ user: { id: req.params.id, username: 'testuser' } });
});

const mockChatsService = express();
mockChatsService.use(express.json());
mockChatsService.get('/', (req: Request, res: Response) => {
  res.json({ chats: [] });
});

const mockMessagesService = express();
mockMessagesService.use(express.json());
mockMessagesService.get('/:chatId', (req: Request, res: Response) => {
  res.json({ messages: [], chatId: req.params.chatId });
});

const mockMediaService = express();
mockMediaService.use(express.json());
mockMediaService.post('/presign', (req: Request, res: Response) => {
  res.json({ uploadUrl: 'https://s3.example.com/upload', mediaId: '123' });
});

const mockNotificationsService = express();
mockNotificationsService.use(express.json());
mockNotificationsService.post('/push/subscribe', (req: Request, res: Response) => {
  res.json({ success: true });
});

let authServer: any;
let usersServer: any;
let chatsServer: any;
let messagesServer: any;
let mediaServer: any;
let notificationsServer: any;

describe('API Proxy Routes', () => {
  beforeAll(async () => {
    // Start mock services
    authServer = mockAuthService.listen(3001);
    usersServer = mockUsersService.listen(3002);
    chatsServer = mockChatsService.listen(3003);
    messagesServer = mockMessagesService.listen(3004);
    mediaServer = mockMediaService.listen(3005);
    notificationsServer = mockNotificationsService.listen(3006);

    // Wait a bit for servers to start
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(() => {
    // Close all mock services
    authServer?.close();
    usersServer?.close();
    chatsServer?.close();
    messagesServer?.close();
    mediaServer?.close();
    notificationsServer?.close();
  });

  describe('Auth Service Proxy', () => {
    it('should proxy GET /api/auth/healthz to auth service', async () => {
      const response = await request(app).get('/api/auth/healthz');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ service: 'auth', status: 'ok' });
    });

    it('should proxy POST /api/auth/register to auth service', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ username: 'testuser', email: 'test@example.com', password: 'password123' });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('username', 'testuser');
    });
  });

  describe('Users Service Proxy', () => {
    it('should proxy GET /api/users/:id to users service', async () => {
      const response = await request(app).get('/api/users/123');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('id', '123');
    });
  });

  describe('Chats Service Proxy', () => {
    it('should proxy GET /api/chats to chats service', async () => {
      const response = await request(app).get('/api/chats');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('chats');
      expect(Array.isArray(response.body.chats)).toBe(true);
    });
  });

  describe('Messages Service Proxy', () => {
    it('should proxy GET /api/messages/:chatId to messages service', async () => {
      const response = await request(app).get('/api/messages/chat123');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('messages');
      expect(response.body).toHaveProperty('chatId', 'chat123');
    });
  });

  describe('Media Service Proxy', () => {
    it('should proxy POST /api/media/presign to media service', async () => {
      const response = await request(app)
        .post('/api/media/presign')
        .send({ fileName: 'test.jpg', fileType: 'image/jpeg', fileSize: 1024 });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('uploadUrl');
      expect(response.body).toHaveProperty('mediaId');
    });
  });

  describe('Notifications Service Proxy', () => {
    it('should proxy POST /api/notifications/push/subscribe to notifications service', async () => {
      const response = await request(app)
        .post('/api/notifications/push/subscribe')
        .send({ subscription: { endpoint: 'https://example.com' } });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
    });
  });
});
