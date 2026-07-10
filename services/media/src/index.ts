import { loadCommonConfig } from '@repo/config';
import { logger } from '@repo/utils';
import app from './app';
import { connectToDatabase, closeDatabase } from './db';
import { connectToRedis, closeRedis } from './redis';
import { startReelVideoProcessor } from './reel-processing';

const config = loadCommonConfig();

async function startServer() {
  try {
    // Connect to database
    await connectToDatabase();

    // Connect to Redis
    connectToRedis();

    // Create indexes
    const { createMediaIndexes } = await import('./models/media');
    const { createReelIndexes } = await import('./models/reel');
    const { createMomentVideoIndexes } = await import('./models/moment-video');
    const { createReelPlaybackSessionIndexes } = await import('./models/reel-playback-session');
    const { createReelInteractionIndexes } = await import('./models/reel-interaction');
    const { createReelForYouSessionIndexes } = await import('./models/reel-for-you-session');
    await createMediaIndexes();
    await createReelIndexes();
    await createMomentVideoIndexes();
    await createReelPlaybackSessionIndexes();
    await createReelInteractionIndexes();
    await createReelForYouSessionIndexes();

    logger.info('Database and Redis connections established');

    const stopReelVideoProcessor = startReelVideoProcessor();

    // Start Express server
    const server = app.listen(config.PORT, () => {
      logger.info(
        {
          port: config.PORT,
          env: config.NODE_ENV,
        },
        'Media service started'
      );
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Received shutdown signal');
      stopReelVideoProcessor();

      server.close(async () => {
        logger.info('HTTP server closed');
        await closeDatabase();
        await closeRedis();
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
    logger.error({ error }, 'Failed to start media service');
    process.exit(1);
  }
}

startServer();
