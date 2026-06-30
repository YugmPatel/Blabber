import { useState } from 'react';
import { Text } from 'react-native';
import { Link, Redirect } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Button, Input } from '@/components/Primitives';
import { ErrorState } from '@/components/States';
import { useAuth } from '@/auth/AuthProvider';
import { useTheme } from '@/theme/theme';

export default function SignIn() {
  const { status, signIn } = useAuth();
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (status === 'authenticated') return <Redirect href="/(app)/(tabs)/home" />;
  return (
    <Screen>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 28, fontWeight: '800' }}>Blabber</Text>
      <Text style={{ color: theme.muted }}>Sign in to continue.</Text>
      {error ? <ErrorState message={error} /> : null}
      <Input label="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <Input label="Password" secureTextEntry value={password} onChangeText={setPassword} />
      <Button label={busy ? 'Signing in...' : 'Sign in'} disabled={busy} onPress={async () => {
        setBusy(true);
        setError(null);
        try {
          await signIn(email.trim(), password);
        } catch {
          setError('Unable to sign in. Check your details and try again.');
        } finally {
          setBusy(false);
        }
      }} />
      <Link href="/(auth)/forgot-password" style={{ color: theme.primary }}>Forgot password?</Link>
      <Link href="/(auth)/sign-up" style={{ color: theme.primary }}>Create an account</Link>
    </Screen>
  );
}
