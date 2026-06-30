import { Redirect } from 'expo-router';
import { LoadingState } from '@/components/States';
import { useAuth } from '@/auth/AuthProvider';

export default function Index() {
  const { status } = useAuth();
  if (status === 'restoring') return <LoadingState label="Starting Blabber..." />;
  return <Redirect href={status === 'authenticated' ? '/(app)/(tabs)/home' : '/(auth)/sign-in'} />;
}
