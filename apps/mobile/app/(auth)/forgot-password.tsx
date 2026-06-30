import { useState } from 'react';
import { Text } from 'react-native';
import { Link } from 'expo-router';
import { apiRequest } from '@/api/client';
import { Screen } from '@/components/Screen';
import { Button, Input } from '@/components/Primitives';
import { EmptyState, ErrorState } from '@/components/States';
import { useTheme } from '@/theme/theme';

export default function ForgotPassword() {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Screen>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 24, fontWeight: '800' }}>Forgot password</Text>
      {sent ? <EmptyState title="Check your email" body="If an account exists, reset instructions will be sent." /> : null}
      {error ? <ErrorState message={error} /> : null}
      <Input label="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <Button label="Send reset email" onPress={async () => {
        try {
          await apiRequest('/api/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email }), retryOnUnauthorized: false });
          setSent(true);
        } catch {
          setError('Something went wrong. Try again.');
        }
      }} />
      <Link href="/(auth)/sign-in" style={{ color: theme.primary }}>Back to sign in</Link>
    </Screen>
  );
}
