import { useState } from 'react';
import { Text } from 'react-native';
import { Link, Redirect } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Button, Input } from '@/components/Primitives';
import { ErrorState } from '@/components/States';
import { useAuth } from '@/auth/AuthProvider';
import { useTheme } from '@/theme/theme';

export default function SignUp() {
  const { status, signUp } = useAuth();
  const theme = useTheme();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (status === 'authenticated') return <Redirect href="/(app)/(tabs)/home" />;
  return (
    <Screen>
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 24, fontWeight: '800' }}>Create account</Text>
      <Text style={{ color: theme.muted }}>Email verification is still required by the server.</Text>
      {error ? <ErrorState message={error} /> : null}
      <Input label="Name" value={name} onChangeText={setName} />
      <Input label="Username" autoCapitalize="none" value={username} onChangeText={setUsername} />
      <Input label="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <Input label="Password" secureTextEntry value={password} onChangeText={setPassword} />
      <Button label={busy ? 'Creating...' : 'Create account'} disabled={busy} onPress={async () => {
        setBusy(true);
        setError(null);
        try {
          await signUp({ name: name.trim(), username: username.trim(), email: email.trim(), password });
        } catch {
          setError('Unable to create account. Check your details and try again.');
        } finally {
          setBusy(false);
        }
      }} />
      <Link href="/(auth)/sign-in" style={{ color: theme.primary }}>Back to sign in</Link>
    </Screen>
  );
}
