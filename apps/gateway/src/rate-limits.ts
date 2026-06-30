import { Request } from 'express';
import { createClient, type RedisClientType } from 'redis';
import jwt from 'jsonwebtoken';
import { AppError } from '@repo/utils';

let redis: RedisClientType | null = null;
let connecting: Promise<void> | null = null;

async function getRedis() {
  if (!redis) {
    redis = createClient({
      socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT || '6379'),
        reconnectStrategy: false,
      },
      password: process.env.REDIS_PASSWORD || undefined,
    });
  }
  if (!redis.isOpen) {
    connecting ||= redis.connect().then(() => undefined);
    await connecting;
  }
  return redis;
}

function routeKey(req: Request) {
  const path = req.path;
  if (/\/api\/auth\/login$/.test(path)) return 'auth_login';
  if (/\/api\/auth\/mobile\/login$/.test(path)) return 'auth_login';
  if (/\/api\/auth\/mobile\/(refresh|logout|session)$/.test(path)) return 'account_sessions';
  if (/\/api\/auth\/register$/.test(path)) return 'auth_signup';
  if (/\/api\/auth\/password\/forgot$/.test(path)) return 'password_forgot';
  if (/\/api\/auth\/password\/reset$/.test(path)) return 'password_reset';
  if (/\/api\/auth\/account\/email\/verification\/(resend|confirm)$/.test(path)) return 'account_email_verify';
  if (/\/api\/auth\/account\/email\/change\/(request|confirm)$/.test(path)) return 'account_email_change';
  if (/\/api\/auth\/account\/sessions(\/[^/]+|\/logout-others)?$/.test(path)) return 'account_sessions';
  if (/\/api\/auth\/account\/export(\/[^/]+\/download)?$/.test(path)) return 'account_export';
  if (/\/api\/auth\/account\/deletion(\/cancel|\/worker\/run)?$/.test(path)) return 'account_deletion';
  if (/\/api\/users\/([^/]+\/block|blocked)$/.test(path)) return 'user_block';
  if (/\/api\/reports(\/mine)?$/.test(path)) return 'trust_report';
  if (/\/api\/moderation\/reports/.test(path)) return 'moderation_review';
  if (/\/api\/chats\/[^/]+\/moderation/.test(path)) return 'group_moderation';
  if (/\/api\/media\/(presign|upload)$/.test(path) || (/\/api\/media\/local\/[^/]+$/.test(path) && req.method === 'PUT')) return 'media_upload';
  if (/\/api\/moments$/.test(path) && req.method === 'POST') return 'moment_create';
  if (/\/api\/moments\/[^/]+\/view$/.test(path)) return 'moment_view';
  if (/\/api\/moments\/[^/]+\/viewers$/.test(path)) return 'moment_viewers';
  if (/\/api\/moments\/[^/]+\/interactions$/.test(path)) return 'moment_interactions';
  if (/\/api\/moments\/[^/]+\/reaction$/.test(path)) return 'moment_reaction';
  if (/\/api\/moments\/[^/]+\/reply$/.test(path)) return 'moment_reply';
  if (/\/api\/moments\/close-friends/.test(path)) return 'moment_close_friends';
  if (/\/api\/moments\/archive/.test(path)) return 'moment_archive';
  if (/\/api\/profiles\/me(\/handle)?$/.test(path)) return 'profile_update';
  if (/\/api\/notifications\/mobile-push\/(status|register|verify|deregister)$/.test(path)) return 'notification_mobile_push';
  if (/\/api\/reels\/upload-init$/.test(path)) return 'reel_upload';
  if (/\/api\/reels\/uploads\/[^/]+\/source$/.test(path)) return 'reel_upload';
  if (/\/api\/reels$/.test(path) && req.method === 'POST') return 'reel_create';
  if (/\/api\/reels\/browse$/.test(path)) return 'reel_read';
  if (/\/api\/reels\/for-you$/.test(path)) return 'reel_for_you';
  if (/\/api\/reels\/for-you\/refresh$/.test(path)) return 'reel_for_you';
  if (/\/api\/reels\/for-you\/explanations\/[^/]+$/.test(path)) return 'reel_for_you';
  if (/\/api\/reels\/saved$/.test(path)) return 'reel_read';
  if (/\/api\/reels\/[^/]+\/discovery$/.test(path)) return 'reel_discovery';
  if (/\/api\/reels\/[^/]+$/.test(path) && ['PATCH', 'DELETE'].includes(req.method)) return 'reel_mutation';
  if (/\/api\/reels\/[^/]+\/status$/.test(path)) return 'reel_status';
  if (/\/api\/reels\/[^/]+\/playback-session$/.test(path)) return 'reel_playback_session';
  if (/\/api\/reels\/[^/]+\/event-token$/.test(path)) return 'reel_event_token';
  if (/\/api\/reels\/[^/]+\/events$/.test(path)) return 'reel_event';
  if (/\/api\/reels\/[^/]+\/reaction$/.test(path)) return 'reel_reaction';
  if (/\/api\/reels\/[^/]+\/comments(\/[^/]+)?(\/report)?$/.test(path)) return req.method === 'GET' ? 'reel_read' : 'reel_comment';
  if (/\/api\/reels\/[^/]+\/save$/.test(path)) return 'reel_save';
  if (/\/api\/reels\/[^/]+\/(not-interested|mute-creator)$/.test(path)) return 'reel_feedback';
  if (/\/api\/reels\/playback\/[^/]+\/(manifest|fallback|poster)$/.test(path)) return 'reel_playback';
  if (/\/api\/reels\/playback\/[^/]+\/segment\/[^/]+$/.test(path)) return 'reel_playback';
  if (/\/api\/reels\/[^/]+\/report$/.test(path)) return 'trust_report';
  if (/\/api\/profiles\/[^/]+\/reels$/.test(path)) return 'reel_read';
  if (/\/api\/profiles\/requests/.test(path)) return 'profile_follow';
  if (/\/api\/profiles\/[^/]+\/posts$/.test(path)) return 'post_read';
  if (/\/api\/profiles\/[^/]+\/(follow|cancel|follower)$/.test(path)) return 'profile_follow';
  if (/\/api\/profiles\/[^/]+(\/(followers|following))?$/.test(path)) return 'profile_view';
  if (/\/api\/feed$/.test(path)) return 'post_read';
  if (/\/api\/discovery\/for-you$/.test(path)) return 'discovery_for_you';
  if (/\/api\/discovery\/for-you\/refresh$/.test(path)) return 'discovery_for_you';
  if (/\/api\/discovery\/for-you\/events$/.test(path)) return 'discovery_events';
  if (/\/api\/discovery\/for-you\/explanations\/[^/]+$/.test(path)) return 'discovery_for_you';
  if (/\/api\/discovery\/(creators|posts|communities|topics)$/.test(path)) return 'discovery_browse';
  if (/\/api\/discovery\/preferences$/.test(path)) return 'discovery_preferences';
  if (/\/api\/discovery\/topics\/[^/]+\/(follow|mute)$/.test(path)) return 'discovery_preferences';
  if (/\/api\/discovery\/(posts|creators|communities)\/[^/]+\/(not-interested|mute)$/.test(path)) return 'discovery_feedback';
  if (/\/api\/discovery\/events$/.test(path)) return 'discovery_events';
  if (/\/api\/discovery\/personalization\/clear$/.test(path)) return 'discovery_preferences';
  if (/\/api\/profiles\/me\/discovery$/.test(path)) return 'discovery_settings';
  if (/\/api\/posts\/[^/]+\/discovery$/.test(path)) return 'discovery_settings';
  if (/\/api\/communities\/[^/]+\/discovery$/.test(path)) return 'discovery_settings';
  if (/\/api\/posts$/.test(path) && req.method === 'POST') return 'post_create';
  if (/\/api\/posts\/[^/]+$/.test(path) && ['GET', 'PATCH', 'DELETE'].includes(req.method)) return 'post_read';
  if (/\/api\/posts\/[^/]+\/reaction$/.test(path)) return 'post_reaction';
  if (/\/api\/posts\/[^/]+\/comments(\/[^/]+)?$/.test(path)) return 'post_comment';
  if (/\/api\/posts\/[^/]+\/media\/[^/]+$/.test(path)) return 'post_media';
  if (/\/api\/communities(\/invite\/[^/]+(\/accept)?|\/[^/]+\/invite)$/.test(path)) return 'community_invite';
  if (/\/api\/communities$/.test(path) && req.method === 'POST') return 'community_create';
  if (/\/api\/communities\/[^/]+\/(join|request)$/.test(path)) return 'community_join';
  if (/\/api\/communities\/[^/]+\/(requests|members|activity)/.test(path)) return 'community_moderation';
  if (/\/api\/communities\/[^/]+\/posts$/.test(path)) return req.method === 'POST' ? 'community_post_create' : 'community_post_read';
  if (/\/api\/communities\/[^/]+$/.test(path)) return 'community_view';
  if (/\/api\/community-posts\/[^/]+\/reaction$/.test(path)) return 'community_post_reaction';
  if (/\/api\/community-posts\/[^/]+\/comments(\/[^/]+)?$/.test(path)) return 'community_post_comment';
  if (/\/api\/community-posts\/[^/]+\/media\/[^/]+$/.test(path)) return 'community_post_media';
  if (/\/api\/community-posts\/[^/]+$/.test(path)) return 'community_post_read';
  if (/\/api\/messages\/search/.test(path)) return 'message_search';
  if (/\/forward$/.test(path)) return 'message_forward';
  if (/\/api\/invites\/[^/]+\/(preview|join)$/.test(path)) return 'invite_access';
  if (/\/invite-link(\/(regenerate|revoke))?$/.test(path)) return 'invite_manage';
  if (/\/(pin|unpin|save|unsave|archive|unarchive)$/.test(path)) return 'chat_or_message_state';
  if (/\/poll\/(vote|close)$/.test(path) || (/\/api\/messages\/[^/]+$/.test(path) && req.method === 'POST')) return 'poll_or_message_create';
  if (/\/event(\.ics|\/(rsvp|cancel))?$/.test(path)) return 'event_action';
  return null;
}

function userOrIp(req: Request) {
  const header = req.headers.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const decoded = jwt.decode(token) as { userId?: string } | null;
      if (decoded?.userId) return `user:${decoded.userId}`;
    } catch {
      // IP fallback below.
    }
  }
  return `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
}

export async function sensitiveRateLimit(req: Request, res: any, next: any) {
  const action = routeKey(req);
  if (!action) return next();

  const windowSeconds = 60;
  const maxRequests = 30;
  const key = `gateway:sensitive:${action}:${userOrIp(req)}`;

  try {
    const client = await getRedis();
    const current = await client.incr(key);
    if (current === 1) {
      await client.expire(key, windowSeconds);
    }
    const ttl = await client.ttl(key);
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - current));
    res.setHeader('X-RateLimit-Reset', Date.now() + Math.max(ttl, 0) * 1000);

    if (current > maxRequests) {
      res.setHeader('Retry-After', ttl > 0 ? ttl : windowSeconds);
      throw new AppError(429, 'Too many requests, please try again later', 'RATE_LIMIT_EXCEEDED');
    }

    return next();
  } catch (error) {
    if (process.env.NODE_ENV !== 'production' && !(error instanceof AppError)) {
      return next();
    }
    return next(error);
  }
}
