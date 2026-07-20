import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const files = {
  chatsLayout: 'apps/web/src/pages/ChatsLayout.tsx',
  sidebar: 'apps/web/src/components/Sidebar.tsx',
  chatHeader: 'apps/web/src/components/ChatHeader.tsx',
  chatView: 'apps/web/src/pages/ChatView.tsx',
  chatItem: 'apps/web/src/components/ChatItem.tsx',
  chatList: 'apps/web/src/components/ChatList.tsx',
  composer: 'apps/web/src/components/Composer.tsx',
  voiceRecorder: 'apps/web/src/components/VoiceRecorder.tsx',
  messageBubble: 'apps/web/src/components/MessageBubble.tsx',
  mediaPolicy: 'services/media/src/media-policy.ts',
  mediaPresign: 'services/media/src/routes/presign.ts',
  newChat: 'apps/web/src/components/NewChatModal.tsx',
  newGroup: 'apps/web/src/components/NewGroupModal.tsx',
  useMessages: 'apps/web/src/hooks/useMessages.ts',
  useSocketEvents: 'apps/web/src/hooks/useSocketEvents.ts',
  packageJson: 'package.json',
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, file]) => [key, read(file)])
);

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test('01 sidebar uses Convo for the main chat nav label', () => {
  assert(source.sidebar.includes('aria-label="Convo"'), 'Convo aria-label missing');
  assert(source.sidebar.includes('>Convo<'), 'Convo visible label missing');
});

test('02 sidebar no longer exposes All Chats as the main nav label', () => {
  assert(!source.sidebar.includes('aria-label="All Chats"'), 'All Chats aria-label still present');
  assert(!source.sidebar.includes('>All Chats<'), 'All Chats visible label still present');
});

test('03 Messages heading remains unchanged', () => {
  assert(/<h[1-6][^>]*>\s*Messages\s*<\/h[1-6]>/.test(source.chatsLayout), 'Messages heading missing');
});

test('04 sidebar New Chat remains the primary chat start action', () => {
  assert(source.sidebar.includes('New Chat'), 'Sidebar New Chat label missing');
  assert(source.sidebar.includes('aria-label="New Chat"'), 'Sidebar New Chat aria-label missing');
});

test('05 duplicate plus button beside Messages is removed', () => {
  assert(!source.chatsLayout.includes('aria-label="Start new chat"'), 'Duplicate header plus button remains');
});

test('06 sidebar search placeholder is unified', () => {
  assert(
    source.chatsLayout.includes('placeholder="Search chats and messages"'),
    'Unified search placeholder missing'
  );
});

test('07 separate visible message-search launcher is removed', () => {
  assert(!source.chatsLayout.includes('aria-label="Search messages"'), 'Search messages launcher remains');
  assert(!source.chatsLayout.includes('openMessageSearch'), 'Legacy launcher handler remains visible');
});

test('08 message search is gated until at least two characters', () => {
  assert(source.chatsLayout.includes('debouncedSearchQuery.length >= 2'), 'Two-character message search gate missing');
  assert(source.chatsLayout.includes('Type at least 2 characters to search messages.'), 'One-character hint missing');
});

test('09 unified search renders Conversations and Messages sections', () => {
  assert(source.chatsLayout.includes('Conversations'), 'Conversations section missing');
  assert(source.chatsLayout.includes('Messages'), 'Messages section missing');
});

test('10 unified search uses authorized global message search API', () => {
  assert(source.chatsLayout.includes('searchGlobalMessages'), 'searchGlobalMessages not used');
});

test('11 search supports clear button and Escape clearing', () => {
  assert(source.chatsLayout.includes('aria-label="Clear search"'), 'Clear search button missing');
  assert(source.chatsLayout.includes("event.key === 'Escape'"), 'Escape clear behavior missing');
});

test('12 search supports keyboard navigation and activation', () => {
  assert(source.chatsLayout.includes("event.key === 'ArrowDown'"), 'ArrowDown navigation missing');
  assert(source.chatsLayout.includes("event.key === 'ArrowUp'"), 'ArrowUp navigation missing');
  assert(source.chatsLayout.includes("event.key === 'Enter'"), 'Enter activation missing');
});

test('13 message result opens chat with source message id', () => {
  assert(
    source.chatsLayout.includes("`/chats/${selection.result.chatId}?message=${encodeURIComponent(selection.result.messageId)}`"),
    'Message result navigation with message id missing'
  );
});

test('14 empty dashboard copy matches approved text', () => {
  assert(
    source.chatsLayout.includes('Discover, share, make it happen.'),
    'Approved empty-state heading missing'
  );
  assert(
    source.chatsLayout.includes('AI-first social conversations that help you find ideas, share them with your people, and turn them into real'),
    'Approved empty-state body missing'
  );
});

test('15 empty dashboard has no Start New Chat or Create Group buttons', () => {
  assert(!source.chatsLayout.includes('+ Start New Chat'), 'Start New Chat empty-state action remains');
  assert(!source.chatsLayout.includes('Create Group'), 'Create Group empty-state action remains');
});

test('16 header keeps visible Shared and Search actions', () => {
  assert(source.chatHeader.includes('aria-label="Shared content"'), 'Visible Shared header action missing');
  assert(source.chatHeader.includes('aria-label="Search in chat"'), 'Visible Search in chat header action missing');
});

test('17 chat-header three-dot overflow menu is removed', () => {
  assert(!source.chatHeader.includes('More options'), 'Header More options control remains');
  assert(!source.chatHeader.includes('role="menu"'), 'Header overflow menu remains');
  assert(!source.chatHeader.includes('MoreVertical'), 'Header overflow icon remains');
});

test('18 profile and group access remain on the chat identity area', () => {
  assert(source.chatHeader.includes('openProfileOrGroupInfo'), 'Identity profile/group opener missing');
  assert(source.chatHeader.includes('UserProfileModal'), 'Direct profile modal missing');
  assert(source.chatHeader.includes('GroupInfoModal'), 'Group info modal missing');
});

test('19 Shared content refetches when the panel opens', () => {
  assert(source.useMessages.includes("refetchOnMount: 'always'"), 'Shared content refetchOnMount guard missing');
});

test('20 sent messages invalidate Shared content queries', () => {
  assert(source.useMessages.includes('invalidateSharedContentForChat(queryClient, newMessage.chatId || chatId)'), 'Send success shared invalidation missing');
});

test('21 realtime new messages invalidate Shared content queries', () => {
  assert(source.useSocketEvents.includes('invalidateSharedContentForChat(queryClient, message.chatId)'), 'Realtime shared invalidation missing');
});

test('22 edited and deleted messages reconcile Shared content', () => {
  assert(count(source.useSocketEvents, 'invalidateSharedContentForChat(queryClient,') >= 3, 'Realtime edit/delete shared invalidation missing');
  assert(count(source.useMessages, 'invalidateSharedContentForChat(queryClient,') >= 3, 'Mutation shared invalidation missing');
});

test('23 New Chat uses native picker structure', () => {
  assert(source.newChat.includes('New Chat'), 'New Chat title missing');
  assert(source.newChat.includes('Search by username or name'), 'New Chat search copy missing');
  assert(source.newChat.includes('Create a group'), 'Create a group row missing');
  assert(source.newChat.includes('Recent'), 'Recent section missing');
  assert(source.newChat.includes('Copy profile link'), 'Profile link row missing');
  assert(source.newChat.includes('Copy invite link'), 'Invite link row missing');
});

test('24 New Chat uses safe discovery search and existing chats', () => {
  assert(source.newChat.includes('searchUsers'), 'New Chat safe user search missing');
  assert(source.newChat.includes('sendMessageRequest'), 'New Chat message-request path missing');
  assert(source.newChat.includes('fetchMessageRequestInbox'), 'New Chat message-request inbox missing');
  assert(source.newChat.includes('useChats()'), 'New Chat does not derive recent contacts from existing chats');
});

test('25 New Group does not perform broad registered-user search', () => {
  assert(!source.newGroup.includes('/api/users/search'), 'New Group still calls broad user search');
  assert(source.newGroup.includes('Select people from your conversations'), 'New Group eligible-source copy missing');
});

test('26 chat unavailable fallback uses Convo wording', () => {
  assert(source.chatView.includes('Back to Convo'), 'Chat unavailable fallback still uses old wording');
});

test('27 package exposes durable smoke command', () => {
  assert(source.packageJson.includes('"smoke:chat-dashboard"'), 'smoke:chat-dashboard script missing');
});

test('28 conversation rows expose archive and unarchive controls', () => {
  assert(source.chatItem.includes('Archive conversation'), 'Archive conversation control missing');
  assert(source.chatItem.includes('Unarchive conversation'), 'Unarchive conversation control missing');
  assert(source.chatItem.includes('ArchiveRestore'), 'Unarchive icon missing');
  assert(source.chatList.includes('useArchiveChat'), 'Archive mutation hook missing from chat list');
  assert(source.chatList.includes('useUnarchiveChat'), 'Unarchive mutation hook missing from chat list');
});

test('29 archive action updates list immediately and offers undo', () => {
  assert(source.chatList.includes('Conversation archived.'), 'Archive undo toast copy missing');
  assert(source.chatList.includes('Undo'), 'Archive undo action missing');
  assert(source.chatList.includes('setUndoChat(chat)'), 'Archive undo state is not set on success');
});

test('30 message-level menu keeps Pin, Save, and Report icons', () => {
  assert(source.messageBubble.includes('Pin size={16}'), 'Pin action icon missing');
  assert(source.messageBubble.includes('Bookmark size={16}'), 'Save action icon missing');
  assert(source.messageBubble.includes('Flag size={16}'), 'Report action icon missing');
  assert(source.messageBubble.includes('aria-label="Play or pause voice message"'), 'Voice player accessible label missing');
});

test('31 composer plus menu keeps attachments while removing duplicate Audio item', () => {
  assert(!source.composer.includes("id: 'audio'"), 'Duplicate Audio plus-menu item remains');
  for (const label of ['Document', 'Photos', 'Camera', 'Poll', 'Event', 'New sticker']) {
    assert(source.composer.includes(`label: '${label}'`), `${label} plus-menu item missing`);
  }
  assert(source.composer.includes('aria-label="Voice message"'), 'Composer mic action missing');
});

test('32 voice recorder uses runtime MIME detection and explicit preview send', () => {
  assert(source.voiceRecorder.includes('MediaRecorder.isTypeSupported'), 'Runtime MIME detection missing');
  assert(source.voiceRecorder.includes('mediaRecorder.mimeType'), 'Recorded MIME source missing');
  assert(source.voiceRecorder.includes('audioUrl ?') && source.voiceRecorder.includes('<audio'), 'Voice preview state missing');
  assert(source.voiceRecorder.includes('Send voice message'), 'Explicit voice send action missing');
  assert(source.voiceRecorder.includes('Cancel voice message'), 'Voice cancel action missing');
  assert(!source.voiceRecorder.includes('onSend(blob);'), 'Voice recorder appears to auto-send raw stop output');
});

test('33 HEIC and HEIF image upload is accepted then normalized server-side', () => {
  assert(source.composer.includes('image/heic') && source.composer.includes('image/heif'), 'HEIC/HEIF picker accept values missing');
  assert(source.mediaPolicy.includes("'image/heic'") && source.mediaPolicy.includes("'image/heif'"), 'HEIC/HEIF policy allowlist missing');
  assert(source.mediaPolicy.includes("return 'image/heic'"), 'HEIC byte detection missing');
  assert(source.mediaPresign.includes('normalizeImageToJpeg'), 'Image normalization pipeline missing');
  assert(source.mediaPresign.includes("'heif-convert'"), 'HEIC/HEIF decoder missing');
  assert(source.mediaPresign.includes("'ffprobe'") && source.mediaPresign.includes("'ffmpeg'"), 'Image decoder validation missing');
  assert(source.composer.includes('This photo could not be uploaded. Try another image.'), 'Generic photo upload error missing');
});

let passed = 0;
const failures = [];

for (const item of tests) {
  try {
    item.fn();
    passed += 1;
  } catch (error) {
    failures.push({ name: item.name, message: error instanceof Error ? error.message : String(error) });
  }
}

for (const failure of failures) {
  console.error(`FAIL ${failure.name}: ${failure.message}`);
}

console.log(`${passed} passed, ${failures.length} failed`);

if (failures.length > 0) {
  process.exit(1);
}
