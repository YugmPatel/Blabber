import { loadCommonConfig } from '@repo/config';
import { logger } from '@repo/utils';
import app from './app';
import { connectToDatabase, closeDatabase } from './db';
import { createChatIndexes } from './models/chat';
import { createChatActionIndexes } from './models/chat-action';
import { createChatDecisionIndexes } from './models/chat-decision';
import { createChatSummaryIndexes } from './models/chat-summary';
import { createWaitingOnIndexes } from './models/chat-waiting-on';
import { createUserChatPreferencesIndexes } from './models/user-chat-preferences';
import { createChatReadStateIndexes } from './models/chat-read-state';
import { createCallHistoryIndexes } from './models/call-history';
import { createActionReminderDeliveryIndexes } from './models/action-reminder-delivery';
import { createGroupInviteLinkIndexes } from './models/group-invite-link';
import { createGroupModerationActivityIndexes } from './models/group-moderation-activity';
import { createPlanThisIndexes } from './models/plan-this';
import { createVeyraIndexes } from './models/veyra';
import { createMessageRequestIndexes } from './models/message-request';
import { initPubSub, closePubSub } from './pubsub';
import { connectToRedis, closeRedis } from './redis';
import { startActionReminderProcessor, stopActionReminderProcessor } from './action-reminders';

const config = loadCommonConfig();

async function startServer() {
  try {
    // Connect to database
    await connectToDatabase();

    // Create indexes
    await createChatIndexes();
    await createChatActionIndexes();
    await createChatDecisionIndexes();
    await createWaitingOnIndexes();
    await createChatSummaryIndexes();
    await createUserChatPreferencesIndexes();
    await createChatReadStateIndexes();
    await createCallHistoryIndexes();
    await createActionReminderDeliveryIndexes();
    await createGroupInviteLinkIndexes();
    await createGroupModerationActivityIndexes();
    await createPlanThisIndexes();
    await createVeyraIndexes();
    await createMessageRequestIndexes();
    connectToRedis();
    initPubSub();
    startActionReminderProcessor();
    logger.info('Database indexes created');

    // Start Express server
    const server = app.listen(config.PORT, () => {
      logger.info(
        {
          port: config.PORT,
          env: config.NODE_ENV,
        },
        'Chats service started'
      );
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Received shutdown signal');

      server.close(async () => {
        logger.info('HTTP server closed');
        stopActionReminderProcessor();
        await closePubSub();
        await closeRedis();
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
    logger.error({ error }, 'Failed to start chats service');
    process.exit(1);
  }
}

startServer();
