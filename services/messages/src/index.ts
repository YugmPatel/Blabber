import { loadCommonConfig } from '@repo/config';
import { logger } from '@repo/utils';
import app from './app';
import { connectToDatabase, closeDatabase } from './db';
import { createMessageIndexes } from './models/message';
import { createMessagePinIndexes } from './models/message-pin';
import { createSavedMessageIndexes } from './models/saved-message';
import { createEventReminderDeliveryIndexes } from './models/event-reminder-delivery';
import { initPubSub, closePubSub } from './pubsub';
import { PollCloseProcessor } from './poll-closer';
import { EventReminderProcessor } from './event-reminders';

const config = loadCommonConfig();

async function startServer() {
  try {
    // Connect to database
    await connectToDatabase();

    // Create indexes
    await createMessageIndexes();
    await createMessagePinIndexes();
    await createSavedMessageIndexes();
    await createEventReminderDeliveryIndexes();
    logger.info('Database indexes created');

    // Initialize Redis Pub/Sub
    initPubSub();
    logger.info('Redis Pub/Sub initialized');

    const pollCloseProcessor = new PollCloseProcessor();
    pollCloseProcessor.start();
    const eventReminderProcessor = new EventReminderProcessor();
    await eventReminderProcessor.start();

    // Start Express server
    const server = app.listen(config.PORT, () => {
      logger.info(
        {
          port: config.PORT,
          env: config.NODE_ENV,
        },
        'Messages service started'
      );
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Received shutdown signal');

      server.close(async () => {
        logger.info('HTTP server closed');
        pollCloseProcessor.stop();
        eventReminderProcessor.stop();
        await closePubSub();
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
    logger.error({ error }, 'Failed to start messages service');
    process.exit(1);
  }
}

startServer();
