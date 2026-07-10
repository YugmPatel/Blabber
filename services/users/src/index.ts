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
import { createMomentVideoPlaybackSessionIndexes } from './models/moment-video-playback-session';
import { createCloseFriendIndexes } from './models/close-friend';
import { createPostIndexes } from './models/post';
import { createPostReactionIndexes } from './models/post-reaction';
import { createPostCommentIndexes } from './models/post-comment';
import { createPostNotificationCooldownIndexes } from './models/post-notification-cooldown';
import { createPostSaveIndexes } from './models/post-save';
import { createPostRepostIndexes } from './models/post-repost';
import { createCommunityIndexes } from './models/community';
import { createCommunityMembershipIndexes } from './models/community-membership';
import { createCommunityJoinRequestIndexes } from './models/community-join-request';
import { createCommunityBanIndexes } from './models/community-ban';
import { createCommunityInviteIndexes } from './models/community-invite';
import { createCommunityPostIndexes } from './models/community-post';
import { createCommunityPostCommentIndexes } from './models/community-post-comment';
import { createCommunityPostReactionIndexes } from './models/community-post-reaction';
import {
  cleanupExpiredCommunityHandleReservations,
  createCommunityHandleReservationIndexes,
} from './models/community-handle-reservation';
import { createCommunityModerationActivityIndexes } from './models/community-moderation-activity';
import { createDiscoveryPreferenceIndexes } from './models/discovery-preference';
import { createDiscoveryFeedbackIndexes } from './models/discovery-feedback';
import { createDiscoveryEventIndexes, cleanupExpiredDiscoveryEvents } from './models/discovery-event';
import { createDiscoveryCandidateTokenIndexes } from './models/discovery-candidate-token';
import { cleanupExpiredDiscoveryAffinities, createDiscoveryAffinityIndexes } from './models/discovery-affinity';
import {
  cleanupExpiredDiscoveryForYouSessions,
  createDiscoveryForYouSessionIndexes,
} from './models/discovery-for-you-session';
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
    await createMomentVideoPlaybackSessionIndexes();
    await createCloseFriendIndexes();
    await createPostIndexes();
    await createPostReactionIndexes();
    await createPostCommentIndexes();
    await createPostNotificationCooldownIndexes();
    await createPostSaveIndexes();
    await createPostRepostIndexes();
    await createCommunityIndexes();
    await createCommunityMembershipIndexes();
    await createCommunityJoinRequestIndexes();
    await createCommunityBanIndexes();
    await createCommunityInviteIndexes();
    await createCommunityPostIndexes();
    await createCommunityPostCommentIndexes();
    await createCommunityPostReactionIndexes();
    await createCommunityHandleReservationIndexes();
    await cleanupExpiredCommunityHandleReservations();
    await createCommunityModerationActivityIndexes();
    await createUserSettingsIndexes();
    await createDiscoveryPreferenceIndexes();
    await createDiscoveryFeedbackIndexes();
    await createDiscoveryEventIndexes();
    await createDiscoveryCandidateTokenIndexes();
    await createDiscoveryAffinityIndexes();
    await createDiscoveryForYouSessionIndexes();
    await cleanupExpiredDiscoveryEvents();
    await cleanupExpiredDiscoveryAffinities();
    await cleanupExpiredDiscoveryForYouSessions();
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
