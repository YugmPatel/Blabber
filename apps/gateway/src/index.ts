import { createServer } from 'http';
import app from './app.js';
import { setupSocketIO } from './socket/index.js';
import { loadCommonConfig } from '@repo/config';
import { logger } from '@repo/utils';

const config = loadCommonConfig();
const PORT = process.env.GATEWAY_PORT ? parseInt(process.env.GATEWAY_PORT) : config.PORT;

// Create HTTP server
const httpServer = createServer(app);

// Set up Socket.io
setupSocketIO(httpServer)
  .then((io) => {
    logger.info('Socket.io server initialized');

    // Start listening
    httpServer.listen(PORT, () => {
      logger.info(`Gateway server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    logger.error('Failed to initialize Socket.io:', error);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  httpServer.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  httpServer.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});
