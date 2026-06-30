import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { AuthProvider } from '@/auth/AuthProvider';
import { setupSocketLifecycle } from '@/realtime/socket';

export default function RootLayout() {
  useEffect(() => setupSocketLifecycle(), []);
  return (
    <AuthProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </AuthProvider>
  );
}
