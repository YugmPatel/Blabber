import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import app from '../app.js';
import { setupSocketIO } from './index.js';
import type { Server as SocketIOServer } from 'socket.io';

describe('Socket.io Room Management', () => {
  let httpServer: any;
  let io: SocketIOServer;
  const PORT = 3102;
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

  it('should join a chat room', async () => {
    return new Promise<void>((resolve, reject) => {
      const clientSocket = ioClient(`http://localhost:${PORT}`, {
        transports: ['websocket'],
        auth: {
          token: validToken,
        },
      });

      clientSocket.on('connect', () => {
        // Listen for join acknowledgment
        clientSocket.on('chat:joined', (data) => {
          expect(data.chatId).toBe('chat123');
          clientSocket.disconnect();
          resolve();
        });

        // Join a chat room
        clientSocket.emit('chat:join', { chatId: 'chat123' });
      });

      clientSocket.on('connect_error', (error) => {
        clientSocket.disconnect();
        reject(error);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        clientSocket.disconnect();
        reject(new Error('Join room test timeout'));
      }, 5000);
    });
  });

  it('should leave a chat room', async () => {
    return new Promise<void>((resolve, reject) => {
      const clientSocket = ioClient(`http://localhost:${PORT}`, {
        transports: ['websocket'],
        auth: {
          token: validToken,
        },
      });

      clientSocket.on('connect', () => {
        // First join a room
        clientSocket.on('chat:joined', () => {
          // Then leave the room
          clientSocket.emit('chat:leave', { chatId: 'chat123' });
        });

        // Listen for leave acknowledgment
        clientSocket.on('chat:left', (data) => {
          expect(data.chatId).toBe('chat123');
          clientSocket.disconnect();
          resolve();
        });

        // Join a chat room
        clientSocket.emit('chat:join', { chatId: 'chat123' });
      });

      clientSocket.on('connect_error', (error) => {
        clientSocket.disconnect();
        reject(error);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        clientSocket.disconnect();
        reject(new Error('Leave room test timeout'));
      }, 5000);
    });
  });

  it('should receive messages in joined room', async () => {
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

      let client1Joined = false;
      let client2Joined = false;

      const checkBothJoined = () => {
        if (client1Joined && client2Joined) {
          // Both clients joined, emit a test message to the room
          setTimeout(() => {
            io.to('chat:chat123').emit('test-message', { text: 'Hello room!' });
          }, 100);
        }
      };

      client1.on('connect', () => {
        client1.on('chat:joined', () => {
          client1Joined = true;
          checkBothJoined();
        });

        client1.on('test-message', (data) => {
          expect(data.text).toBe('Hello room!');
          client1.disconnect();
          client2.disconnect();
          resolve();
        });

        client1.emit('chat:join', { chatId: 'chat123' });
      });

      client2.on('connect', () => {
        client2.on('chat:joined', () => {
          client2Joined = true;
          checkBothJoined();
        });

        client2.emit('chat:join', { chatId: 'chat123' });
      });

      client1.on('connect_error', (error) => {
        client1.disconnect();
        client2.disconnect();
        reject(error);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        client1.disconnect();
        client2.disconnect();
        reject(new Error('Room message test timeout'));
      }, 5000);
    });
  });

  it('should not receive messages after leaving room', async () => {
    return new Promise<void>((resolve, reject) => {
      const clientSocket = ioClient(`http://localhost:${PORT}`, {
        transports: ['websocket'],
        auth: {
          token: validToken,
        },
      });

      let messageReceived = false;

      clientSocket.on('connect', () => {
        clientSocket.on('chat:joined', () => {
          // Leave the room immediately
          clientSocket.emit('chat:leave', { chatId: 'chat123' });
        });

        clientSocket.on('chat:left', () => {
          // Emit a message to the room
          setTimeout(() => {
            io.to('chat:chat123').emit('test-message', { text: 'Should not receive' });
          }, 100);

          // Wait a bit to ensure message is not received
          setTimeout(() => {
            if (!messageReceived) {
              clientSocket.disconnect();
              resolve();
            } else {
              clientSocket.disconnect();
              reject(new Error('Received message after leaving room'));
            }
          }, 500);
        });

        clientSocket.on('test-message', () => {
          messageReceived = true;
        });

        clientSocket.emit('chat:join', { chatId: 'chat123' });
      });

      clientSocket.on('connect_error', (error) => {
        clientSocket.disconnect();
        reject(error);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        clientSocket.disconnect();
        reject(new Error('Leave room message test timeout'));
      }, 5000);
    });
  });

  it('should emit error when chatId is missing', async () => {
    return new Promise<void>((resolve, reject) => {
      const clientSocket = ioClient(`http://localhost:${PORT}`, {
        transports: ['websocket'],
        auth: {
          token: validToken,
        },
      });

      clientSocket.on('connect', () => {
        clientSocket.on('error', (data) => {
          expect(data.message).toContain('chatId is required');
          clientSocket.disconnect();
          resolve();
        });

        // Try to join without chatId
        clientSocket.emit('chat:join', {});
      });

      clientSocket.on('connect_error', (error) => {
        clientSocket.disconnect();
        reject(error);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        clientSocket.disconnect();
        reject(new Error('Error test timeout'));
      }, 5000);
    });
  });
});
