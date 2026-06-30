import { loadCommonConfig } from '@repo/config';
import { logger } from '@repo/utils';
import app from './app';
import { connectToDatabase, closeDatabase } from './db';
import { createPushSubscriptionIndexes } from './models/push-subscription';
import { createNotificationPreferenceIndexes } from './models/notification-preferences';
import { createNotificationInboxIndexes } from './models/inbox';
import { createMobilePushDeviceIndexes } from './models/mobile-push-device';
import { validatePushStartupConfig } from './push-ops';

const config = loadCommonConfig();

async function startServer() {
  try {
    // Connect to database
    await connectToDatabase();
    validatePushStartupConfig();

    // Create indexes
    await createPushSubscriptionIndexes();
    await createMobilePushDeviceIndexes();
    await createNotificationPreferenceIndexes();
    await createNotificationInboxIndexes();
    logger.info('Database indexes created');

    // Start Express server
    const server = app.listen(config.PORT, () => {
      logger.info(
        {
          port: config.PORT,
          env: config.NODE_ENV,
        },
        'Notifications service started'
      );
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Received shutdown signal');

      server.close(async () => {
        logger.info('HTTP server closed');
        await closeDatabase();
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
    logger.error({ error }, 'Failed to start notifications service');
    process.exit(1);
  }
}

startServer();
