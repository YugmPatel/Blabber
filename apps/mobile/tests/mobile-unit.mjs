#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const apiConfig = read('src/config/api-base.ts');
assert(apiConfig.includes('EXPO_PUBLIC_API_BASE_URL'), 'API base URL uses explicit Expo public config');
assert(apiConfig.includes('allowInsecureLocalDevelopment'), 'insecure local API requires explicit flag');
assert(!apiConfig.includes("|| 'http://localhost"), 'no localhost fallback exists');

const secureStore = read('src/storage/secure-store.ts');
assert(secureStore.includes('expo-secure-store'), 'refresh credential uses Expo SecureStore');
assert(!secureStore.includes('AsyncStorage'), 'refresh credential never uses AsyncStorage');

const apiClient = read('src/api/client.ts');
assert(apiClient.includes('let accessToken: string | null = null'), 'access token is memory-only');
assert(apiClient.includes('refreshFlight'), 'refresh handling is single-flight');
assert(apiClient.includes('clearPrivateMemoryCache'), 'logout/refresh failure clears private cache');

const protectedRoute = read('src/auth/Protected.tsx');
assert(protectedRoute.includes("status === 'restoring'"), 'protected routes block while auth restores');
assert(protectedRoute.includes('<Redirect href="/(auth)/sign-in"'), 'unauthenticated protected routes redirect to sign-in');

const deepLinks = read('src/deep-links/routes.ts');
for (const allowed of ['profile', 'community', 'reel', 'chat', 'discover', 'notifications']) {
  assert(deepLinks.includes(`name: '${allowed}'`) || deepLinks.includes(`name: '${allowed}'`), `deep link supports ${allowed}`);
}
assert(deepLinks.includes('BLOCKED_PARAMS'), 'deep links reject secret/token params');

const socket = read('src/realtime/socket.ts');
assert(socket.includes('auth: { token }'), 'Socket.IO uses auth payload');
assert(!socket.includes('query'), 'Socket.IO does not use query-string token path');
assert(socket.includes('AppState.addEventListener'), 'socket lifecycle follows app foreground/background');

console.log('mobile unit checks passed');
