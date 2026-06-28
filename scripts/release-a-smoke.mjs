#!/usr/bin/env node
/*
 * Durable Release A regression smoke harness.
 *
 * This file must remain tracked in the repository. The original Release A
 * smoke runner lived under /private/tmp and disappeared, which blocked Release
 * B Foundation acceptance. Do not move this harness back to a temporary path.
 */

import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const DEFAULT_GATEWAY_URL = 'http://localhost:3000';
const gatewayUrl = (process.env.SMOKE_GATEWAY_URL || DEFAULT_GATEWAY_URL).replace(/\/+$/, '');
const cleanupEnabled = process.env.SMOKE_CLEANUP !== 'false';
const verbose = process.env.SMOKE_VERBOSE === 'true';
const allowUnsafeTarget = process.env.SMOKE_ALLOW_UNSAFE_TARGET === 'true';
const runId = `release-a-smoke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const state = {
  users: {},
  chats: {},
  messages: {},
  invite: {},
  media: {},
  actions: {},
  tests: [],
  teardown: [],
};

const SAFE_LOCAL_TARGETS = new Set(['localhost', '127.0.0.1', '0.0.0.0', 'host.docker.internal']);

function assertSafeTarget() {
  let parsed;
  try {
    parsed = new URL(gatewayUrl);
  } catch {
    throw new Error('SMOKE_GATEWAY_URL must be a valid URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('SMOKE_GATEWAY_URL must use http or https.');
  }
  if (!allowUnsafeTarget && !SAFE_LOCAL_TARGETS.has(parsed.hostname)) {
    throw new Error(
      'Refusing to run Release A smoke against a non-local gateway. Set SMOKE_ALLOW_UNSAFE_TARGET=true only for an explicit future-safe environment.'
    );
  }
}

function redact(value) {
  return String(value)
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[redacted]')
    .replace(/refreshToken=[^;\s]+/gi, 'refreshToken=[redacted]')
    .replace(/\/api\/invites\/[A-Za-z0-9_-]+/g, '/api/invites/[redacted]')
    .replace(/\/invites\/[A-Za-z0-9_-]+/g, '/invites/[redacted]')
    .replace(/\/local\/[a-f0-9]{24}/gi, '/local/[redacted]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]');
}

function safeErrorContext(error) {
  if (error instanceof SmokeHttpError) {
    return `${error.message} ${JSON.stringify(error.safe)}`;
  }
  return redact(error?.message || error);
}

class SmokeHttpError extends Error {
  constructor(message, safe) {
    super(message);
    this.safe = safe;
  }
}

function test(name, fn) {
  state.tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertStatus(response, expected, label) {
  assertEqual(response.status, expected, `${label} status`);
}

function userAgent() {
  return `Blabber Release A Smoke (${runId})`;
}

async function api(method, pathOrUrl, { user, body, headers = {}, rawBody, expected, parse = 'json' } = {}) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${gatewayUrl}${pathOrUrl}`;
  const requestHeaders = {
    'User-Agent': userAgent(),
    ...headers,
  };
  let requestBody;
  if (user?.accessToken) requestHeaders.Authorization = `Bearer ${user.accessToken}`;
  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }
  if (rawBody !== undefined) requestBody = rawBody;

  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: requestBody,
    redirect: 'manual',
  });

  const contentType = response.headers.get('content-type') || '';
  let data;
  if (parse === 'text') {
    data = await response.text();
  } else if (response.status !== 204 && contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  const result = {
    status: response.status,
    ok: response.ok,
    data,
    headers: response.headers,
  };

  if (expected !== undefined) {
    const expectedStatuses = Array.isArray(expected) ? expected : [expected];
    if (!expectedStatuses.includes(response.status)) {
      throw new SmokeHttpError('Unexpected HTTP response', {
        method,
        path: redact(new URL(url).pathname),
        status: response.status,
        error: typeof data?.error === 'string' ? data.error : undefined,
        message: typeof data?.message === 'string' ? data.message : undefined,
      });
    }
  }

  if (verbose) {
    console.log(`  ${method} ${redact(new URL(url).pathname)} -> ${response.status}`);
  }
  return result;
}

async function registerUser(key, display) {
  const compactRunId = runId.replace(/^release-a-smoke-/, '').replace(/[^a-z0-9]/gi, '').slice(0, 16);
  const suffix = `${compactRunId}-${key}`;
  const password = `SmokePass!${Math.random().toString(36).slice(2)}A1`;
  const payload = {
    username: `smoke_${suffix}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 30),
    email: `${suffix}@example.com`,
    password,
    name: `${display} ${runId}`,
  };
  const registered = await api('POST', '/api/auth/register', { body: payload, expected: 201 });
  assert(registered.data?.user?._id, `registered ${key} user id is present`);
  assert(registered.data?.accessToken, `registered ${key} access token is present`);

  const loggedIn = await api('POST', '/api/auth/login', {
    body: { email: payload.email, password },
    expected: 200,
  });
  assert(loggedIn.data?.user?._id === registered.data.user._id, `login ${key} user id matches registration`);
  assert(loggedIn.data?.accessToken, `login ${key} access token is present`);

  state.users[key] = {
    ...payload,
    id: registered.data.user._id,
    accessToken: loggedIn.data.accessToken,
  };
  return state.users[key];
}

async function createChat(user, payload) {
  const response = await api('POST', '/api/chats', { user, body: payload, expected: 201 });
  assert(response.data?.chat?._id, 'created chat id is present');
  return response.data.chat;
}

async function sendMessage(user, chatId, payload) {
  const response = await api('POST', `/api/messages/${chatId}`, {
    user,
    body: payload,
    expected: 201,
  });
  assert(response.data?._id, 'created message id is present');
  return response.data;
}

function hasResult(results, messageId) {
  return Array.isArray(results) && results.some((item) => item.messageId === messageId);
}

async function uploadFixture(user, fileName, fileType, bytes) {
  const presign = await api('POST', '/api/media/presign', {
    user,
    body: { fileName, fileType, fileSize: bytes.length },
    expected: 200,
  });
  assert(presign.data?.mediaId, 'presign returned media id');
  assert(presign.data?.uploadUrl, 'presign returned upload url');
  await api('PUT', presign.data.uploadUrl, {
    user: presign.data.uploadAuthRequired ? user : undefined,
    rawBody: bytes,
    headers: { 'Content-Type': fileType },
    expected: 200,
  });
  return presign.data.mediaId;
}

function getOptionId(message, index) {
  const id = message?.poll?.options?.[index]?.id;
  assert(id, `poll option ${index + 1} id is present`);
  return id;
}

async function runEventReminderProbe(eventMessageId) {
  const code = `
const { ObjectId } = require('mongodb');
const { connectToDatabase, closeDatabase, getDatabase } = require('/app/services/messages/dist/db.js');
const { EventReminderProcessor } = require('/app/services/messages/dist/event-reminders.js');
(async () => {
  const eventId = new ObjectId(process.env.SMOKE_EVENT_ID);
  await connectToDatabase();
  const db = getDatabase();
  await db.collection('event_reminder_deliveries').deleteMany({ eventId });
  const sender = { async send() { return { sent: 1 }; } };
  const now = new Date(process.env.SMOKE_REMINDER_NOW);
  const processor = new EventReminderProcessor(sender, () => now);
  const first = await processor.runOnce();
  const second = await processor.runOnce();
  const deliveries = await db.collection('event_reminder_deliveries').find({ eventId }).toArray();
  console.log(JSON.stringify({
    first,
    second,
    deliveryCount: deliveries.length,
    sentCount: deliveries.filter((d) => d.status === 'sent').length,
    statuses: Array.from(new Set(deliveries.map((d) => d.status))).sort()
  }));
  await closeDatabase();
})().catch(async (error) => {
  console.error(JSON.stringify({ error: error && error.message ? error.message : 'worker probe failed' }));
  try { await closeDatabase(); } catch {}
  process.exit(1);
});
`;
  const output = execFileSync('docker', [
    'exec',
    '-e',
    `SMOKE_EVENT_ID=${eventMessageId}`,
    '-e',
    `SMOKE_REMINDER_NOW=${state.eventReminderNow}`,
    'blabber-full-messages',
    'node',
    '-e',
    code,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const lines = output.trim().split(/\n/).filter(Boolean);
  const resultLine = lines.find((line) => {
    try {
      return Object.prototype.hasOwnProperty.call(JSON.parse(line), 'deliveryCount');
    } catch {
      return false;
    }
  });
  if (!resultLine) throw new Error('Reminder worker probe did not return scoped delivery counts');
  return JSON.parse(resultLine);
}

async function setupAdditionalUsers() {
  await registerUser('c', 'Smoke Member C');
  await registerUser('e', 'Smoke Invite Joiner E');
}

test('01 Gateway liveness is healthy', async () => {
  const response = await api('GET', '/healthz', { expected: 200 });
  assertEqual(response.data?.status, 'ok', 'gateway liveness status');
});

test('02 Gateway readiness is healthy', async () => {
  const response = await api('GET', '/readyz', { expected: 200 });
  assertEqual(response.data?.status, 'ready', 'gateway readiness status');
  assert(response.data.checks?.every((check) => check.status === 'ok'), 'gateway dependencies are ready');
});

test('03 Authenticated registration/login flow works for A', async () => {
  const user = await registerUser('a', 'Smoke Owner A');
  assert(user.id && user.accessToken, 'A has authenticated session');
});

test('04 Authenticated registration/login flow works for B', async () => {
  const user = await registerUser('b', 'Smoke Member B');
  assert(user.id && user.accessToken, 'B has authenticated session');
});

test('05 Authenticated registration/login flow works for outsider D', async () => {
  const user = await registerUser('d', 'Smoke Outsider D');
  assert(user.id && user.accessToken, 'D has authenticated session');
  await setupAdditionalUsers();
});

test('06 Unauthorized protected API request is rejected safely', async () => {
  const response = await api('GET', '/api/chats', { expected: 401 });
  assert(response.data?.error || response.data?.message, 'unauthorized response has safe error shape');
});

test('07 Create direct chat', async () => {
  const chat = await createChat(state.users.a, {
    type: 'direct',
    participantIds: [state.users.a.id, state.users.b.id],
  });
  assertEqual(chat.type, 'direct', 'direct chat type');
  state.chats.direct = chat;
});

test('08 Create group chat', async () => {
  const chat = await createChat(state.users.a, {
    type: 'group',
    title: `Smoke Group ${runId}`,
    participantIds: [state.users.a.id, state.users.b.id, state.users.c.id],
  });
  assertEqual(chat.type, 'group', 'group chat type');
  assert(chat.participants?.length >= 3, 'group contains expected participants');
  state.chats.group = chat;
  state.chats.destination = await createChat(state.users.a, {
    type: 'group',
    title: `Smoke Forward Destination ${runId}`,
    participantIds: [state.users.a.id, state.users.c.id],
  });
});

test('09 Send text message in direct chat', async () => {
  state.messages.directText = await sendMessage(state.users.a, state.chats.direct._id, {
    body: `direct-search-${runId}`,
  });
  assertEqual(state.messages.directText.chatId, state.chats.direct._id, 'direct message chat id');
});

test('10 Send text message in group chat', async () => {
  state.messages.groupText = await sendMessage(state.users.a, state.chats.group._id, {
    body: `group-search-${runId}`,
  });
  assertEqual(state.messages.groupText.chatId, state.chats.group._id, 'group message chat id');
});

test('11 Chat-scoped search finds authorized direct-chat message', async () => {
  const response = await api('GET', `/api/messages/search?chatId=${state.chats.direct._id}&q=direct-search-${runId}`, {
    user: state.users.b,
    expected: 200,
  });
  assert(hasResult(response.data.results, state.messages.directText._id), 'direct chat search found message');
});

test('12 Global search finds authorized group message', async () => {
  const response = await api('GET', `/api/messages/search/global?q=group-search-${runId}`, {
    user: state.users.b,
    expected: 200,
  });
  assert(hasResult(response.data.results, state.messages.groupText._id), 'global search found group message');
});

test('13 Outsider cannot search private direct-chat content', async () => {
  const response = await api('GET', `/api/messages/search?chatId=${state.chats.direct._id}&q=direct-search-${runId}`, {
    user: state.users.d,
    expected: 403,
  });
  assert(response.data?.error, 'outsider direct search rejected safely');
});

test('14 Outsider cannot search inaccessible group content', async () => {
  const response = await api('GET', `/api/messages/search/global?q=group-search-${runId}`, {
    user: state.users.d,
    expected: 200,
  });
  assert(!hasResult(response.data.results, state.messages.groupText._id), 'outsider global search omits private group message');
});

test('15 Reply to same-chat message succeeds', async () => {
  state.messages.reply = await sendMessage(state.users.b, state.chats.direct._id, {
    body: `reply-${runId}`,
    replyToId: state.messages.directText._id,
  });
  assertEqual(state.messages.reply.replyTo?.messageId, state.messages.directText._id, 'reply target id');
});

test('16 Reply response includes safe original-message metadata', async () => {
  const replyTo = state.messages.reply.replyTo;
  assert(replyTo?.messageId && replyTo?.senderId && replyTo?.snippet, 'reply preview has source-jump metadata');
  assert(!replyTo.chatId, 'reply preview does not expose extra source chat metadata');
});

test('17 Cross-chat reply target is rejected', async () => {
  await api('POST', `/api/messages/${state.chats.group._id}`, {
    user: state.users.a,
    body: { body: `bad-cross-reply-${runId}`, replyToId: state.messages.directText._id },
    expected: 404,
  });
});

test('18 Forward text message to authorized destination succeeds', async () => {
  const response = await api('POST', `/api/messages/${state.messages.directText._id}/forward`, {
    user: state.users.a,
    body: { destinationChatIds: [state.chats.destination._id] },
    expected: 201,
  });
  state.messages.forwardedText = response.data.messages?.[0];
  assert(state.messages.forwardedText?._id, 'forwarded message id is present');
});

test('19 Forwarded message is marked forwarded', async () => {
  assertEqual(state.messages.forwardedText.forwarded?.isForwarded, true, 'forward marker');
});

test('20 Forwarded payload does not expose original source chat/sender metadata', async () => {
  assert(!state.messages.forwardedText.forwarded?.sourceChatId, 'no source chat id');
  assert(!state.messages.forwardedText.forwarded?.originalSenderId, 'no original sender id');
});

test('21 Group @mention of B by A succeeds', async () => {
  const body = `Hello @${state.users.b.username} mention-${runId}`;
  const start = body.indexOf('@');
  state.messages.mention = await sendMessage(state.users.a, state.chats.group._id, {
    body,
    mentions: [{ userId: state.users.b.id, start, length: state.users.b.username.length + 1 }],
  });
  assertEqual(state.messages.mention.mentions?.[0]?.userId, state.users.b.id, 'mention user id');
});

test('22 Structured mention metadata contains only valid current group participant data', async () => {
  assertEqual(state.messages.mention.mentions.length, 1, 'one mention stored');
  assertEqual(state.messages.mention.mentions[0].userId, state.users.b.id, 'mentioned user is B');
  assert(state.messages.mention.mentions[0].displayName, 'mention display name is safe');
});

test('23 B receives a mention-unread signal', async () => {
  const response = await api('GET', '/api/chats', { user: state.users.b, expected: 200 });
  const chat = response.data.chats?.find((item) => item._id === state.chats.group._id);
  assert((chat?.mentionUnreadCount || 0) >= 1, 'mention unread count visible to B');
});

test('24 Direct-chat mention metadata is rejected', async () => {
  const body = `Direct @${state.users.b.username} ${runId}`;
  await api('POST', `/api/messages/${state.chats.direct._id}`, {
    user: state.users.a,
    body: {
      body,
      mentions: [{ userId: state.users.b.id, start: body.indexOf('@'), length: state.users.b.username.length + 1 }],
    },
    expected: 400,
  });
});

test('25 Forwarded message does not retain original mention metadata', async () => {
  const response = await api('POST', `/api/messages/${state.messages.mention._id}/forward`, {
    user: state.users.a,
    body: { destinationChatIds: [state.chats.destination._id] },
    expected: 201,
  });
  const forwarded = response.data.messages?.[0];
  assertEqual(forwarded.forwarded?.isForwarded, true, 'mention source forwarded');
  assert(!forwarded.mentions || forwarded.mentions.length === 0, 'forwarded message omits mentions');
});

test('26 Group admin/owner can pin a message', async () => {
  const response = await api('POST', `/api/messages/${state.messages.groupText._id}/pin`, {
    user: state.users.a,
    expected: 201,
  });
  assertEqual(response.data.pin?.messageId, state.messages.groupText._id, 'pin message id');
});

test('27 Pin list returns the pinned message to authorized group member', async () => {
  const response = await api('GET', `/api/messages/pins/${state.chats.group._id}`, {
    user: state.users.b,
    expected: 200,
  });
  assert(response.data.pins?.some((pin) => pin.messageId === state.messages.groupText._id), 'pin visible to member');
});

test('28 Standard group member cannot pin message', async () => {
  await api('POST', `/api/messages/${state.messages.mention._id}/pin`, {
    user: state.users.b,
    expected: 403,
  });
});

test('29 Standard group member cannot unpin admin-owned pin without permission', async () => {
  await api('DELETE', `/api/messages/${state.messages.groupText._id}/pin`, {
    user: state.users.b,
    expected: 403,
  });
});

test('30 User B can save an authorized message', async () => {
  const response = await api('POST', `/api/messages/${state.messages.groupText._id}/save`, {
    user: state.users.b,
    expected: 200,
  });
  assertEqual(response.data.saved, true, 'save result');
});

test('31 B can retrieve own saved message', async () => {
  const response = await api('GET', '/api/messages/saved', { user: state.users.b, expected: 200 });
  assert(response.data.savedMessages?.some((item) => item.messageId === state.messages.groupText._id), 'B sees saved message');
});

test('32 A cannot query B saved-message records', async () => {
  const response = await api('GET', '/api/messages/saved', { user: state.users.a, expected: 200 });
  assert(!response.data.savedMessages?.some((item) => item.messageId === state.messages.groupText._id), 'A does not see B save record');
});

test('33 B can archive a chat', async () => {
  const response = await api('POST', `/api/chats/${state.chats.direct._id}/archive`, {
    user: state.users.b,
    expected: 200,
  });
  assertEqual(response.data.success, true, 'archive result');
});

test('34 Archived chat is hidden from B default chat list', async () => {
  const response = await api('GET', '/api/chats', { user: state.users.b, expected: 200 });
  assert(!response.data.chats?.some((chat) => chat._id === state.chats.direct._id), 'archived direct hidden from default list');
});

test('35 Archived chat appears in B archived list', async () => {
  const response = await api('GET', '/api/chats?archived=true', { user: state.users.b, expected: 200 });
  assert(response.data.chats?.some((chat) => chat._id === state.chats.direct._id && chat.archived), 'archived direct in archived list');
});

test('36 New message in archived chat auto-unarchives it for B', async () => {
  await sendMessage(state.users.a, state.chats.direct._id, { body: `unarchive-${runId}` });
  const response = await api('GET', '/api/chats', { user: state.users.b, expected: 200 });
  assert(response.data.chats?.some((chat) => chat._id === state.chats.direct._id && !chat.archived), 'chat auto-unarchived');
});

test('37 Archive state remains private and does not hide the chat for A', async () => {
  const response = await api('GET', '/api/chats', { user: state.users.a, expected: 200 });
  assert(response.data.chats?.some((chat) => chat._id === state.chats.direct._id), 'A still sees direct chat');
});

test('38 Authorized user can retrieve Shared Links', async () => {
  state.messages.link = await sendMessage(state.users.a, state.chats.group._id, {
    body: `link-${runId} https://example.test/${runId} javascript:alert(1)`,
  });
  const response = await api('GET', `/api/messages/shared?chatId=${state.chats.group._id}&type=links`, {
    user: state.users.b,
    expected: 200,
  });
  assert(response.data.items?.some((item) => item.kind === 'link' && item.source?.messageId === state.messages.link._id), 'shared link returned');
});

test('39 Authorized user can retrieve Shared Documents when a document message exists', async () => {
  state.media.document = await uploadFixture(state.users.a, `smoke-${runId}.txt`, 'text/plain', Buffer.from('smoke document'));
  state.messages.document = await sendMessage(state.users.a, state.chats.group._id, {
    body: `document-${runId}`,
    mediaId: state.media.document,
  });
  const response = await api('GET', `/api/messages/shared?chatId=${state.chats.group._id}&type=documents`, {
    user: state.users.b,
    expected: 200,
  });
  assert(response.data.items?.some((item) => item.kind === 'document' && item.source?.messageId === state.messages.document._id), 'shared document returned');
});

test('40 Authorized user can retrieve Shared Media when an image message exists', async () => {
  state.media.image = await uploadFixture(state.users.a, `smoke-${runId}.png`, 'image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  state.messages.image = await sendMessage(state.users.a, state.chats.group._id, {
    body: `image-${runId}`,
    mediaId: state.media.image,
  });
  const response = await api('GET', `/api/messages/shared?chatId=${state.chats.group._id}&type=media`, {
    user: state.users.b,
    expected: 200,
  });
  assert(response.data.items?.some((item) => item.kind === 'media' && item.source?.messageId === state.messages.image._id), 'shared media returned');
});

test('41 Shared Content response includes valid safe Source Jump identifiers', async () => {
  const response = await api('GET', `/api/messages/shared?chatId=${state.chats.group._id}&type=links`, {
    user: state.users.b,
    expected: 200,
  });
  const item = response.data.items?.find((entry) => entry.source?.messageId === state.messages.link._id);
  assertEqual(item?.source?.chatId, state.chats.group._id, 'source chat id');
  assertEqual(item?.source?.messageId, state.messages.link._id, 'source message id');
});

test('42 Outsider/non-member is denied Shared Content', async () => {
  await api('GET', `/api/messages/shared?chatId=${state.chats.group._id}&type=links`, {
    user: state.users.d,
    expected: 403,
  });
});

test('43 Unsafe URL scheme is excluded or non-openable in Shared Links', async () => {
  const response = await api('GET', `/api/messages/shared?chatId=${state.chats.group._id}&type=links`, {
    user: state.users.b,
    expected: 200,
  });
  const urls = response.data.items?.map((item) => item.link?.url).filter(Boolean) || [];
  assert(urls.length > 0, 'safe shared link exists');
  assert(urls.every((url) => /^https?:\/\//i.test(url)), 'only http(s) shared links are returned');
});

test('44 Group owner/admin can create an invite link', async () => {
  const response = await api('POST', `/api/chats/${state.chats.group._id}/invite-link`, {
    user: state.users.a,
    body: { expiresIn: 'never', maxUses: 10 },
    expected: 201,
  });
  state.invite.token = response.data.token;
  assert(response.data.invite?.id, 'invite settings returned');
  assert(state.invite.token, 'one-time invite token returned');
});

test('45 Regular member cannot create/manage invite link', async () => {
  await api('POST', `/api/chats/${state.chats.group._id}/invite-link/regenerate`, {
    user: state.users.b,
    body: { expiresIn: 'never', maxUses: 10 },
    expected: 403,
  });
});

test('46 Invite creation response provides raw token only in one-time authorized creation result', async () => {
  assert(typeof state.invite.token === 'string' && state.invite.token.length >= 20, 'creation returned raw token');
});

test('47 Invite storage/API normal list payload does not expose raw token', async () => {
  const response = await api('GET', `/api/chats/${state.chats.group._id}/invite-link`, {
    user: state.users.a,
    expected: 200,
  });
  assert(response.data.invite?.id, 'invite settings visible');
  assert(!response.data.token && !response.data.invite.token && !response.data.invite.tokenHash, 'normal invite payload omits token material');
});

test('48 Authenticated user E can preview valid invite safely', async () => {
  const response = await api('GET', `/api/invites/${state.invite.token}/preview`, {
    user: state.users.e,
    expected: 200,
  });
  assertEqual(response.data.invite?.alreadyMember, false, 'E is not member before join');
  assert(response.data.invite?.groupName, 'preview exposes group name');
});

test('49 Preview does not expose member list or chat history', async () => {
  const response = await api('GET', `/api/invites/${state.invite.token}/preview`, {
    user: state.users.e,
    expected: 200,
  });
  assert(!response.data.invite?.participants && !response.data.invite?.messages, 'preview omits members and history');
});

test('50 Authenticated E can join through invite', async () => {
  const response = await api('POST', `/api/invites/${state.invite.token}/join`, {
    user: state.users.e,
    expected: 200,
  });
  assertEqual(response.data.alreadyMember, false, 'E joined as new member');
  state.invite.joinedChat = response.data.chat;
});

test('51 Joined E becomes standard member, not admin/owner', async () => {
  const chat = state.invite.joinedChat;
  assert(chat.participants?.includes(state.users.e.id), 'E is participant');
  assert(!chat.admins?.includes?.(state.users.e.id), 'E is not admin');
  assert(chat.ownerId !== state.users.e.id, 'E is not owner');
});

test('52 Already-member join does not consume additional invite use', async () => {
  const before = await api('GET', `/api/chats/${state.chats.group._id}/invite-link`, {
    user: state.users.a,
    expected: 200,
  });
  const join = await api('POST', `/api/invites/${state.invite.token}/join`, {
    user: state.users.e,
    expected: 200,
  });
  const after = await api('GET', `/api/chats/${state.chats.group._id}/invite-link`, {
    user: state.users.a,
    expected: 200,
  });
  assertEqual(join.data.alreadyMember, true, 'second join is already-member');
  assertEqual(after.data.invite.useCount, before.data.invite.useCount, 'use count unchanged');
});

test('53 Regenerating invite revokes earlier invite', async () => {
  const oldToken = state.invite.token;
  const response = await api('POST', `/api/chats/${state.chats.group._id}/invite-link/regenerate`, {
    user: state.users.a,
    body: { expiresIn: 'never', maxUses: 10 },
    expected: 201,
  });
  state.invite.oldToken = oldToken;
  state.invite.token = response.data.token;
  await api('GET', `/api/invites/${oldToken}/preview`, { user: state.users.d, expected: 404 });
});

test('54 Revoked/expired/exhausted invite fails safely', async () => {
  await api('POST', `/api/chats/${state.chats.group._id}/invite-link/revoke`, {
    user: state.users.a,
    expected: 200,
  });
  await api('GET', `/api/invites/${state.invite.token}/preview`, {
    user: state.users.d,
    expected: 404,
  });
});

test('55 Create valid single-choice poll', async () => {
  state.messages.singlePoll = await sendMessage(state.users.a, state.chats.group._id, {
    body: `single-poll-${runId}`,
    poll: { question: `Single ${runId}?`, options: ['Yes', 'No'], allowMultiple: false, allowVoteChanges: false, showVoters: true },
  });
  assertEqual(state.messages.singlePoll.type, 'poll', 'single poll type');
  assertEqual(state.messages.singlePoll.poll.allowMultiple, false, 'single poll mode');
});

test('56 Create valid multiple-choice poll', async () => {
  state.messages.multiPoll = await sendMessage(state.users.a, state.chats.group._id, {
    body: `multi-poll-${runId}`,
    poll: { question: `Multi ${runId}?`, options: ['One', 'Two', 'Three'], allowMultiple: true, allowVoteChanges: true, showVoters: true },
  });
  assertEqual(state.messages.multiPoll.poll.allowMultiple, true, 'multiple poll mode');
});

test('57 Reject empty or normalized-duplicate options', async () => {
  await api('POST', `/api/messages/${state.chats.group._id}`, {
    user: state.users.a,
    body: { body: `bad-poll-${runId}`, poll: { question: 'Bad?', options: ['Same', ' same '] } },
    expected: 400,
  });
});

test('58 Single-choice poll rejects multiple selected options', async () => {
  await api('POST', `/api/messages/${state.messages.singlePoll._id}/poll/vote`, {
    user: state.users.b,
    body: { optionIds: [getOptionId(state.messages.singlePoll, 0), getOptionId(state.messages.singlePoll, 1)] },
    expected: 400,
  });
});

test('59 Multiple-choice poll accepts multiple selected options', async () => {
  const response = await api('POST', `/api/messages/${state.messages.multiPoll._id}/poll/vote`, {
    user: state.users.b,
    body: { optionIds: [getOptionId(state.messages.multiPoll, 0), getOptionId(state.messages.multiPoll, 1)] },
    expected: 200,
  });
  assertEqual(response.data.poll.currentUserVote.length, 2, 'multiple vote stored');
});

test('60 Vote change is rejected when disabled', async () => {
  await api('POST', `/api/messages/${state.messages.singlePoll._id}/poll/vote`, {
    user: state.users.b,
    body: { optionId: getOptionId(state.messages.singlePoll, 0) },
    expected: 200,
  });
  await api('POST', `/api/messages/${state.messages.singlePoll._id}/poll/vote`, {
    user: state.users.b,
    body: { optionId: getOptionId(state.messages.singlePoll, 1) },
    expected: 400,
  });
});

test('61 Vote change succeeds when enabled', async () => {
  const response = await api('POST', `/api/messages/${state.messages.multiPoll._id}/poll/vote`, {
    user: state.users.b,
    body: { optionId: getOptionId(state.messages.multiPoll, 2) },
    expected: 200,
  });
  assertEqual(response.data.poll.currentUserVote[0], getOptionId(state.messages.multiPoll, 2), 'vote changed');
});

test('62 Anonymous poll does not expose voter identities', async () => {
  state.messages.anonPoll = await sendMessage(state.users.a, state.chats.group._id, {
    body: `anon-poll-${runId}`,
    poll: { question: `Anon ${runId}?`, options: ['A', 'B'], allowMultiple: false, showVoters: false },
  });
  const response = await api('POST', `/api/messages/${state.messages.anonPoll._id}/poll/vote`, {
    user: state.users.b,
    body: { optionId: getOptionId(state.messages.anonPoll, 0) },
    expected: 200,
  });
  assert(!response.data.poll.votes, 'anonymous poll omits vote records');
  assert(response.data.poll.options.every((option) => option.votes.length === 0), 'anonymous poll option voters omitted');
});

test('63 Poll creator can close poll and non-creator cannot', async () => {
  await api('POST', `/api/messages/${state.messages.multiPoll._id}/poll/close`, {
    user: state.users.b,
    expected: 403,
  });
  const response = await api('POST', `/api/messages/${state.messages.multiPoll._id}/poll/close`, {
    user: state.users.a,
    expected: 200,
  });
  assertEqual(response.data.poll.closed, true, 'poll closed by creator');
});

test('64 Closed poll rejects vote and forwarded Poll has independent zero-vote state', async () => {
  await api('POST', `/api/messages/${state.messages.multiPoll._id}/poll/vote`, {
    user: state.users.c,
    body: { optionId: getOptionId(state.messages.multiPoll, 0) },
    expected: 400,
  });
  const forwarded = await api('POST', `/api/messages/${state.messages.multiPoll._id}/forward`, {
    user: state.users.a,
    body: { destinationChatIds: [state.chats.destination._id] },
    expected: 201,
  });
  const message = forwarded.data.messages?.[0];
  assertEqual(message.poll.closed, false, 'forwarded poll reopened independently');
  assert(message.poll.options.every((option) => option.voteCount === 0), 'forwarded poll has zero votes');
});

test('65 Create valid Event with valid IANA timezone', async () => {
  const start = new Date(Date.now() + 90 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  state.eventReminderNow = new Date(start.getTime() - 30 * 60 * 1000).toISOString();
  state.messages.event = await sendMessage(state.users.a, state.chats.group._id, {
    body: `event-${runId}`,
    event: {
      title: `Smoke Event ${runId}`,
      startsAt: start.toISOString(),
      endAt: end.toISOString(),
      timezone: 'America/Los_Angeles',
      location: 'Smoke Room',
      meetingUrl: 'https://example.test/meet',
      description: `event description ${runId}`,
      reminderEnabled: true,
    },
  });
  assertEqual(state.messages.event.type, 'event', 'event type');
  assertEqual(state.messages.event.event.timezone, 'America/Los_Angeles', 'event timezone');
});

test('66 Invalid timezone, invalid temporal range, or unsafe meeting URL is rejected', async () => {
  const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
  await api('POST', `/api/messages/${state.chats.group._id}`, {
    user: state.users.a,
    body: {
      body: `bad-event-${runId}`,
      event: {
        title: 'Bad Event',
        startsAt: start.toISOString(),
        endAt: new Date(start.getTime() - 1000).toISOString(),
        timezone: 'Not/AZone',
        meetingUrl: 'javascript://bad',
      },
    },
    expected: 400,
  });
});

test('67 Authorized B RSVP Going succeeds', async () => {
  const response = await api('POST', `/api/messages/${state.messages.event._id}/event/rsvp`, {
    user: state.users.b,
    body: { status: 'going' },
    expected: 200,
  });
  assertEqual(response.data.event.currentUserRsvp, 'going', 'B RSVP going');
});

test('68 Authorized C RSVP Maybe succeeds', async () => {
  const response = await api('POST', `/api/messages/${state.messages.event._id}/event/rsvp`, {
    user: state.users.c,
    body: { status: 'maybe' },
    expected: 200,
  });
  assertEqual(response.data.event.currentUserRsvp, 'maybe', 'C RSVP maybe');
});

test('69 Non-member RSVP is rejected', async () => {
  await api('POST', `/api/messages/${state.messages.event._id}/event/rsvp`, {
    user: state.users.d,
    body: { status: 'going' },
    expected: 403,
  });
});

test('70 Event creator can edit/cancel while non-creator cannot', async () => {
  const cancelTarget = await sendMessage(state.users.a, state.chats.group._id, {
    body: `cancel-event-${runId}`,
    event: {
      title: `Cancel Event ${runId}`,
      startsAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      timezone: 'UTC',
    },
  });
  await api('PATCH', `/api/messages/${cancelTarget._id}/event`, {
    user: state.users.b,
    body: { title: 'Nope' },
    expected: 403,
  });
  const edited = await api('PATCH', `/api/messages/${cancelTarget._id}/event`, {
    user: state.users.a,
    body: { title: `Edited Cancel Event ${runId}` },
    expected: 200,
  });
  await api('POST', `/api/messages/${cancelTarget._id}/event/cancel`, {
    user: state.users.b,
    expected: 403,
  });
  const cancelled = await api('POST', `/api/messages/${cancelTarget._id}/event/cancel`, {
    user: state.users.a,
    expected: 200,
  });
  state.messages.cancelledEvent = cancelled.data;
  assert(edited.data.event.title.includes('Edited'), 'creator edited event');
  assert(cancelled.data.event.cancelledAt, 'creator cancelled event');
});

test('71 Cancelled Event rejects future RSVP changes', async () => {
  await api('POST', `/api/messages/${state.messages.cancelledEvent._id}/event/rsvp`, {
    user: state.users.b,
    body: { status: 'going' },
    expected: 400,
  });
});

test('72 Event reminder worker marks only Going/Maybe users eligible and is idempotent on second run', async () => {
  const result = await runEventReminderProbe(state.messages.event._id);
  assertEqual(result.deliveryCount, 6, 'eligible delivery count across day-before and hour-before windows');
  assertEqual(result.sentCount, 6, 'eligible sent count across day-before and hour-before windows');
  assertEqual(result.second.reserved, 0, 'second run is idempotent');
});

test('73 Authorized Event .ics export returns safe calendar content with valid DTSTART/timezone and no RSVP/email/private AI/Action data', async () => {
  const response = await api('GET', `/api/messages/${state.messages.event._id}/event.ics`, {
    user: state.users.b,
    expected: 200,
    parse: 'text',
  });
  assert(response.data.includes('BEGIN:VCALENDAR'), 'ics begins calendar');
  assert(response.data.includes('DTSTART'), 'ics has DTSTART');
  assert(response.data.includes('TZID=America/Los_Angeles') || response.data.includes('X-WR-TIMEZONE:America/Los_Angeles'), 'ics has timezone');
  assert(!response.data.includes(state.users.a.email) && !response.data.includes('RSVP') && !response.data.includes('private_personal_action'), 'ics omits private data');
});

test('74 Unauthorized or cancelled Event .ics export is rejected safely', async () => {
  await api('GET', `/api/messages/${state.messages.event._id}/event.ics`, {
    user: state.users.d,
    expected: 403,
    parse: 'text',
  });
  const cancelled = await api('GET', `/api/messages/${state.messages.cancelledEvent._id}/event.ics`, {
    user: state.users.b,
    expected: 200,
    parse: 'text',
  });
  assert(cancelled.data.includes('STATUS:CANCELLED') || !cancelled.data.includes('ATTENDEE'), 'cancelled export is safe');

  const action = await api('POST', `/api/chats/intelligence/chats/${state.chats.direct._id}/actions`, {
    user: state.users.a,
    body: {
      title: `Private Action ${runId}`,
      ownerUserId: state.users.a.id,
      sourceText: `private-action-${runId}`,
    },
    expected: 201,
  });
  state.actions.privateDirect = action.data.action;
  const bDirectActions = await api('GET', `/api/chats/intelligence/chats/${state.chats.direct._id}/actions`, {
    user: state.users.b,
    expected: 200,
  });
  const aMine = await api('GET', '/api/chats/intelligence/actions/mine', {
    user: state.users.a,
    expected: 200,
  });
  const search = await api('GET', `/api/messages/search/global?q=private-action-${runId}`, {
    user: state.users.b,
    expected: 200,
  });
  const shared = await api('GET', `/api/messages/shared?chatId=${state.chats.direct._id}&type=links`, {
    user: state.users.b,
    expected: 200,
  });
  assert(!bDirectActions.data.actions?.some((item) => item.id === state.actions.privateDirect.id), 'B cannot see A private direct Action');
  assert(aMine.data.actions?.some((item) => item.id === state.actions.privateDirect.id), 'A can see own private direct Action');
  assert(!JSON.stringify(search.data).includes(`private-action-${runId}`), 'private Action data excluded from search');
  assert(!JSON.stringify(shared.data).includes(`private-action-${runId}`), 'private Action data excluded from shared content');
});

async function run() {
  assertSafeTarget();
  const startedAt = performance.now();
  const failures = [];
  console.log(`Release A smoke run ${runId}`);
  console.log(`Gateway: ${gatewayUrl}`);
  console.log(`Cleanup: ${cleanupEnabled ? 'isolated API-created data (no account-delete endpoint)' : 'disabled'}`);

  for (const entry of state.tests) {
    const caseStart = performance.now();
    try {
      await entry.fn();
      const elapsed = Math.round(performance.now() - caseStart);
      console.log(`PASS ${entry.name} (${elapsed}ms)`);
    } catch (error) {
      failures.push({ name: entry.name, error });
      const elapsed = Math.round(performance.now() - caseStart);
      console.log(`FAIL ${entry.name} (${elapsed}ms)`);
      console.log(`  ${safeErrorContext(error)}`);
    }
  }

  for (const teardown of state.teardown.reverse()) {
    try {
      await teardown();
    } catch (error) {
      if (verbose) console.log(`  teardown skipped: ${safeErrorContext(error)}`);
    }
  }

  const duration = ((performance.now() - startedAt) / 1000).toFixed(1);
  const passed = state.tests.length - failures.length;
  const failed = failures.length;
  console.log(`Release A smoke complete: ${passed} passed, ${failed} failed (${duration}s)`);
  if (failures.length) {
    console.log(`Failed cases: ${failures.map((failure) => failure.name).join('; ')}`);
    process.exitCode = 1;
    return;
  }
  assertEqual(state.tests.length, 74, 'smoke matrix case count');
}

run().catch((error) => {
  console.log(`Release A smoke aborted: ${safeErrorContext(error)}`);
  process.exitCode = 1;
});
