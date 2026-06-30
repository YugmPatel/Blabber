import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { listMessages, sendTextMessage } from '@/api/blabber';
import { getSocket } from '@/realtime/socket';
import { Button, Input } from '@/components/Primitives';
import { Screen } from '@/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { useApiResource } from '@/hooks/useApiResource';
import { useTheme } from '@/theme/theme';

export default function ChatDetail() {
  const { chatId = '' } = useLocalSearchParams<{ chatId: string }>();
  const theme = useTheme();
  const messages = useApiResource(() => listMessages(chatId), [chatId]);
  const [draft, setDraft] = useState('');
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    socket.emit('chat:join', { chatId });
    const refresh = () => void messages.refresh();
    socket.on('message:new', refresh);
    return () => {
      socket.off('message:new', refresh);
      socket.emit('chat:leave', { chatId });
    };
  }, [chatId, messages.refresh]);
  if (messages.loading && !messages.data) return <LoadingState label="Loading chat..." />;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Screen scroll={false}>
        <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 22, fontWeight: '800' }}>Chat</Text>
        {messages.error ? <ErrorState message="This content is unavailable." /> : null}
        <View style={{ flex: 1, gap: 8 }}>
          {messages.data?.messages?.length ? messages.data.messages.map((message) => (
            <Text key={message.id || message._id} style={{ alignSelf: message.isMine ? 'flex-end' : 'flex-start', maxWidth: '85%', color: theme.text, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 8, padding: 10 }}>
              {message.body || message.text || ''}
            </Text>
          )) : <EmptyState title="No messages yet" />}
        </View>
        <Input label="Message" value={draft} onChangeText={setDraft} multiline />
        <Button label="Send" disabled={!draft.trim()} onPress={async () => {
          const body = draft.trim();
          setDraft('');
          await sendTextMessage(chatId, body);
          await messages.refresh();
        }} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
