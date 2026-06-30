import { listNotifications } from '@/api/blabber';
import { parseNotificationTarget } from '@/deep-links/routes';

type PushRouter = {
  push: (href: never) => void;
};

function routeForTarget(target: ReturnType<typeof parseNotificationTarget>) {
  if (!target) return null;
  if (target.name === 'profile') return `/p/${target.handle}` as const;
  if (target.name === 'community') return `/c/${target.handle}` as const;
  if (target.name === 'reel') return `/reels/${target.reelId}` as const;
  if (target.name === 'chat') return `/chats/${target.chatId}` as const;
  if (target.name === 'discover') return '/discover' as const;
  if (target.name === 'notifications') return '/notifications' as const;
  return null;
}

export async function openMobilePushNotification(router: PushRouter, input: { notificationRef?: unknown }) {
  const notificationRef = typeof input.notificationRef === 'string' && /^[a-f0-9]{24}$/i.test(input.notificationRef) ? input.notificationRef : null;
  if (!notificationRef) return false;
  const response = await listNotifications();
  const items = response.notifications || response.items || [];
  const item = items.find((candidate) => candidate.id === notificationRef || candidate._id === notificationRef);
  const route = routeForTarget(parseNotificationTarget(item?.data?.target || item?.data?.deepLink));
  if (!route) return false;
  router.push(route as never);
  return true;
}
