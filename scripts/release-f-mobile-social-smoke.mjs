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

const mobileText = () => walk(mobile).filter((file) => /\.(ts|tsx)$/.test(file)).map((file) => readFileSync(file, 'utf8')).join('\n');

test('01 mobile social smoke command is tracked', () => {
  assert(read('package.json').includes('smoke:release-f-mobile-social'));
});

test('02 native photo upload helper exists', () => {
  assert(existsSync(join(mobile, 'src/uploads/mobile-image-upload.ts')));
  assert(read('apps/mobile/src/uploads/mobile-image-upload.ts').includes('uploadPickedImageForPublishing'));
});

test('03 upload helper uses photo picker only', () => {
  const upload = read('apps/mobile/src/uploads/mobile-image-upload.ts');
  assert(upload.includes('pickPhotoForFutureUpload'));
  assert(!upload.includes('pickVideoForFutureUpload'));
});

test('04 upload helper supports progress states', () => {
  const upload = read('apps/mobile/src/uploads/mobile-image-upload.ts');
  for (const state of ['selecting_photo', 'preparing_upload', 'uploading', 'processing', 'ready', 'could_not_upload', 'cancelled']) assert(upload.includes(state));
});

test('05 transient upload references clear on session cleanup', () => {
  assert(read('apps/mobile/src/api/client.ts').includes('clearActiveUploadReferences'));
  assert(read('apps/mobile/src/uploads/upload-session.ts').includes('AbortController'));
});

test('06 no upload references are persisted', () => {
  const combined = mobileText();
  assert(!/SecureStore\.[^(]+\([^)]*(mediaId|uploadUrl|pickedUri|localUri)/i.test(combined));
  assert(!/AsyncStorage/i.test(combined));
});

test('07 presign uses existing media contract', () => {
  const api = read('apps/mobile/src/api/blabber.ts');
  assert(api.includes('/api/media/presign'));
  assert(api.includes('fileType'));
});

test('08 binary upload uses authenticated PUT', () => {
  const client = read('apps/mobile/src/api/client.ts');
  assert(client.includes('uploadBinaryToUrl'));
  assert(client.includes("method: 'PUT'"));
  assert(client.includes('authorization'));
});

test('09 mobile post creation wrapper exists', () => {
  const api = read('apps/mobile/src/api/blabber.ts');
  assert(api.includes('createPost'));
  assert(api.includes('/api/posts'));
});

test('10 post reactions comments and reporting wrappers exist', () => {
  const api = read('apps/mobile/src/api/blabber.ts');
  for (const contract of ['setPostReaction', 'createPostComment', 'reportPost']) assert(api.includes(contract));
});

test('11 Home has native composer and photo upload', () => {
  const home = read('apps/mobile/app/(app)/(tabs)/home.tsx');
  assert(home.includes('createPost'));
  assert(home.includes('uploadPickedImageForPublishing'));
});

test('12 Home posts are not read-only', () => {
  const home = read('apps/mobile/app/(app)/(tabs)/home.tsx');
  for (const action of ['onReact', 'onComment', 'onReport']) assert(home.includes(action));
});

test('13 profile editing wrapper exists', () => {
  assert(read('apps/mobile/src/api/blabber.ts').includes('updateMyProfile'));
});

test('14 profile screen edits safe fields', () => {
  const profile = read('apps/mobile/app/(app)/(tabs)/profile.tsx');
  for (const field of ['Name', 'Bio', 'Website', 'Private']) assert(profile.includes(field));
});

test('15 avatar upload path is server validated', () => {
  assert(read('services/users/src/routes/profiles.ts').includes('avatarUrlFromApprovedMedia'));
  assert(read('services/users/src/routes/profiles.ts').includes("status: 'approved'"));
});

test('16 follow request moderation wrappers exist', () => {
  const api = read('apps/mobile/src/api/blabber.ts');
  for (const contract of ['listIncomingFollowRequests', 'approveFollowRequest', 'declineFollowRequest']) assert(api.includes(contract));
});

test('17 follower removal wrapper exists', () => {
  assert(read('apps/mobile/src/api/blabber.ts').includes('removeFollower'));
});

test('18 public profile supports cancel follow request', () => {
  const profile = read('apps/mobile/app/(app)/p/[handle].tsx');
  assert(profile.includes('cancelFollowRequest'));
  assert(profile.includes('Cancel request'));
});

test('19 Moments tab is registered', () => {
  const tabs = read('apps/mobile/app/(app)/(tabs)/_layout.tsx');
  assert(tabs.includes('moments'));
});

test('20 Moments screen exists', () => {
  assert(existsSync(join(mobile, 'app/(app)/(tabs)/moments.tsx')));
});

test('21 Moment creation uses existing text or image schema', () => {
  const api = read('apps/mobile/src/api/blabber.ts');
  assert(api.includes("type: input.mediaId ? 'image' : 'text'"));
  assert(api.includes('audienceType'));
});

test('22 Moment interactions are native', () => {
  const moments = read('apps/mobile/app/(app)/(tabs)/moments.tsx');
  for (const action of ['markMomentViewed', 'setMomentReaction', 'replyToMoment', 'archiveMoment']) assert(moments.includes(action));
});

test('23 Community join request wrappers exist', () => {
  const api = read('apps/mobile/src/api/blabber.ts');
  for (const contract of ['joinCommunity', 'requestCommunityJoin', 'cancelCommunityJoinRequest']) assert(api.includes(contract));
});

test('24 Community screen has text post creation only', () => {
  const community = read('apps/mobile/app/(app)/c/[handle].tsx');
  assert(community.includes('createCommunityPost'));
  assert(!community.includes('uploadPickedImageForPublishing'));
});

test('25 Community interactions and reporting are native', () => {
  const community = read('apps/mobile/app/(app)/c/[handle].tsx');
  for (const action of ['setCommunityPostReaction', 'createCommunityPostComment', 'reportCommunityPost']) assert(community.includes(action));
});

test('26 notification inbox can mark read', () => {
  const notifications = read('apps/mobile/app/(app)/(tabs)/notifications.tsx');
  assert(notifications.includes('markNotificationRead'));
});

test('27 notification routing uses safe parser', () => {
  const notifications = read('apps/mobile/app/(app)/(tabs)/notifications.tsx');
  assert(notifications.includes('parseNotificationTarget'));
  assert(read('apps/mobile/src/deep-links/routes.ts').includes('BLOCKED_PARAMS'));
});

test('28 settings uses notification preferences and explicit device push', () => {
  const settings = read('apps/mobile/app/(app)/settings/mobile.tsx');
  assert(settings.includes('getNotificationPreferences'));
  assert(settings.includes('enableMobileNotifications'));
  assert(settings.includes('Enable device push'));
});

test('29 settings uses discovery preferences', () => {
  const settings = read('apps/mobile/app/(app)/settings/mobile.tsx');
  assert(settings.includes('getDiscoveryPreferences'));
  assert(settings.includes('personalizedDiscoveryEnabled'));
});

test('30 app remains WebView-free', () => {
  assert(!/WebView/.test(mobileText()));
});

test('31 native push registration is not launched automatically', () => {
  const layout = read('apps/mobile/app/_layout.tsx');
  const auth = read('apps/mobile/src/auth/AuthProvider.tsx');
  assert(!/getExpoPushToken|Notifications\.requestPermissionsAsync/.test(layout));
  assert(!/getExpoPushToken|Notifications\.requestPermissionsAsync/.test(auth));
});

test('32 no camera capture is added', () => {
  assert(!/launchCameraAsync|requestCameraPermissionsAsync/.test(mobileText()));
});

test('33 native Reel publishing is scoped to the Reel creator flow', () => {
  const create = read('apps/mobile/app/(app)/reels/create.tsx');
  assert(create.includes('uploadPickedReelForPublishing'));
  assert(create.includes('publishMobileReel'));
  assert(!read('apps/mobile/app/(app)/(tabs)/home.tsx').includes('publishMobileReel'));
  assert(!read('apps/mobile/app/(app)/c/[handle].tsx').includes('publishMobileReel'));
});

test('34 docs are tracked', () => {
  assert(existsSync(join(root, 'docs/mobile-social-experience.md')));
  assert(existsSync(join(root, 'docs/release-f-mobile-social.md')));
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
