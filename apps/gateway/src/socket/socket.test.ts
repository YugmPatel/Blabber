import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import app from '../app.js';
import { setupSocketIO } from './index.js';
import type { Server as SocketIOServer } from 'socket.io';

describe('Socket.io Server', () => {
  let httpServer: any;
  let io: SocketIOServer;
  let clientSocket: ClientSocket;
  const PORT = 3100;
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
    // Close client socket
    if (clientSocket?.connected) {
      clientSocket.disconnect();
    }

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

  it('should accept socket connections', async () => {
    return new Promise<void>((resolve, reject) => {
      clientSocket = ioClient(`http://localhost:${PORT}`, {
        transports: ['websocket'],
        auth: {
          token: validToken,
        },
      });

      clientSocket.on('connect', () => {
        expect(clientSocket.connected).toBe(true);
        expect(clientSocket.id).toBeDefined();
        resolve();
      });

      clientSocket.on('connect_error', (error) => {
        reject(error);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 5000);
    });
  });

  it('should handle socket disconnection', async () => {
    return new Promise<void>((resolve, reject) => {
      const testClient = ioClient(`http://localhost:${PORT}`, {
        transports: ['websocket'],
        auth: {
          token: validToken,
        },
      });

      testClient.on('connect', () => {
        expect(testClient.connected).toBe(true);

        testClient.on('disconnect', () => {
          expect(testClient.connected).toBe(false);
          resolve();
        });

        // Disconnect after connection
        testClient.disconnect();
      });

      testClient.on('connect_error', (error) => {
        reject(error);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        reject(new Error('Disconnection test timeout'));
      }, 5000);
    });
  });

  it('should support multiple concurrent connections', async () => {
    const clients: ClientSocket[] = [];
    const numClients = 5;

    try {
      // Create multiple clients
      for (let i = 0; i < numClients; i++) {
        const client = ioClient(`http://localhost:${PORT}`, {
          transports: ['websocket'],
          auth: {
            token: validToken,
          },
        });
        clients.push(client);
      }

      // Wait for all to connect
      await Promise.all(
        clients.map(
          (client) =>
            new Promise<void>((resolve, reject) => {
              client.on('connect', () => resolve());
              client.on('connect_error', (error) => reject(error));
              setTimeout(() => reject(new Error('Connection timeout')), 5000);
            })
        )
      );

      // Verify all connected
      clients.forEach((client) => {
        expect(client.connected).toBe(true);
      });

      // Disconnect all
      clients.forEach((client) => client.disconnect());
    } catch (error) {
      // Clean up on error
      clients.forEach((client) => client.disconnect());
      throw error;
    }
  });
});
