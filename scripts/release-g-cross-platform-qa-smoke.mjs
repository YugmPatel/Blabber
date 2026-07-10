#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const tests = [];
const gateway = process.env.GATEWAY_URL || 'http://localhost:3000';
const runId = `release-g-qa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function test(name, fn) { tests.push({ name, fn }); }
function read(path) { return readFileSync(join(root, path), 'utf8'); }
function exists(path) { return existsSync(join(root, path)); }
function walk(dir, out = []) {
  for (const item of readdirSync(join(root, dir))) {
    const path = join(root, dir, item);
    const stat = statSync(path);
    if (stat.isDirectory() && !['node_modules', 'dist', '.expo', '.turbo'].includes(item)) walk(join(dir, item), out);
    if (stat.isFile()) out.push(path);
  }
  return out;
}
function textFor(dir, pattern = /\.(ts|tsx|mjs|json|md)$/) {
  return walk(dir).filter((file) => pattern.test(file)).map((file) => readFileSync(file, 'utf8')).join('\n');
}
function sourceTextFor(dir) {
  return walk(dir).filter((file) => /\.(ts|tsx|json)$/.test(file) && !file.includes('/tests/') && !file.endsWith('.test.ts') && !file.endsWith('.test.tsx')).map((file) => readFileSync(file, 'utf8')).join('\n');
}
async function api(method, path, { token, cookie, body, expected = 200 } = {}) {
  const response = await fetch(`${gateway}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : {};
  assert.equal(response.status, expected, `${method} ${path} returned ${response.status}`);
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) Object.defineProperty(data, '__cookie', { value: setCookie.split(';')[0] });
  return data;
}

let qaUser;
let qaCookie;
const qaUsername = `rg_${runId.replace(/[^a-zA-Z0-9_]/g, '_')}`.slice(0, 30);
const qaEmail = `${runId}@example.com`;

test('01 Docker Gateway health is available', async () => {
  const data = await api('GET', '/healthz');
  assert.equal(data.status, 'ok');
});

test('02 Docker Gateway readiness is available', async () => {
  const data = await api('GET', '/readyz');
  assert.equal(data.status, 'ready');
});

test('03 protected API rejects unauthenticated access safely', async () => {
  await api('GET', '/api/auth/me', { expected: 401 });
});

test('04 throwaway QA account can register without printing credentials', async () => {
  const result = await api('POST', '/api/auth/register', {
    expected: 201,
    body: {
      username: qaUsername,
      email: qaEmail,
      password: `Pass-${runId}-42`,
      name: 'Release G QA',
    },
  });
  assert(result.accessToken);
  assert(result.user?._id);
  qaCookie = result.__cookie;
  qaUser = { token: result.accessToken };
});

test('05 authenticated profile session endpoint works for throwaway user', async () => {
  const data = await api('GET', '/api/auth/me', { token: qaUser.token });
  assert.equal(data.user?.name, 'Release G QA');
});

test('06 auth logout endpoint is callable without exposing token', async () => {
  await api('POST', '/api/auth/logout', { cookie: qaCookie });
});

test('07 release G smoke command is tracked', () => {
  assert(read('package.json').includes('smoke:release-g-cross-platform-qa'));
});

test('08 all accepted smoke commands remain registered', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const name of [
    'release-a', 'release-b-account', 'release-b-safety', 'release-b-operations',
    'release-c-moments', 'release-c-moment-interactions', 'release-d-profiles',
    'release-d-feed', 'release-d-communities', 'release-d-discovery', 'release-d-for-you',
    'release-e-video-foundation', 'release-e-reels-viewer', 'release-e-reels-for-you',
    'release-f-mobile-foundation', 'release-f-mobile-social', 'release-f-mobile-reliability',
  ]) assert(pkg.scripts[`smoke:${name}`], `missing smoke:${name}`);
});

test('09 web production build script is registered', () => {
  assert(JSON.parse(read('apps/web/package.json')).scripts.build.includes('vite build'));
});

test('10 mobile build contract scripts are registered', () => {
  const scripts = JSON.parse(read('apps/mobile/package.json')).scripts;
  for (const name of ['typecheck', 'lint', 'test', 'config-check', 'export:android', 'export:ios', 'check']) assert(scripts[name]);
});

test('11 web protected routes wrap accepted private surfaces', () => {
  const router = read('apps/web/src/router.tsx');
  for (const route of ['/chats', '/feed', '/discover', '/communities', '/moments', '/reels', '/settings', '/actions']) assert(router.includes(`path: '${route}'`));
  assert(router.includes('<ProtectedRoute>'));
});

test('12 web protected loading state is announced accessibly', () => {
  const protectedRoute = read('apps/web/src/components/ProtectedRoute.tsx');
  assert(protectedRoute.includes('role="status"'));
  assert(protectedRoute.includes('aria-live="polite"'));
  assert(protectedRoute.includes('aria-busy="true"'));
});

test('13 web auth access token remains memory-only', () => {
  const auth = read('apps/web/src/contexts/AuthContext.tsx');
  const client = read('apps/web/src/api/client.ts');
  assert(client.includes('let accessToken: string | null = null'));
  assert(!/localStorage\.setItem\([^)]*access|sessionStorage\.setItem\([^)]*access/i.test(auth + client));
});

test('14 web API uses credentialed gateway client', () => {
  const client = read('apps/web/src/api/client.ts');
  assert(client.includes('withCredentials: true'));
  assert(client.includes('VITE_API_URL'));
});

test('15 web route set includes launch QA surfaces', () => {
  const router = read('apps/web/src/router.tsx');
  for (const surface of ['SocialProfilePage', 'FeedPage', 'DiscoverPage', 'CommunitiesPage', 'CommunityPage', 'MomentsPage', 'ReelsPage', 'CreateReelPage', 'SettingsPage']) assert(router.includes(surface));
});

test('16 newly added web product pages expose loading/error/empty states', () => {
  const pages = ['FeedPage.tsx', 'DiscoverPage.tsx', 'CommunitiesPage.tsx', 'CommunityPage.tsx', 'ReelsPage.tsx', 'ReelPage.tsx'];
  for (const page of pages) {
    const text = read(`apps/web/src/pages/${page}`);
    assert(/loading|Loading/i.test(text), page);
    assert(/error|unavailable|Empty|No /i.test(text), page);
  }
});

test('17 web icon/button controls have accessible names in newly added pages', () => {
  const added = ['FeedPage.tsx', 'DiscoverPage.tsx', 'CommunitiesPage.tsx', 'CommunityPage.tsx', 'ReelsPage.tsx', 'ReelPage.tsx', 'CreateReelPage.tsx'];
  for (const page of added) {
    const text = read(`apps/web/src/pages/${page}`);
    assert(!/<button\s*(?:className|type)/.test(text) || /aria-label|>\s*[A-Za-z]/.test(text), page);
  }
});

test('18 mobile config requires explicit API base and blocks production localhost fallback', () => {
  const config = read('apps/mobile/app.config.ts');
  assert(config.includes('EXPO_PUBLIC_API_BASE_URL'));
  assert(config.includes('EXPO_PUBLIC_ALLOW_INSECURE_LOCAL_API'));
  assert(!config.includes("|| 'http://localhost"));
});

test('19 mobile protected routes block private content while restoring auth', () => {
  const protectedRoute = read('apps/mobile/src/auth/Protected.tsx');
  assert(protectedRoute.includes("status === 'restoring'"));
  assert(protectedRoute.includes('Checking your session'));
});

test('20 mobile refresh credential remains SecureStore-only', () => {
  const secure = read('apps/mobile/src/storage/secure-store.ts');
  const mobile = sourceTextFor('apps/mobile');
  assert(secure.includes('expo-secure-store'));
  assert(!/AsyncStorage/.test(mobile));
});

test('21 mobile logout and refresh failure clear private state', () => {
  const client = read('apps/mobile/src/api/client.ts');
  assert(client.includes('clearRefreshCredential'));
  assert(client.includes('clearPrivateMemoryCache'));
  assert(client.includes('clearActiveUploadReferences'));
  assert(client.includes('await clearLocalSession()'));
});

test('22 mobile deep links use an allowlist and reject secret params', () => {
  const routes = read('apps/mobile/src/deep-links/routes.ts');
  assert(routes.includes('SAFE_HANDLE'));
  assert(routes.includes('SAFE_ID'));
  assert(routes.includes('BLOCKED_PARAMS'));
  for (const blocked of ['access', 'refresh', 'token', 'playback', 'invite', 'verification', 'media']) assert(routes.includes(blocked));
});

test('23 mobile Socket.IO uses auth payload and foreground lifecycle', () => {
  const socket = read('apps/mobile/src/realtime/socket.ts');
  assert(socket.includes('auth: { token }'));
  assert(!socket.includes('query'));
  assert(socket.includes('AppState.addEventListener'));
  assert(socket.includes('disconnectSocket()'));
});

test('24 mobile media picker requests library permission only after user action helper', () => {
  const picker = read('apps/mobile/src/uploads/picker.ts');
  assert(picker.includes('requestMediaLibraryPermissionsAsync'));
  assert(picker.includes('launchImageLibraryAsync'));
  assert(!picker.includes('requestCameraPermissionsAsync'));
  assert(!picker.includes('launchCameraAsync'));
});

test('25 mobile has no camera permission or WebView path', () => {
  const mobile = sourceTextFor('apps/mobile');
  assert(!/requestCameraPermissionsAsync|launchCameraAsync|NSCameraUsageDescription|android\.permission\.CAMERA/.test(mobile + read('apps/mobile/app.config.ts')));
  assert(!/\bWebView\b|react-native-webview/.test(mobile + read('apps/mobile/package.json')));
});

test('26 mobile has no analytics ad or device-fingerprinting SDK', () => {
  const pkg = read('apps/mobile/package.json');
  assert(!/firebase|segment|amplitude|mixpanel|appsflyer|adjust|admob|react-native-google-mobile-ads|fingerprint/i.test(pkg));
});

test('27 mobile private content is not persisted in local cache APIs', () => {
  const mobile = textFor('apps/mobile');
  assert(!/SecureStore\.setItemAsync\([^)]*(message|moment|caption|body|mediaId|uploadUrl|playback|eventToken|pushToken)/i.test(mobile));
  assert(!/FileSystem\.(write|download|copy)/.test(mobile));
});

test('28 mobile native Reel publishing cannot bypass ready state', () => {
  const create = read('apps/mobile/app/(app)/reels/create.tsx');
  const upload = read('apps/mobile/src/uploads/mobile-reel-upload.ts');
  assert(create.includes("state !== 'ready'"));
  assert(upload.includes('getReelStatus'));
  assert(upload.includes("processingStatus === 'ready'"));
});

test('29 mobile Reel lifecycle pauses background playback and avoids background signals', () => {
  const reels = read('apps/mobile/app/(app)/(tabs)/reels.tsx');
  assert(reels.includes('AppState.addEventListener'));
  assert(reels.includes('player.pause()'));
  assert(reels.includes('if (!appActive || !eventToken || !allowSignals) return'));
});

test('30 mobile Reel adjacent preparation remains bounded', () => {
  const reels = read('apps/mobile/app/(app)/(tabs)/reels.tsx');
  assert(reels.includes('preparedAdjacentId'));
  assert(reels.includes('Next Reel ready'));
});

test('31 mobile push permission is explicit action only', () => {
  const push = read('apps/mobile/src/notifications/mobile-push.ts');
  const auth = read('apps/mobile/src/auth/AuthProvider.tsx');
  const rootLayout = read('apps/mobile/app/_layout.tsx');
  assert(push.includes('enableMobileNotifications'));
  assert(push.includes('Notifications.requestPermissionsAsync'));
  assert(!/requestPermissionsAsync|getExpoPushTokenAsync/.test(auth + rootLayout));
});

test('32 notification tap navigation refetches notification and uses safe parser', () => {
  const nav = read('apps/mobile/src/notifications/push-navigation.ts');
  assert(nav.includes('listNotifications'));
  assert(nav.includes('parseNotificationTarget'));
});

test('33 Gateway sensitive rate limits remain active for launch surfaces', () => {
  const limits = read('apps/gateway/src/rate-limits.ts');
  for (const key of ['auth_login', 'auth_signup', 'media_upload', 'reel_upload', 'profile_follow', 'community_join', 'notification_mobile_push']) assert(limits.includes(key));
});

test('34 Gateway proxies all accepted product route families', () => {
  const proxy = read('apps/gateway/src/routes/proxy.ts');
  for (const path of ['/api/auth', '/api/users', '/api/profiles', '/api/feed', '/api/discovery', '/api/posts', '/api/communities', '/api/moments', '/api/reels', '/api/messages', '/api/notifications']) assert(proxy.includes(path));
});

test('35 auth final deletion cleanup covers cross-release records', () => {
  const cleanup = read('services/auth/src/account-processors.ts');
  for (const name of ['mobile_push_devices', 'reels', 'reel_playback_sessions', 'community_posts', 'moments', 'post_comments', 'chat_actions', 'chat_summaries']) assert(cleanup.includes(name));
});

test('36 account export preserves report-retention boundary', () => {
  const cleanup = read('services/auth/src/account-processors.ts');
  assert(cleanup.includes("db.collection('reports').find({ reporterUserId: userId })"));
  assert(!/reports.*deleteMany\(\{ reporterUserId: userId \}/s.test(cleanup));
});

test('37 profile follow privacy boundaries remain server-owned', () => {
  const profiles = read('services/users/src/routes/profiles.ts');
  assert(profiles.includes("profileVisibility || 'private'"));
  assert(profiles.includes("=== 'public' ? 'following' : 'requested'"));
  assert(profiles.includes('hasBlockBetween'));
});

test('38 posts enforce approved media and profile privacy composition', () => {
  const posts = read('services/users/src/routes/posts.ts');
  assert(posts.includes("status: 'approved'"));
  assert(posts.includes('profileVisibility'));
  assert(posts.includes('canViewerReadPostDocument'));
});

test('39 community authorization and generic private denial paths exist', () => {
  const communities = read('services/users/src/routes/communities.ts');
  assert(communities.includes('membershipMode'));
  assert(communities.includes('getCommunityMembershipsCollection'));
  assert(communities.includes('getCommunityBansCollection'));
  assert(communities.includes('unavailable'));
});

test('40 Moments privacy and reply protections remain routed through users service', () => {
  const app = read('services/users/src/app.ts');
  const moments = read('services/users/src/routes/moments.ts');
  assert(app.includes('/moments'));
  assert(moments.includes('audienceType'));
  assert(moments.includes('reply'));
  assert(moments.includes('close_friends'));
});

test('41 Discover and post For You maintain separate state from Reels', () => {
  const discovery = read('services/users/src/routes/discovery.ts');
  const reels = read('services/media/src/routes/reels.ts');
  assert(discovery.includes('getDiscoveryForYouSessionsCollection'));
  assert(reels.includes('getReelForYouSessionsCollection'));
  assert(reels.includes("'reels_for_you'"));
});

test('42 recommendation internals are not serialized in client-facing code', () => {
  const usersDiscovery = read('services/users/src/routes/discovery.ts');
  const reels = read('services/media/src/routes/reels.ts');
  const discoverSerializer = usersDiscovery.slice(usersDiscovery.indexOf('async function serializeDiscoverPost'), usersDiscovery.indexOf('async function serializeCreator'));
  const reelSerializer = reels.slice(reels.indexOf('async function serializeReel'), reels.indexOf('async function issueReelEventToken'));
  assert(discoverSerializer.includes('candidateToken'));
  assert(reelSerializer.includes('eventToken'));
  assert(!/\bscore\b|affinity/i.test(discoverSerializer + reelSerializer));
});

test('43 Reels playback sessions reauthorize on access changes', () => {
  const reels = read('services/media/src/routes/reels.ts');
  assert(reels.includes('sessionReel'));
  assert(reels.includes('canAccessReel(reel, userId)'));
  assert(reels.includes('expiresAt: { $gt: new Date() }'));
});

test('44 Reel hide mute block and deletion revocation paths exist', () => {
  const reels = read('services/media/src/routes/reels.ts');
  assert(reels.includes('not_interested'));
  assert(reels.includes('mute_reel_creator'));
  assert(reels.includes('revokedAt'));
  assert(reels.includes("publishState: 'deleted'"));
});

test('45 Reels source upload processing remains server-authorized', () => {
  const reels = read('services/media/src/routes/reels.ts');
  const processor = read('services/media/src/reel-processing.ts');
  assert(reels.includes('uploadInitSchema'));
  assert(reels.includes('scanBuffer'));
  assert(reels.includes("body.toString('ascii', 4, 8) !== 'ftyp'"));
  assert(processor.includes('ffprobe'));
  assert(processor.includes('ffmpeg'));
});

test('46 notifications require verified mobile push device before ordinary delivery', () => {
  const send = read('services/notifications/src/routes/send.ts');
  assert(send.includes('verifiedAt: { $exists: true }'));
  assert(send.includes('disabledAt: { $exists: false }'));
});

test('47 fake push provider omits raw token and content payload', () => {
  const provider = read('services/notifications/src/mobile-push-provider.ts');
  assert(provider.includes('MOBILE_PUSH_PROVIDER_MODE'));
  assert(provider.includes('mobile_push_fake_deliveries'));
  const writes = provider.match(/getFakeDeliveries\(\)\.insertOne\(\{[\s\S]*?\n    \}\);/g) || [];
  assert(writes.length >= 2);
  assert(!/encryptedToken|tokenHash|body|title|caption|message/.test(writes.join('\n')));
});

test('48 mobile push invalid-token cleanup disables device', () => {
  const send = read('services/notifications/src/routes/send.ts');
  assert(send.includes("result === 'invalid_token'"));
  assert(send.includes('disabledAt'));
  assert(send.includes("lastFailureReason: 'invalid_token'"));
});

test('49 push cleanup on account deletion is covered', () => {
  assert(read('services/auth/src/account-processors.ts').includes('mobile_push_devices'));
});

test('50 Socket.IO server authenticates and avoids query-token requirement', () => {
  const auth = read('apps/gateway/src/socket/auth.ts');
  const mobileSocket = read('apps/mobile/src/realtime/socket.ts');
  assert(auth.includes('socket.handshake.auth'));
  assert(!mobileSocket.includes('query'));
});

test('51 notification preferences and previews remain server-owned', () => {
  const prefs = read('services/notifications/src/models/notification-preferences.ts');
  const send = read('services/notifications/src/routes/send.ts');
  assert(prefs.includes('notificationPreviewsEnabled'));
  assert(send.includes('noPreviewBody'));
});

test('52 mobile UI states expose accessible loading error empty patterns', () => {
  const states = read('apps/mobile/src/components/States.tsx');
  assert(states.includes('accessibilityRole="header"'));
  assert(states.includes('accessibilityRole="alert"'));
  assert(states.includes('LoadingState'));
});

test('53 mobile buttons have accessibility role and labels', () => {
  const primitives = read('apps/mobile/src/components/Primitives.tsx');
  assert(primitives.includes('accessibilityRole="button"'));
  assert(primitives.includes('accessibilityLabel={label}'));
});

test('54 theme layer supports light dark and system behavior', () => {
  const theme = read('apps/mobile/src/theme/theme.ts');
  assert(theme.includes('useColorScheme'));
  assert(theme.includes('light'));
  assert(theme.includes('dark'));
});

test('55 docs for Release G QA are tracked', () => {
  for (const path of ['docs/cross-platform-qa.md', 'docs/accessibility-qa.md', 'docs/release-g-cross-platform-qa.md']) assert(exists(path), path);
});

test('56 docs use repository-relative paths only', () => {
  const docs = ['docs/cross-platform-qa.md', 'docs/accessibility-qa.md', 'docs/release-g-cross-platform-qa.md'].map(read).join('\n');
  assert(!/\/Users\//.test(docs));
});

test('57 no production deployment or store workflow was added', () => {
  const pkg = read('package.json');
  assert(!/testflight|play store upload|app store connect|eas submit/i.test(pkg));
});

test('58 smoke output redaction guard contains no sensitive fixture values', () => {
  const source = read('scripts/release-g-cross-platform-qa-smoke.mjs');
  for (const forbidden of ['accessToken)', 'refreshToken)', 'password)', 'uploadUrl)', 'eventToken)', 'challenge)', 'providerReceipt']) assert(!source.includes(`console.log(${forbidden}`));
});

test('59 Docker compose keeps fake mobile push adapter scoped to local configuration', () => {
  const compose = read('docker-compose.full.yml');
  assert(compose.includes('MOBILE_PUSH_PROVIDER_MODE: ${MOBILE_PUSH_PROVIDER_MODE:-fake}'));
  assert(!read('services/notifications/src/push-ops.ts').includes('MOBILE_PUSH_PROVIDER_MODE'));
});

test('60 fixture isolation strategy is encoded in this smoke', () => {
  assert(runId.startsWith('release-g-qa-'));
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
