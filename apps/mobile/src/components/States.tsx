import { ActivityIndicator, Text, View } from 'react-native';
import { useTheme } from '@/theme/theme';

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: theme.bg }}>
      <ActivityIndicator />
      <Text accessibilityRole="text" style={{ color: theme.muted }}>{label}</Text>
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  const theme = useTheme();
  return (
    <View accessible style={{ padding: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 8, gap: 6 }}>
      <Text accessibilityRole="header" style={{ color: theme.text, fontWeight: '700' }}>{title}</Text>
      {body ? <Text style={{ color: theme.muted }}>{body}</Text> : null}
    </View>
  );
}

export function ErrorState({ message = 'Something went wrong. Try again.' }: { message?: string }) {
  const theme = useTheme();
  return <Text accessibilityRole="alert" style={{ color: theme.danger }}>{message}</Text>;
}
