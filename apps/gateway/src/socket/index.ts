import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from 'socket.io-redis-adapter';
import { createClient, type RedisClientType } from 'redis';
import type { Server as HTTPServer } from 'http';
import axios from 'axios';
import { logger } from '@repo/utils';
import { serviceUrls } from '../config.js';

const PRESENCE_TTL_SECONDS = 300;
let presenceClient: RedisClientType | null = null;

function safeError(error: unknown) {
  const candidate = error as { message?: string; response?: { status?: number } };
  return {
    message: candidate?.message || 'Unknown error',
    status: candidate?.response?.status,
  };
}

async function setUserPresence(userId: string, online: boolean) {
  if (!presenceClient) return;

  const now = new Date().toISOString();
  try {
    if (online) {
      await presenceClient.setEx(
        `presence:${userId}`,
        PRESENCE_TTL_SECONDS,
        JSON.stringify({ online: true, lastSeen: now })
      );
    } else {
      await presenceClient.del(`presence:${userId}`);
      await presenceClient.set(`presence:lastSeen:${userId}`, now);
    }
  } catch (error) {
    logger.error({ error: safeError(error), userId, online }, 'Failed to update Redis presence');
  }
}

async function getPresenceBroadcastSettings(userId: string) {
  try {
    const response = await axios.get(`${serviceUrls.users}/settings/${userId}/public`);
    return response.data.settings as { presenceVisible: boolean; lastSeenVisible: boolean };
  } catch (error) {
    logger.error({ error: safeError(error), userId }, 'Failed to load public user settings for presence');
    return { presenceVisible: true, lastSeenVisible: true };
  }
}

async function getPresenceExcludedRooms(token: string | undefined) {
  if (!token) return [];
  try {
    const response = await axios.get(`${serviceUrls.users}/blocks/visibility-exclusions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return (response.data.userIds || []).map((userId: string) => `user:${userId}`);
  } catch (error) {
    logger.error({ error: safeError(error) }, 'Failed to load block visibility exclusions');
    return [];
  }
}

async function broadcastPresence(
  io: SocketIOServer,
  userId: string,
  token: string | undefined,
  online: boolean,
  lastSeen: Date | null
) {
  const excludedRooms = await getPresenceExcludedRooms(token);
  io.except(excludedRooms).emit('presence:update', {
    userId,
    online,
    lastSeen,
  });
}

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
    presenceClient = pubClient as RedisClientType;

    logger.info('Redis adapter connected for Socket.io');
  } catch (error) {
    logger.error({ error: safeError(error) }, 'Failed to connect Redis adapter, running without it');
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
      void setUserPresence(userId, true);
      void getPresenceBroadcastSettings(userId).then((settings) => {
        if (!settings.presenceVisible) return;
        void broadcastPresence(io, userId, socket.data.token, true, settings.lastSeenVisible ? new Date() : null);
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
          void setUserPresence(userId, false);
          void getPresenceBroadcastSettings(userId).then((settings) => {
            if (!settings.presenceVisible) return;
            void broadcastPresence(io, userId, socket.data.token, false, settings.lastSeenVisible ? new Date() : null);
          });
          logger.info(`User ${userId} is now offline`);
        }
      }
    });
  });

  return io;
}
