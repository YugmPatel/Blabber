import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from 'socket.io-redis-adapter';
import { createClient } from 'redis';
import type { Server as HTTPServer } from 'http';
import { logger } from '@repo/utils';

export async function setupSocketIO(httpServer: HTTPServer) {
  // Create Socket.io server
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Set up Redis adapter for horizontal scaling
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
  const redisPassword = process.env.REDIS_PASSWORD;

  try {
    const pubClient = createClient({
      socket: {
        host: redisHost,
        port: redisPort,
      },
      password: redisPassword,
    });

    const subClient = pubClient.duplicate();

    await Promise.all([pubClient.connect(), subClient.connect()]);

    io.adapter(createAdapter(pubClient, subClient));

    logger.info('Redis adapter connected for Socket.io');
  } catch (error) {
    logger.error('Failed to connect Redis adapter, running without it:', error);
    // Continue without Redis adapter for local development
  }

  // Authentication middleware
  const { authenticateSocket, joinUserRoom } = await import('./auth.js');
  const { setupRoomManagement } = await import('./rooms.js');
  const { setupClientEvents } = await import('./events.js');
  io.use(authenticateSocket);

  // Initialize Redis Pub/Sub for event broadcasting
  const { initPubSub } = await import('../pubsub.js');
  initPubSub(io);

  // Connection event
  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id}`);

    // Join user to their personal room
    joinUserRoom(socket);

    // Set up room management handlers
    setupRoomManagement(socket);

    // Set up client event handlers
    setupClientEvents(socket, io);

    // Broadcast user online status
    const userId = socket.data.userId;
    if (userId) {
      io.emit('presence:update', {
        userId,
        online: true,
        lastSeen: new Date(),
      });
      logger.info(`User ${userId} is now online`);
    }

    socket.on('disconnect', (reason) => {
      logger.info(`Socket disconnected: ${socket.id}, reason: ${reason}`);

      // Broadcast user offline status
      if (userId) {
        // Check if user has other active connections
        const userRoom = `user:${userId}`;
        const socketsInRoom = io.sockets.adapter.rooms.get(userRoom);

        // Only mark as offline if no other sockets are connected
        if (!socketsInRoom || socketsInRoom.size === 0) {
          io.emit('presence:update', {
            userId,
            online: false,
            lastSeen: new Date(),
          });
          logger.info(`User ${userId} is now offline`);
        }
      }
    });
  });

  return io;
}
