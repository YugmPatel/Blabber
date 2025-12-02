import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'http';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import express from 'express';
import axios from 'axios';
import app from '../app.js';
import { setupSocketIO } from './index.js';
import type { Server as SocketIOServer } from 'socket.io';

// Mock axios
vi.mock('axios');
const mockedAxios = axios as any;

describe('Socket.io Client Events', () => {
  let httpServer: any;
  let io: SocketIOServer;
  const PORT = 3103;
  const JWT_SECRET = 'test-secret-key';
  const TEST_USER_ID = 'user123';
  let validToken: string;

  // Mock services
  let mockMessagesService: any;
  let mockChatsService: any;

  beforeAll(async () => {
    // Set JWT secret for testing
    process.env.JWT_ACCESS_SECRET = JWT_SECRET;

    // Set service URLs for testing
    process.env.MESSAGES_SERVICE_URL = 'http://localhost:4001';
    process.env.CHATS_SERVICE_URL = 'http://localhost:4002';

    // Generate valid token
    validToken = jwt.sign({ userId: TEST_USER_ID }, JWT_SECRET, { expiresIn: '15m' });

    // Start mock services
    const mockMessagesApp = express();
    mockMessagesApp.use(express.json());
    mockMessagesApp.post('/:chatId', (req, res) => {
      res.json({
        message: {
          _id: 'msg123',
          chatId: req.params.chatId,
          senderId: req.headers['x-user-id'],
          body: req.body.body,
          createdAt: new Date().toISOString(),
        },
      });
    });
    mockMessagesApp.post('/:messageId/read', (req, res) => {
      res.json({ success: true });
    });
    mockMessagesApp.post('/:messageId/react', (req, res) => {
      res.json({
        message: {
          _id: req.params.messageId,
          reactions: [{ userId: req.headers['x-user-id'], emoji: req.body.emoji }],
        },
      });
    });
    mockMessagesService = mockMessagesApp.listen(4001);

    const mockChatsApp = express();
    mockChatsApp.use(express.json());
    mockChatsApp.post('/', (req, res) => {
      res.json({
        chat: {
          _id: 'chat123',
          type: req.body.type,
          participants: req.body.participantIds,
          createdAt: new Date().toISOString(),
        },
      });
    });
    mockChatsService = mockChatsApp.listen(4002);

    // Wait for mock services to start
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Create HTTP server
    httpServer = createServer(app);

    // Set up Socket.io
    io = await setupSocketIO(httpServer);

    // Start server
    await new Promise<void>((resolve) => {
      httpServer.listen(PORT, () => {
        resolve();
      });
    });
  });

  afterAll(async () => {
    // Close mock services
    mockMessagesService?.close();
    mockChatsService?.close();

    // Close Socket.io server
    await new Promise<void>((resolve) => {
      io.close(() => {
        resolve();
      });
    });

    // Close HTTP server
    await new Promise<void>((resolve) => {
      httpServer.close(() => {
        resolve();
      });
    });

    // Clean up env
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.MESSAGES_SERVICE_URL;
    delete process.env.CHATS_SERVICE_URL;
  });

  it('should handle auth:hello event', async () => {
    return new Promise<void>((resolve, reject) => {
      const clientSocket = ioClient(`http://localhost:${PORT}`, {
        transports: ['websocket'],
        auth: {
          token: validToken,
        },
      });

      clientSocket.on('connect', () => {
        clientSocket.on('auth:welcome', (data) => {
          expect(data.userId).toBe(TEST_USER_ID);
          expect(data.socketId).toBeDefined();
          expect(data.timestamp).toBeDefined();
          clientSocket.disconnect();
          resolve();
        });

        clientSocket.emit('auth:hello');
      });

      clientSocket.on('connect_error', (error) => {
        clientSocket.disconnect();
        reject(error);
      });

      setTimeout(() => {
        clientSocket.disconnect();
        reject(new Error('auth:hello test timeout'));
      }, 5000);
    });
  });

  it('should handle message:send event', async () => {
    return new Promise<void>((resolve, reject) => {
      const clientSocket = ioClient(`http://localhost:${PORT}`, {
        transports: ['websocket'],
        auth: {
          token: validToken,
        },
      });

      clientSocket.on('connect', () => {
        // Join the chat room first
        clientSocket.on('chat:joined', () => {
          // Listen for new message
          clientSocket.on('message:new', (message) => {
            expect(message._id).toBe('msg123');
            expect(message.body).toBe('Hello world');
            clientSocket.disconnect();
            resolve();
          });

          // Send message
          clientSocket.emit('message:send', {
            chatId: 'chat123',
            body: 'Hello world',
            tempId: 'temp123',
          });
        });

        clientSocket.emit('chat:join', { chatId: 'chat123' });
      });

      clientSocket.on('connect_error', (error) => {
        clientSocket.disconnect();
        reject(error);
      });

      setTimeout(() => {
        clientSocket.disconnect();
        reject(new Error('message:send test timeout'));
      }, 5000);
    });
  });

  it('should handle typing:start and typing:stop events', async () => {
    return new Promise<void>((resolve, reject) => {
      const client1 = ioClient(`http://localhost:${PORT}`, {
        transports: ['websocket'],
        auth: {
          token: validToken,
        },
      });

      const client2 = ioClient(`http://localhost:${PORT}`, {
        transports: ['websocket'],
        auth: {
          token: jwt.sign({ userId: 'user456' }, JWT_SECRET, { expiresIn: '15m' }),
        },
      });

      let typingStartReceived = false;
      let typingStopReceived = false;

      client1.on('connect', () => {
        client1.emit('chat:join', { chatId: 'chat123' });
      });

      client2.on('connect', () => {
        client2.on('chat:joined', () => {
          // Listen for typing updates
          client2.on('typing:update', (data) => {
            if (data.isTyping && !typingStartReceived) {
              typingStartReceived = true;
              expect(data.userId).toBe(TEST_USER_ID);
              expect(data.chatId).toBe('chat123');

              // Send typing stop
              client1.emit('typing:stop', { chatId: 'chat123' });
            } else if (!data.isTyping && typingStartReceived && !typingStopReceived) {
              typingStopReceived = true;
              expect(data.userId).toBe(TEST_USER_ID);
              expect(data.chatId).toBe('chat123');

              client1.disconnect();
              client2.disconnect();
              resolve();
            }
          });

          // Send typing start from client1
          client1.emit('typing:start', { chatId: 'chat123' });
        });

        client2.emit('chat:join', { chatId: 'chat123' });
      });

      client1.on('connect_error', (error) => {
        client1.disconnect();
        client2.disconnect();
        reject(error);
      });

      setTimeout(() => {
        client1.disconnect();
        client2.disconnect();
        reject(new Error('typing events test timeout'));
      }, 5000);
    });
  });

  it('should handle chat:create event', async () => {
    return new Promise<void>((resolve, reject) => {
      const clientSocket = ioClient(`http://localhost:${PORT}`, {
        transports: ['websocket'],
        auth: {
          token: validToken,
        },
      });

      clientSocket.on('connect', () => {
        clientSocket.on('chat:created', (chat) => {
          expect(chat._id).toBe('chat123');
          expect(chat.type).toBe('direct');
          expect(chat.participants).toEqual(['user123', 'user456']);
          clientSocket.disconnect();
          resolve();
        });

        clientSocket.emit('chat:create', {
          type: 'direct',
          participantIds: ['user123', 'user456'],
        });
      });

      clientSocket.on('connect_error', (error) => {
        clientSocket.disconnect();
        reject(error);
      });

      setTimeout(() => {
        clientSocket.disconnect();
        reject(new Error('chat:create test timeout'));
      }, 5000);
    });
  });

  it('should emit error when required fields are missing', async () => {
    return new Promise<void>((resolve, reject) => {
      const clientSocket = ioClient(`http://localhost:${PORT}`, {
        transports: ['websocket'],
        auth: {
          token: validToken,
        },
      });

      clientSocket.on('connect', () => {
        clientSocket.on('error', (data) => {
          expect(data.message).toContain('required');
          clientSocket.disconnect();
          resolve();
        });

        // Send message without body
        clientSocket.emit('message:send', {
          chatId: 'chat123',
        });
      });

      clientSocket.on('connect_error', (error) => {
        clientSocket.disconnect();
        reject(error);
      });

      setTimeout(() => {
        clientSocket.disconnect();
        reject(new Error('error test timeout'));
      }, 5000);
    });
  });
});
