import { Redirect } from 'expo-router';
import { LoadingState } from '@/components/States';
import { useAuth } from './AuthProvider';

export function Protected({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  if (status === 'restoring') return <LoadingState label="Checking your session..." />;
  if (status === 'anonymous') return <Redirect href="/(auth)/sign-in" />;
  return <>{children}</>;
}
