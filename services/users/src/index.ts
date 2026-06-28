import { loadCommonConfig } from '@repo/config';
import { logger } from '@repo/utils';
import app from './app';
import { connectToDatabase, closeDatabase } from './db';
import { connectToRedis, closeRedis } from './redis';
import { initPubSub, closePubSub } from './pubsub';
import { createUserIndexes } from './models/user';
import { createStatusIndexes } from './models/status';
import { createUserSettingsIndexes } from './models/user-settings';
import { createUserBlockIndexes } from './models/user-block';
import { createProfileRelationshipIndexes } from './models/profile-relationship';
import {
  cleanupExpiredProfileHandleReservations,
  createProfileHandleReservationIndexes,
} from './models/profile-handle-reservation';
import { createReportIndexes } from './models/report';
import { createMomentIndexes } from './models/moment';
import { createMomentViewIndexes } from './models/moment-view';
import { createMomentReactionIndexes } from './models/moment-reaction';
import { createMomentNotificationCooldownIndexes } from './models/moment-notification-cooldown';
import { createCloseFriendIndexes } from './models/close-friend';
import { startMomentExpiryProcessor } from './workers/moment-expiry-processor';

const config = loadCommonConfig();

async function startServer() {
  try {
    // Connect to database
    await connectToDatabase();

    // Connect to Redis
    connectToRedis();
    initPubSub();

    // Create indexes
    await createUserIndexes();
    await createUserBlockIndexes();
    await createProfileRelationshipIndexes();
    await createProfileHandleReservationIndexes();
    await cleanupExpiredProfileHandleReservations();
    await createReportIndexes();
    await createStatusIndexes();
    await createMomentIndexes();
    await createMomentViewIndexes();
    await createMomentReactionIndexes();
    await createMomentNotificationCooldownIndexes();
    await createCloseFriendIndexes();
    await createUserSettingsIndexes();
    logger.info('Database indexes created');

    const stopMomentExpiryProcessor = startMomentExpiryProcessor();

    // Start Express server
    const server = app.listen(config.PORT, () => {
      logger.info(
        {
          port: config.PORT,
          env: config.NODE_ENV,
        },
        'Users service started'
      );
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Received shutdown signal');
      stopMomentExpiryProcessor();

      server.close(async () => {
        logger.info('HTTP server closed');
        await closeDatabase();
        await closeRedis();
        await closePubSub();
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error({ error }, 'Failed to start users service');
    process.exit(1);
  }
}

startServer();
