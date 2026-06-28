import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createServer } from 'http';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
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

  beforeAll(async () => {
    // Set JWT secret for testing
    process.env.JWT_ACCESS_SECRET = JWT_SECRET;

    // Generate valid token
    validToken = jwt.sign({ userId: TEST_USER_ID }, JWT_SECRET, { expiresIn: '15m' });

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

  beforeEach(() => {
    mockedAxios.post.mockImplementation((url: string, body: any) => {
      if (url.endsWith('/chat123')) {
        return Promise.resolve({
          data: {
            _id: 'msg123',
            chatId: 'chat123',
            senderId: TEST_USER_ID,
            body: body.body,
            createdAt: new Date().toISOString(),
          },
        });
      }

      if (url.includes('/read')) {
        return Promise.resolve({ data: { success: true } });
      }

      if (url.includes('/react')) {
        return Promise.resolve({
          data: {
            _id: 'msg123',
            reactions: [{ userId: TEST_USER_ID, emoji: body.emoji }],
          },
        });
      }

      return Promise.resolve({
        data: {
          chat: {
            _id: 'chat123',
            type: body.type,
            participants: body.participantIds,
            createdAt: new Date().toISOString(),
          },
        },
      });
    });
  });

  afterAll(async () => {
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
          // Listen for sender acknowledgement. Broadcast delivery comes from pubsub.
          clientSocket.on('message:ack', (ack) => {
            expect(ack.messageId).toBe('msg123');
            expect(ack.message._id).toBe('msg123');
            expect(ack.message.body).toBe('Hello world');
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
