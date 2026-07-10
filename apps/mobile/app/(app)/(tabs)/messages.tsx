import { Text } from 'react-native';
import { Link } from 'expo-router';
import { listChats } from '@/api/blabber';
import { Screen } from '@/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useApiResource } from '@/hooks/useApiResource';
import { useTheme } from '@/theme/theme';

export default function Messages() {
  const theme = useTheme();
  const chats = useApiResource(() => listChats(), []);
  if (chats.loading && !chats.data) return <LoadingState label="Loading conversations..." />;
  return (
    <Screen>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 24, fontWeight: '800' }}>Conversations</Text>
      {chats.error ? <ErrorState message={chats.error} /> : null}
      {chats.data?.chats?.length ? chats.data.chats.map((chat) => (
        <Link key={chat._id || chat.id} href={`/chats/${chat._id || chat.id}`} style={{ color: theme.text, padding: 12, borderWidth: 1, borderColor: theme.border, borderRadius: 8 }}>
          {chat.name || chat.title || chat.type || 'Conversation'}
        </Link>
      )) : <EmptyState title="No conversations" body="Your authorized conversations will appear here." />}
    </Screen>
  );
}
