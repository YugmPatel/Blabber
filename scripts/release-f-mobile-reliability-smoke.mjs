#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const mobileRoot = join(root, 'apps/mobile');
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
function mobileText() {
  return walk(mobileRoot).filter((file) => /\.(ts|tsx)$/.test(file)).map((file) => readFileSync(file, 'utf8')).join('\n');
}

test('01 release F mobile reliability smoke command is tracked', () => {
  assert(read('package.json').includes('smoke:release-f-mobile-reliability'));
});

test('02 required reliability docs are tracked', () => {
  assert(existsSync(join(root, 'docs/mobile-reels-reliability.md')));
  assert(existsSync(join(root, 'docs/mobile-push-foundation.md')));
  assert(existsSync(join(root, 'docs/release-f-mobile-reliability.md')));
});

test('03 Reel upload API wrappers use existing backend contract', () => {
  const api = read('apps/mobile/src/api/blabber.ts');
  for (const path of ['/api/reels/upload-init', '/api/reels/${reelId}/status', '/api/reels']) assert(api.includes(path.replace('${reelId}', '${reelId}')));
  assert(api.includes('publishReel'));
  assert(api.includes('deleteReel'));
});

test('04 Reel upload helper uses native video picker', () => {
  const helper = read('apps/mobile/src/uploads/mobile-reel-upload.ts');
  assert(helper.includes('pickVideoForFutureUpload'));
  assert(helper.includes('uploadBinaryToUrl'));
});

test('05 Reel upload exposes required states', () => {
  const helper = read('apps/mobile/src/uploads/mobile-reel-upload.ts');
  for (const state of ['selecting_video', 'preparing_upload', 'uploading', 'upload_interrupted', 'scanning', 'processing', 'ready', 'publishing', 'published', 'cancelled', 'unavailable']) assert(helper.includes(state));
});

test('06 Reel upload references are transient', () => {
  const helper = read('apps/mobile/src/uploads/mobile-reel-upload.ts');
  assert(helper.includes('rememberTransientUploadReferences'));
  assert(!/SecureStore\.[^(]+\([^)]*(picked|upload|reel|uri)/i.test(helper));
});

test('07 Reel upload cancel deletes draft', () => {
  const helper = read('apps/mobile/src/uploads/mobile-reel-upload.ts');
  assert(helper.includes('cancelMobileReelUpload'));
  assert(helper.includes('deleteReel'));
});

test('08 Reel upload retry does not persist upload URL', () => {
  const helper = read('apps/mobile/src/uploads/mobile-reel-upload.ts');
  assert(helper.includes('initiateReelUpload'));
  assert(!/AsyncStorage|FileSystem\.writeAsString|SecureStore\.setItemAsync/i.test(helper));
});

test('09 Reel create screen is native and linked', () => {
  assert(existsSync(join(root, 'apps/mobile/app/(app)/reels/create.tsx')));
  assert(read('apps/mobile/app/(app)/(tabs)/profile.tsx').includes('/reels/create'));
  assert(read('apps/mobile/app/(app)/(tabs)/reels.tsx').includes('/reels/create'));
});

test('10 Reel create waits for ready before publish', () => {
  const screen = read('apps/mobile/app/(app)/reels/create.tsx');
  assert(screen.includes("state !== 'ready'"));
  assert(screen.includes('publishMobileReel'));
});

test('11 Reel create supports cancel and retry labels', () => {
  const screen = read('apps/mobile/app/(app)/reels/create.tsx');
  assert(screen.includes('Cancel upload'));
  assert(screen.includes('Retry upload'));
});

test('12 no camera capture permission is introduced', () => {
  assert(!/launchCameraAsync|requestCameraPermissionsAsync|NSCameraUsageDescription|android\.permission\.CAMERA/.test(mobileText() + read('apps/mobile/app.config.ts')));
});

test('13 no WebView is introduced', () => {
  assert(!/\bWebView\b|react-native-webview/.test(mobileText() + read('apps/mobile/package.json')));
});

test('14 no persistent video or playback cache is introduced', () => {
  const combined = mobileText();
  assert(!/SecureStore\.setItemAsync\([^)]*(playback|fallback|manifest|segment|video|eventToken)/i.test(combined));
  assert(!/AsyncStorage|expo-file-system.*(download|cache)/is.test(combined));
});

test('15 Reels tab has active Reel state', () => {
  const reels = read('apps/mobile/app/(app)/(tabs)/reels.tsx');
  assert(reels.includes('activeReelId'));
  assert(reels.includes('currentActiveId'));
});

test('16 Reels tab prepares adjacent metadata only', () => {
  const reels = read('apps/mobile/app/(app)/(tabs)/reels.tsx');
  assert(reels.includes('preparedAdjacentId'));
  assert(reels.includes('Next Reel ready'));
});

test('17 Reels tab creates playback session only in active component', () => {
  const reels = read('apps/mobile/app/(app)/(tabs)/reels.tsx');
  assert(reels.includes('function ActiveReelVideo'));
  assert(reels.indexOf('createReelPlaybackSession') < reels.indexOf('function ReelCard'));
});

test('18 Reels tab pauses on background and route cleanup', () => {
  const reels = read('apps/mobile/app/(app)/(tabs)/reels.tsx');
  assert(reels.includes('AppState.addEventListener'));
  assert(reels.includes('player.pause()'));
  assert(reels.includes('setPlayback(null)'));
});

test('19 Reels tab bounds playback retry', () => {
  const reels = read('apps/mobile/app/(app)/(tabs)/reels.tsx');
  assert(reels.includes('retryCount < 2'));
});

test('20 Reels tab avoids background event recording', () => {
  const reels = read('apps/mobile/app/(app)/(tabs)/reels.tsx');
  assert(reels.includes('if (!appActive || !eventToken || !allowSignals) return'));
});

test('21 Reel detail lifecycle is background aware', () => {
  const detail = read('apps/mobile/app/(app)/reels/[reelId].tsx');
  assert(detail.includes('AppState.addEventListener'));
  assert(detail.includes('appActive'));
  assert(detail.includes('player.pause()'));
});

test('22 Reel detail bounds playback retry', () => {
  assert(read('apps/mobile/app/(app)/reels/[reelId].tsx').includes('retryCount < 2'));
});

test('23 mobile push backend routes are mounted', () => {
  const app = read('services/notifications/src/app.ts');
  for (const route of ['/mobile-push/status', '/mobile-push/register', '/mobile-push/verify', '/mobile-push/deregister']) assert(app.includes(route));
});

test('24 mobile push device model encrypts and hashes token data', () => {
  const model = read('services/notifications/src/models/mobile-push-device.ts');
  assert(model.includes('encryptPushToken'));
  assert(model.includes('hashPushToken'));
  assert(model.includes('hashInstallationId'));
  assert(model.includes('aes-256-gcm'));
});

test('25 mobile push registration requires verification', () => {
  const route = read('services/notifications/src/routes/mobile-push.ts');
  assert(route.includes('verificationChallengeHash'));
  assert(route.includes('verifiedAt'));
  assert(route.includes('serializeMobilePushDeviceStatus'));
});

test('26 ordinary mobile push delivery requires verified active device', () => {
  const send = read('services/notifications/src/routes/send.ts');
  assert(send.includes('verifiedAt: { $exists: true }'));
  assert(send.includes('disabledAt: { $exists: false }'));
});

test('27 ordinary mobile push payload is generic', () => {
  const send = read('services/notifications/src/routes/send.ts');
  assert(send.includes("schema: 'blabber.mobile_push.v1'"));
  assert(send.includes('notificationRef'));
  assert(!/mobilePayload[\s\S]{0,240}(title|body|media|path|token)/.test(send));
});

test('28 invalid mobile push tokens disable devices', () => {
  const send = read('services/notifications/src/routes/send.ts');
  assert(send.includes("result === 'invalid_token'"));
  assert(send.includes('disabledAt'));
});

test('29 account deletion removes mobile push devices', () => {
  assert(read('services/auth/src/account-processors.ts').includes('mobile_push_devices'));
});

test('30 gateway rate limits mobile push endpoints', () => {
  assert(read('apps/gateway/src/rate-limits.ts').includes('notification_mobile_push'));
});

test('31 mobile push permission is explicit opt-in only', () => {
  const helper = read('apps/mobile/src/notifications/mobile-push.ts');
  const layout = read('apps/mobile/app/_layout.tsx');
  const auth = read('apps/mobile/src/auth/AuthProvider.tsx');
  assert(helper.includes('Notifications.requestPermissionsAsync'));
  assert(!/requestPermissionsAsync|getExpoPushTokenAsync/.test(layout));
  assert(!/requestPermissionsAsync|getExpoPushTokenAsync/.test(auth));
});

test('32 settings exposes enable and disable device push actions', () => {
  const settings = read('apps/mobile/app/(app)/settings/mobile.tsx');
  assert(settings.includes('enableMobileNotifications'));
  assert(settings.includes('disableMobileNotifications'));
});

test('33 push tap resolves through server notification and allowlisted parser', () => {
  const nav = read('apps/mobile/src/notifications/push-navigation.ts');
  assert(nav.includes('listNotifications'));
  assert(nav.includes('parseNotificationTarget'));
});

test('34 push helper does not persist provider token', () => {
  const helper = read('apps/mobile/src/notifications/mobile-push.ts');
  assert(helper.includes('getExpoPushTokenAsync'));
  assert(!/SecureStore\.setItemAsync\([^)]*token/i.test(helper));
});

test('35 local fake provider omits raw provider token from deliveries', () => {
  const provider = read('services/notifications/src/mobile-push-provider.ts');
  assert(provider.includes('mobile_push_fake_deliveries'));
  const fakeWrites = provider.match(/getFakeDeliveries\(\)\.insertOne\(\{[\s\S]*?\n    \}\);/g) || [];
  assert(fakeWrites.length >= 2);
  assert(!/encryptedToken|tokenHash|token/.test(fakeWrites.join('\n')));
});

test('36 compose config enables fake mobile push provider locally', () => {
  assert(read('docker-compose.full.yml').includes('MOBILE_PUSH_PROVIDER_MODE'));
});

test('37 notification preferences still gate sends', () => {
  const send = read('services/notifications/src/routes/send.ts');
  assert(send.includes('getNotificationPreferences'));
  assert(send.includes('Notifications disabled by user preference'));
});

test('38 no analytics or ad SDK is added', () => {
  const pkg = read('apps/mobile/package.json');
  assert(!/firebase|segment|amplitude|mixpanel|appsflyer|adjust|admob|react-native-google-mobile-ads/i.test(pkg));
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
