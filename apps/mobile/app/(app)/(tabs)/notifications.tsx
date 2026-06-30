import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { listNotifications, markNotificationRead } from '@/api/blabber';
import { parseNotificationTarget } from '@/deep-links/routes';
import { Button } from '@/components/Primitives';
import { Screen } from '@/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useApiResource } from '@/hooks/useApiResource';
import { useTheme } from '@/theme/theme';

function routeHref(target: ReturnType<typeof parseNotificationTarget>) {
  if (!target) return null;
  if (target.name === 'profile') return `/p/${target.handle}`;
  if (target.name === 'community') return `/c/${target.handle}`;
  if (target.name === 'reel') return `/reels/${target.reelId}`;
  if (target.name === 'chat') return `/chats/${target.chatId}`;
  if (target.name === 'discover') return '/discover';
  if (target.name === 'notifications') return '/notifications';
  return null;
}

export default function Notifications() {
  const theme = useTheme();
  const router = useRouter();
  const notifications = useApiResource(() => listNotifications(), []);
  const items = notifications.data?.notifications || notifications.data?.items || [];
  if (notifications.loading && !notifications.data) return <LoadingState label="Loading notifications..." />;
  return (
    <Screen>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 24, fontWeight: '800' }}>Notifications</Text>
      {notifications.error ? <ErrorState message={notifications.error} /> : null}
      {items.length ? items.map((item) => {
        const target = parseNotificationTarget(item.target);
        const href = routeHref(target);
        return (
          <View key={item.id || item._id} style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 12, gap: 8, backgroundColor: theme.surface }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Open notification" onPress={() => href ? router.push(href as any) : undefined}>
              <Text style={{ color: theme.text, fontWeight: item.readAt ? '500' : '800' }}>{item.title || item.type || 'Notification'}</Text>
            </Pressable>
            <Button label={item.readAt ? 'Read' : 'Mark read'} onPress={() => void markNotificationRead(item.id || item._id).then(notifications.refresh)} disabled={Boolean(item.readAt)} />
          </View>
        );
      }) : <EmptyState title="No notifications" body="Mobile push notifications will be available in a later release." />}
    </Screen>
  );
}
