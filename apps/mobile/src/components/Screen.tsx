import { SafeAreaView, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme/theme';

export function Screen({ children, scroll = true, style }: { children: React.ReactNode; scroll?: boolean; style?: ViewStyle }) {
  const theme = useTheme();
  const content = <View style={[styles.content, style]}>{children}</View>;
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled">{content}</ScrollView> : content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, padding: 16, gap: 12 },
});
