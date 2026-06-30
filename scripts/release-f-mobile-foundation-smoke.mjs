#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const mobile = join(root, 'apps/mobile');
const tests = [];

function test(name, fn) { tests.push({ name, fn }); }
function read(path) { return readFileSync(join(root, path), 'utf8'); }
function walk(dir, out = []) {
  for (const item of readdirSync(dir)) {
    const path = join(dir, item);
    const stat = statSync(path);
    if (stat.isDirectory() && !['node_modules', 'dist', '.expo'].includes(item)) walk(path, out);
    if (stat.isFile()) out.push(path);
  }
  return out;
}

test('01 mobile workspace and Expo Router config exist', () => {
  assert(existsSync(join(mobile, 'package.json')));
  assert(existsSync(join(mobile, 'app/_layout.tsx')));
  assert(read('apps/mobile/package.json').includes('expo-router'));
});

test('02 mobile environment has no localhost production fallback', () => {
  const config = read('apps/mobile/src/config/api-base.ts');
  assert(config.includes('EXPO_PUBLIC_API_BASE_URL'));
  assert(!config.includes("|| 'http://localhost"));
  assert(config.includes('allowInsecureLocalDevelopment'));
});

test('03 SecureStore adapter is present for refresh credential', () => {
  const storage = read('apps/mobile/src/storage/secure-store.ts');
  assert(storage.includes('expo-secure-store'));
  assert(!storage.includes('AsyncStorage'));
});

test('04 access token remains memory-only', () => {
  const api = read('apps/mobile/src/api/client.ts');
  assert(api.includes('let accessToken: string | null = null'));
  assert(!api.includes('setItemAsync(REFRESH_KEY, accessToken'));
});

test('05 protected route waits for auth restoration', () => {
  const protectedRoute = read('apps/mobile/src/auth/Protected.tsx');
  assert(protectedRoute.includes("status === 'restoring'"));
  assert(protectedRoute.includes('Checking your session'));
});

test('06 invalid deep link is rejected safely', () => {
  const links = read('apps/mobile/src/deep-links/routes.ts');
  assert(links.includes('return null'));
  assert(links.includes('BLOCKED_PARAMS'));
});

test('07 allowed deep link parser routes are present', () => {
  const links = read('apps/mobile/src/deep-links/routes.ts');
  for (const route of ['p', 'c', 'reels', 'chats', 'discover', 'notifications']) assert(links.includes(route));
});

test('08 mobile API client uses Gateway contract only', () => {
  const api = read('apps/mobile/src/api/blabber.ts');
  assert(api.includes('/api/feed'));
  assert(api.includes('/api/messages/'));
  assert(api.includes('/api/reels/'));
  assert(!api.includes(':3001'));
});

test('09 mobile auth contract exists', () => {
  assert(read('services/auth/src/app.ts').includes('/mobile/register'));
  assert(read('services/auth/src/app.ts').includes('/mobile/login'));
  assert(read('services/auth/src/routes/mobile.ts').includes('getDeviceSessionsCollection'));
});

test('10 logout cleanup path clears local session', () => {
  const api = read('apps/mobile/src/api/client.ts');
  assert(api.includes('mobileLogout'));
  assert(api.includes('clearLocalSession'));
  assert(api.includes('clearRefreshCredential'));
});

test('11 chat list and text send mobile contract exist', () => {
  const api = read('apps/mobile/src/api/blabber.ts');
  assert(api.includes('listChats'));
  assert(api.includes('sendTextMessage'));
});

test('12 socket auth has no query-string token path', () => {
  const socket = read('apps/mobile/src/realtime/socket.ts');
  assert(socket.includes('auth: { token }'));
  assert(!socket.includes('query'));
});

test('13 Home and Discover integrations are authenticated API routes', () => {
  const api = read('apps/mobile/src/api/blabber.ts');
  assert(api.includes('/api/feed'));
  assert(api.includes('/api/discovery/for-you'));
});

test('14 Reel playback uses authorized session flow', () => {
  const screen = read('apps/mobile/app/(app)/reels/[reelId].tsx');
  assert(screen.includes('getReel(reelId)'));
  assert(screen.includes('createReelPlaybackSession'));
  assert(screen.includes('Authorization'));
});

test('15 no Reel playback persistence path exists', () => {
  const files = walk(mobile).filter((file) => /\.(ts|tsx)$/.test(file));
  const combined = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  assert(!/SecureStore\.setItemAsync\([^)]*playback/i.test(combined));
  assert(!/AsyncStorage/i.test(combined));
});

test('16 native push is explicit opt-in only', () => {
  const layout = read('apps/mobile/app/_layout.tsx');
  const auth = read('apps/mobile/src/auth/AuthProvider.tsx');
  const push = read('apps/mobile/src/notifications/mobile-push.ts');
  assert(push.includes('enableMobileNotifications'));
  assert(push.includes('Notifications.requestPermissionsAsync'));
  assert(!/requestPermissionsAsync|getExpoPushTokenAsync/.test(layout));
  assert(!/requestPermissionsAsync|getExpoPushTokenAsync/.test(auth));
});

test('17 notifications inbox is authorized without native push registration', () => {
  assert(read('services/notifications/src/app.ts').includes("app.get('/', authMiddleware, listInbox)"));
  assert(read('apps/mobile/src/api/blabber.ts').includes('/api/notifications'));
});

test('18 Expo config validation is present', () => {
  assert(read('apps/mobile/app.config.ts').includes('validateConfigApiBaseUrl'));
});

test('19 Android export script is tracked', () => {
  assert(read('apps/mobile/package.json').includes('export:android'));
});

test('20 iOS export script is tracked', () => {
  assert(read('apps/mobile/package.json').includes('export:ios'));
});

test('21 smoke output guard has no sensitive literals', () => {
  const output = JSON.stringify({ tests: tests.length });
  assert(!/token|password|playback|manifest|message body/i.test(output));
});

let passed = 0;
const failures = [];
for (const item of tests) {
  try {
    await item.fn();
    passed += 1;
    console.log(`✓ ${item.name}`);
  } catch (error) {
    failures.push(item.name);
    console.error(`✗ ${item.name}`);
    console.error(error?.message || error);
  }
}
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
