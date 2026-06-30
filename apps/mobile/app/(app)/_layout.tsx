import { Stack } from 'expo-router';
import { Protected } from '@/auth/Protected';

export default function AppLayout() {
  return (
    <Protected>
      <Stack screenOptions={{ headerShown: false }} />
    </Protected>
  );
}
