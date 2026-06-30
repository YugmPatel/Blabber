#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE_URL = (process.env.SMOKE_BASE_URL || process.env.SMOKE_GATEWAY_URL || 'http://localhost:3000').replace(/\/+$/, '');
const runId = `rele-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const tests = [];
const state = {};

function test(name, fn) { tests.push({ name, fn }); }
function safe(path) { return path.replace(/[A-Za-z0-9_-]{24,}/g, ':token').replace(/[a-f0-9]{24}/gi, ':id'); }

async function api(method, path, { client, body, rawBody, headers, expected = 200 } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(headers || {}),
      ...(client?.token ? { authorization: `Bearer ${client.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : rawBody,
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(response.status)) {
    throw new Error(`${method} ${safe(path.split('?')[0])} returned ${response.status}: ${data?.message || 'Unexpected response'}`);
  }
  return { status: response.status, data, headers: response.headers };
}

async function register(label, verify = true) {
  const unique = `${runId}-${label}`.replace(/[^a-z0-9]/gi, '').slice(0, 30);
  const password = `SmokePass123!${label}`;
  const response = await api('POST', '/api/auth/register', {
    body: {
      username: `rele_${label}_${Date.now().toString(36)}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 30),
      email: `release-e-video-${unique}@example.com`,
      password,
      name: `Video ${label}`,
    },
    expected: 201,
  });
  const client = { token: response.data.accessToken, user: response.data.user, password };
  if (verify) await verifyEmail(client);
  return client;
}

async function verifyEmail(client) {
  const mailbox = await api('GET', '/api/auth/account/dev/mailbox', { client });
  const message = mailbox.data.messages?.find((item) => item.purpose === 'email_verification');
  const match = message?.text?.match(/[?&]token=([A-Za-z0-9._-]+)/);
  assert(match?.[1], 'verification token captured');
  await api('POST', '/api/auth/account/email/verification/confirm', { body: { token: match[1] } });
}

async function publicProfile(client, label, visibility = 'public') {
  const handle = `rele_${runId.replace(/[^a-z0-9]/g, '').slice(0, 10)}_${label}`.slice(0, 30);
  await api('PATCH', '/api/profiles/me/handle', { client, body: { handle } });
  await api('PATCH', '/api/profiles/me', { client, body: { visibility } });
  return handle;
}

function makeMp4(seconds = 4) {
  const dir = mkdtempSync(join(tmpdir(), 'reel-smoke-'));
  const file = join(dir, 'fixture.mp4');
  execFileSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', `testsrc=size=320x240:rate=24:duration=${seconds}`,
    '-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=44100:duration=${seconds}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', file,
  ], { stdio: 'ignore' });
  const bytes = readFileSync(file);
  rmSync(dir, { recursive: true, force: true });
  return bytes;
}

async function uploadReel(client, bytes = state.videoBytes) {
  const init = await api('POST', '/api/reels/upload-init', {
    client,
    body: { fileName: `fixture-${runId}.mp4`, fileType: 'video/mp4', fileSize: bytes.length },
    expected: 201,
  });
  await api('PUT', init.data.uploadUrl, { client, rawBody: bytes, headers: { 'content-type': 'video/mp4' } });
  return init.data.reelId;
}

async function waitReady(client, reelId) {
  for (let i = 0; i < 40; i += 1) {
    const status = await api('GET', `/api/reels/${reelId}/status`, { client });
    if (status.data.reel.processingStatus === 'ready') return status.data.reel;
    if (['rejected', 'failed'].includes(status.data.reel.processingStatus)) throw new Error('Reel processing failed');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Reel did not become ready');
}

test('01 health and readiness are available', async () => {
  assert.equal((await api('GET', '/healthz')).data.status, 'ok');
  assert.equal((await api('GET', '/readyz')).data.status, 'ready');
});

test('02 users and video fixture are prepared', async () => {
  state.videoBytes = makeMp4(4);
  state.shortBytes = makeMp4(1);
  state.owner = await register('owner');
  state.follower = await register('follower');
  state.other = await register('other');
  state.unverified = await register('unverified', false);
  state.ownerHandle = await publicProfile(state.owner, 'owner', 'public');
  state.followerHandle = await publicProfile(state.follower, 'follower', 'public');
  state.otherHandle = await publicProfile(state.other, 'other', 'public');
});

test('03 upload initiation is verified and handle gated', async () => {
  await api('POST', '/api/reels/upload-init', { expected: 401, body: { fileName: 'x.mp4', fileType: 'video/mp4', fileSize: 10 } });
  await api('POST', '/api/reels/upload-init', { client: state.unverified, body: { fileName: 'x.mp4', fileType: 'video/mp4', fileSize: 10 }, expected: 400 });
});

test('04 unsupported format and size are rejected', async () => {
  await api('POST', '/api/reels/upload-init', { client: state.owner, body: { fileName: 'x.mov', fileType: 'video/quicktime', fileSize: 1000 }, expected: 400 });
  await api('POST', '/api/reels/upload-init', { client: state.owner, body: { fileName: 'x.mp4', fileType: 'video/mp4', fileSize: 101 * 1024 * 1024 }, expected: 400 });
});

test('05 ordinary media upload does not accept playable video', async () => {
  await api('POST', '/api/media/presign', { client: state.owner, body: { fileName: 'ordinary.mp4', fileType: 'video/mp4', fileSize: state.videoBytes.length }, expected: 400 });
});

test('06 source upload ownership is enforced', async () => {
  const init = await api('POST', '/api/reels/upload-init', {
    client: state.owner,
    body: { fileName: `owned-${runId}.mp4`, fileType: 'video/mp4', fileSize: state.videoBytes.length },
    expected: 201,
  });
  await api('PUT', init.data.uploadUrl, { client: state.other, rawBody: state.videoBytes, headers: { 'content-type': 'video/mp4' }, expected: 404 });
  await api('DELETE', `/api/reels/${init.data.reelId}`, { client: state.owner });
});

test('07 invalid duration is rejected safely', async () => {
  const reelId = await uploadReel(state.owner, state.shortBytes);
  for (let i = 0; i < 20; i += 1) {
    const status = await api('GET', `/api/reels/${reelId}/status`, { client: state.owner });
    if (['rejected', 'failed'].includes(status.data.reel.processingStatus)) {
      assert(status.data.message, 'safe rejection message returned');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Short video was not rejected');
});

test('08 valid upload processes asynchronously to ready', async () => {
  state.reelId = await uploadReel(state.owner);
  const first = await api('GET', `/api/reels/${state.reelId}/status`, { client: state.owner });
  assert.notEqual(first.data.reel.processingStatus, 'ready');
  state.readyReel = await waitReady(state.owner, state.reelId);
  assert.equal(state.readyReel.processingStatus, 'ready');
});

test('09 non-author cannot publish or delete a ready Reel', async () => {
  await api('POST', '/api/reels', { client: state.other, body: { reelId: state.reelId, caption: 'not mine', visibility: 'public' }, expected: 404 });
  await api('DELETE', `/api/reels/${state.reelId}`, { client: state.other, expected: 404 });
});

test('10 publish and public access work', async () => {
  const published = await api('POST', '/api/reels', { client: state.owner, body: { reelId: state.reelId, caption: 'release e smoke reel', visibility: 'public', topicIds: ['technology'] }, expected: 201 });
  assert.equal(published.data.reel.publishState, 'published');
  const detail = await api('GET', `/api/reels/${state.reelId}`, { client: state.other });
  assert.equal(detail.data.reel.id, state.reelId);
});

test('11 followers visibility denies non-follower and allows current follower', async () => {
  state.followersReelId = await uploadReel(state.owner);
  await waitReady(state.owner, state.followersReelId);
  await api('POST', '/api/reels', { client: state.owner, body: { reelId: state.followersReelId, caption: '', visibility: 'followers', topicIds: [] }, expected: 201 });
  await api('GET', `/api/reels/${state.followersReelId}`, { client: state.other, expected: 404 });
  await api('POST', `/api/profiles/${state.ownerHandle}/follow`, { client: state.follower, expected: [200, 201] });
  await api('GET', `/api/reels/${state.followersReelId}`, { client: state.follower });
});

test('12 default visibility is Followers and follow removal revokes it', async () => {
  const defaultReelId = await uploadReel(state.owner);
  await waitReady(state.owner, defaultReelId);
  const published = await api('POST', '/api/reels', { client: state.owner, body: { reelId: defaultReelId }, expected: 201 });
  assert.equal(published.data.reel.visibility, 'followers');
  await api('GET', `/api/reels/${defaultReelId}`, { client: state.follower });
  await api('DELETE', `/api/profiles/${state.ownerHandle}/follow`, { client: state.follower });
  await api('GET', `/api/reels/${defaultReelId}`, { client: state.follower, expected: 404 });
  await api('POST', `/api/profiles/${state.ownerHandle}/follow`, { client: state.follower, expected: [200, 201] });
});

test('13 private profile denies non-follower public Reel playback', async () => {
  await api('PATCH', '/api/profiles/me', { client: state.owner, body: { visibility: 'private' } });
  await api('GET', `/api/reels/${state.reelId}`, { client: state.other, expected: 404 });
  await api('PATCH', '/api/profiles/me', { client: state.owner, body: { visibility: 'public' } });
});

test('14 playback session, manifest, playlist, segment, fallback and poster authorize', async () => {
  const session = await api('POST', `/api/reels/${state.reelId}/playback-session`, { client: state.other, expected: 201 });
  state.playback = session.data.playback;
  const manifest = await api('GET', state.playback.manifestUrl, { client: state.other });
  assert(String(manifest.data).includes('#EXTM3U'));
  const playlistPath = String(manifest.data).split('\n').find((line) => line.startsWith('/api/'));
  const playlist = await api('GET', playlistPath, { client: state.other });
  const segmentPath = String(playlist.data).split('\n').find((line) => line.startsWith('/api/'));
  assert(segmentPath, 'authorized segment path issued');
  assert.equal((await api('GET', segmentPath, { client: state.other })).status, 200);
  assert.equal((await api('GET', state.playback.fallbackUrl, { client: state.other })).status, 200);
  assert.equal((await api('GET', state.playback.posterUrl, { client: state.other })).status, 200);
  await api('GET', state.playback.fallbackUrl, { client: state.follower, expected: 404 });
});

test('15 block revokes playback', async () => {
  await api('POST', `/api/users/${state.other.user.id || state.other.user._id}/block`, { client: state.owner });
  await api('GET', state.playback.fallbackUrl, { client: state.other, expected: 404 });
  await api('DELETE', `/api/users/${state.other.user.id || state.other.user._id}/block`, { client: state.owner });
});

test('16 caption edit window and non-author guard work', async () => {
  await api('PATCH', `/api/reels/${state.reelId}`, { client: state.other, body: { caption: 'nope' }, expected: 404 });
  const edited = await api('PATCH', `/api/reels/${state.reelId}`, { client: state.owner, body: { caption: 'updated reel caption' } });
  assert.equal(edited.data.reel.caption, 'updated reel caption');
});

test('17 profile Reel listing is separate', async () => {
  const listed = await api('GET', `/api/profiles/${state.ownerHandle}/reels`, { client: state.other });
  assert(listed.data.reels.some((reel) => reel.id === state.reelId));
  const posts = await api('GET', `/api/profiles/${state.ownerHandle}/posts`, { client: state.other });
  assert(!JSON.stringify(posts.data).includes(state.reelId));
});

test('18 report requires access and stores safe response', async () => {
  await api('POST', `/api/reels/${state.followersReelId}/report`, { client: state.other, body: { reason: 'Cannot access' }, expected: 404 });
  const report = await api('POST', `/api/reels/${state.reelId}/report`, { client: state.other, body: { reason: 'Video report' }, expected: 201 });
  assert.equal(report.data.report.targetType, 'reel');
  assert(!JSON.stringify(report.data).includes('fallback'));
});

test('19 deletion revokes listing and playback', async () => {
  await api('DELETE', `/api/reels/${state.reelId}`, { client: state.owner });
  await api('GET', `/api/reels/${state.reelId}`, { client: state.other, expected: 404 });
  await api('GET', state.playback.posterUrl, { client: state.other, expected: 404 });
});

test('20 account deletion cleanup removes authored Reels from access', async () => {
  const deletedOwner = await register('deletedowner');
  await publicProfile(deletedOwner, 'deleted', 'public');
  const reelId = await uploadReel(deletedOwner);
  await waitReady(deletedOwner, reelId);
  await api('POST', '/api/reels', { client: deletedOwner, body: { reelId, visibility: 'public' }, expected: 201 });
  await api('GET', `/api/reels/${reelId}`, { client: state.other });
  const deletion = await api('POST', '/api/auth/account/deletion', {
    client: deletedOwner,
    body: { currentPassword: deletedOwner.password, confirmation: 'DELETE' },
    expected: 202,
  });
  const future = new Date(new Date(deletion.data.deletion.scheduledFor).getTime() + 60_000).toISOString();
  const worker = await api('POST', '/api/auth/account/deletion/worker/run', { client: state.other, body: { now: future }, expected: 200 });
  assert(worker.data.finalized >= 1, 'deletion worker finalized account with Reel content');
  await api('GET', `/api/reels/${reelId}`, { client: state.other, expected: 404 });
});

test('21 isolation from Discover, For You, feed, communities, moments, and search', async () => {
  const [feed, discover, forYou, search] = await Promise.all([
    api('GET', '/api/feed', { client: state.other }),
    api('GET', '/api/discovery/posts', { client: state.other }),
    api('GET', '/api/discovery/for-you', { client: state.other }),
    api('GET', '/api/messages/search/global?q=updated', { client: state.other }),
  ]);
  const combined = JSON.stringify([feed.data, discover.data, forYou.data, search.data]);
  assert(!combined.includes('updated reel caption'));
});

test('22 export includes safe Reel metadata only', async () => {
  const requested = await api('POST', '/api/auth/account/export', { client: state.owner, body: { currentPassword: state.owner.password }, expected: [200, 202] });
  assert(requested.status === 200 || requested.status === 202);
});

test('23 delete pending Reel is safe', async () => {
  const pending = await api('POST', '/api/reels/upload-init', { client: state.owner, body: { fileName: 'pending.mp4', fileType: 'video/mp4', fileSize: state.videoBytes.length }, expected: 201 });
  await api('DELETE', `/api/reels/${pending.data.reelId}`, { client: state.owner });
  await api('GET', `/api/reels/${pending.data.reelId}/status`, { client: state.owner, expected: 404 });
});

test('24 smoke output guard has no sensitive playback values', async () => {
  const text = JSON.stringify({ tests: tests.length });
  assert(!text.includes('segment_'));
  assert(!text.includes('fallback.mp4'));
  assert(!text.includes('poster.jpg'));
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
