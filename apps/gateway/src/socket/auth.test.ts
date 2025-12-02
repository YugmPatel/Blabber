import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import app from '../app.js';
import { setupSocketIO } from './index.js';
import type { Server as SocketIOServer } from 'socket.io';

describe('Socket.io Authentication', () => {
  let httpServer: any;
  let io: SocketIOServer;
  const PORT = 3101;
  const JWT_SECRET = 'test-secret-key';
  const TEST_USER_ID = 'user123';

  beforeAll(async () => {
    // Set JWT secret for testing
    process.env.JWT_ACCESS_SECRET = JWT_SECRET;

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

  it('should reject connection without token', async () => {
    return new Promise<void>((resolve, reject) => {
      const clientSocket = ioClient(`http://localhost:${PORT}`, {
        transports: ['websocket'],
        auth: {}, // No token
      });

      clientSocket.on('connect', () => {
        clientSocket.disconnect();
        reject(new Error('Should not connect without token'));
      });

      clientSocket.on('connect_error', (error) => {
        expect(error.message).toContain('Authentication error');
        clientSocket.disconnect();
        resolve();
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        clientSocket.disconnect();
        reject(new Error('Test timeout'));
      }, 5000);
    });
  });

  it('should reject connection with invalid token', async () => {
    return new Promise<void>((resolve, reject) => {
      const clientSocket = ioClient(`http://localhost:${PORT}`, {
        transports: ['websocket'],
        auth: {
          token: 'invalid-token',
        },
      });

      clientSocket.on('connect', () => {
        clientSocket.disconnect();
        reject(new Error('Should not connect with invalid token'));
      });

      clientSocket.on('connect_error', (error) => {
        expect(error.message).toContain('Authentication error');
        clientSocket.disconnect();
        resolve();
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        clientSocket.disconnect();
        reject(new Error('Test timeout'));
      }, 5000);
    });
  });

  it('should accept connection with valid token', async () => {
    const token = jwt.sign({ userId: TEST_USER_ID }, JWT_SECRET, { expiresIn: '15m' });

    return new Promise<void>((resolve, reject) => {
      const clientSocket = ioClient(`http://localhost:${PORT}`, {
        transports: ['websocket'],
        auth: {
          token,
        },
      });

      clientSocket.on('connect', () => {
        expect(clientSocket.connected).toBe(true);
        clientSocket.disconnect();
        resolve();
      });

      clientSocket.on('connect_error', (error) => {
        clientSocket.disconnect();
        reject(error);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        clientSocket.disconnect();
        reject(new Error('Connection timeout'));
      }, 5000);
    });
  });

  it('should join authenticated user to user room', async () => {
    const token = jwt.sign({ userId: TEST_USER_ID }, JWT_SECRET, { expiresIn: '15m' });

    return new Promise<void>((resolve, reject) => {
      const clientSocket = ioClient(`http://localhost:${PORT}`, {
        transports: ['websocket'],
        auth: {
          token,
        },
      });

      clientSocket.on('connect', () => {
        // Check if socket is in the correct room by emitting to that room
        const userRoom = `user:${TEST_USER_ID}`;

        // Listen for a test event
        clientSocket.on('test-room-event', (data) => {
          expect(data.message).toBe('Room test');
          clientSocket.disconnect();
          resolve();
        });

        // Emit to the user room from server side
        setTimeout(() => {
          io.to(userRoom).emit('test-room-event', { message: 'Room test' });
        }, 100);
      });

      clientSocket.on('connect_error', (error) => {
        clientSocket.disconnect();
        reject(error);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        clientSocket.disconnect();
        reject(new Error('Room join test timeout'));
      }, 5000);
    });
  });

  it('should reject expired token', async () => {
    const expiredToken = jwt.sign({ userId: TEST_USER_ID }, JWT_SECRET, { expiresIn: '-1h' });

    return new Promise<void>((resolve, reject) => {
      const clientSocket = ioClient(`http://localhost:${PORT}`, {
        transports: ['websocket'],
        auth: {
          token: expiredToken,
        },
      });

      clientSocket.on('connect', () => {
        clientSocket.disconnect();
        reject(new Error('Should not connect with expired token'));
      });

      clientSocket.on('connect_error', (error) => {
        expect(error.message).toContain('Authentication error');
        clientSocket.disconnect();
        resolve();
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        clientSocket.disconnect();
        reject(new Error('Test timeout'));
      }, 5000);
    });
  });
});
