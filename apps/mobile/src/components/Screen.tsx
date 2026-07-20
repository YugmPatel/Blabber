import { KeyboardAvoidingView, Platform, SafeAreaView, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme/theme';

export function Screen({
  children,
  scroll = true,
  keyboardAvoiding = true,
  style,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  keyboardAvoiding?: boolean;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const content = <View style={[styles.content, style]}>{children}</View>;
  const body = scroll ? (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, style]}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : content;
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      {keyboardAvoiding ? (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  keyboard: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, padding: 16, paddingBottom: 24, gap: 12 },
  content: { flex: 1, padding: 16, gap: 12 },
});
