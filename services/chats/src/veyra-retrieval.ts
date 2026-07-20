import { ObjectId } from 'mongodb';
import { getDatabase } from './db';
import { getChatsCollection, type Chat } from './models/chat';
import { getChatActionsCollection } from './models/chat-action';
import { getChatDecisionsCollection } from './models/chat-decision';
import { getPlanThisCollection, type PlanThisDocument } from './models/plan-this';
import type { VeyraConversationContext, VeyraResultCard, VeyraResultType, VeyraSettingsDocument } from './models/veyra';
import { isChatExpired } from './serialize-chat';

// ── Shared authorization helpers (mirrors plan-this.ts's checks; Veyra
// retrieval must never be looser than the rest of the product). ─────────────

interface UserDoc {
  _id: ObjectId;
  name?: string;
  username?: string;
  email?: string;
}

function displayName(user?: UserDoc | null) {
  return user?.name || user?.username || 'Someone';
}

export async function loadUserNames(userIds: ObjectId[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const uniqueIds = Array.from(new Map(userIds.map((id) => [id.toString(), id])).values());
  const users = await getDatabase()
    .collection<UserDoc>('users')
    .find({ _id: { $in: uniqueIds } }, { projection: { _id: 1, name: 1, username: 1 } })
    .toArray();
  return new Map(users.map((user) => [user._id.toString(), displayName(user)]));
}

async function hasBlockBetween(a: ObjectId, b: ObjectId) {
  return Boolean(
    await getDatabase().collection('user_blocks').findOne({
      $or: [
        { blockerUserId: a, blockedUserId: b },
        { blockerUserId: b, blockedUserId: a },
      ],
    })
  );
}

/** Re-checks membership, deletion, expiry, and blocks *right now* — never trust a stale scope grant. */
export async function reauthorizeChatForUser(chatId: ObjectId, userId: ObjectId): Promise<Chat | null> {
  const chat = await getChatsCollection().findOne({ _id: chatId, participants: userId, deletedAt: { $exists: false } });
  if (!chat) return null;
  if (chat.type === 'group' && isChatExpired(chat)) return null;
  if (chat.type === 'direct') {
    const other = chat.participants.find((id) => !id.equals(userId));
    if (other && (await hasBlockBetween(userId, other))) return null;
  }
  return chat;
}

function chatLabelFor(chat: Chat, viewerId: ObjectId, names: Map<string, string>) {
  if (chat.type === 'group') return chat.title || 'Group chat';
  const other = chat.participants.find((id) => !id.equals(viewerId));
  return other ? names.get(other.toString()) || 'Direct chat' : 'Direct chat';
}

// ── Natural-language extraction (regex-based; no external model). ──────────

// Every word that also acts as an intent/keyword signal elsewhere (content
// type, question form, action verb) must be excluded here too — otherwise a
// prompt like "What did my group decide?" leaves "decide" behind and gets
// mistaken for an explicit (and unmatched) chat name. See `resolveScopedChat`:
// an explicit name that matches zero approved scopes is refused outright
// rather than guessed, so over-collecting stopwords is the safe direction.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'in', 'of', 'to', 'me', 'my', 'i', 'we', 'us', 'and', 'or',
  'is', 'are', 'was', 'were', 'did', 'do', 'does', 'it', 'about', 'from', 'with', 'for', 'on', 'at', 'your', 'you',
  'can', 'please', 'get', 'have', 'has', 'had', 'all', 'any', 'some', 'there', 'here',
  'chat', 'group', 'conversation', 'space', 'discussion', 'thread', 'topic',
  'show', 'find', 'list', 'search', 'send', 'forward', 'delete', 'remove', 'update', 'edit', 'rsvp', 'schedule',
  'open', 'go', 'navigate',
  'photo', 'photos', 'picture', 'pictures', 'image', 'images',
  'video', 'videos', 'media', 'clip', 'clips',
  'pdf', 'pdfs', 'document', 'documents', 'file', 'files',
  'link', 'links', 'url', 'urls',
  'plan', 'plans', 'planned', 'trip', 'event', 'events',
  'where', 'who', 'what', 'when', 'why', 'how',
  'started', 'create', 'created', 'made', 'proposed',
  'decide', 'decided', 'decision', 'decisions', 'recap',
  'action', 'actions', 'task', 'tasks', 'reply', 'status', 'need', 'waiting',
  'vote', 'voting', 'shared', 'latest', 'last',
  'help', 'capabilit', 'capabilities', 'hi', 'hello', 'hey', 'name', 'thanks', 'thank',
  'summarize', 'summary', 'today', 'recap',
]);

export function extractNameQuery(prompt: string): string | undefined {
  const words = prompt
    .replace(/[’']s\b/gi, '')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !STOPWORDS.has(word.toLowerCase()));
  return words.length ? words.join(' ') : undefined;
}

/** Case/space/punctuation-insensitive form used to match spoken/typed chat names against approved scope labels. */
export function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Significant words for an "every word must appear somewhere" match — punctuation/casing/spacing-insensitive per word. */
function tokenizeForMatch(value: string): string[] {
  return Array.from(new Set(normalizeLabel(value).length > 0 ? value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean) : []));
}

/** True when every significant query word appears somewhere in the plan's title/description — order/punctuation-insensitive, unlike a single literal regex. */
function planMatchesAllWords(plan: PlanThisDocument, queryWords: string[]): boolean {
  if (queryWords.length === 0) return true;
  const haystack = `${plan.title} ${plan.description || ''}`.toLowerCase();
  return queryWords.every((word) => haystack.includes(word));
}

/** What kind of content an action-class request ("send X to Y") refers to, reusing the same keyword signals as retrieval. */
export function classifyRetrievalContentType(prompt: string): 'find_photos' | 'find_documents' | 'find_links' | 'find_videos' | 'find_plans' | 'search_messages' {
  const text = prompt.toLowerCase();
  if (/\b(photo|photos|picture|pictures|image|images)\b/.test(text)) return 'find_photos';
  if (/\b(video|videos|media|clip|clips)\b/.test(text)) return 'find_videos';
  if (/\b(pdf|pdfs|document|documents|file|files)\b/.test(text)) return 'find_documents';
  if (/\b(link|links|url|urls)\b/.test(text)) return 'find_links';
  if (/\b(plan|plans|trip|event|events)\b/.test(text)) return 'find_plans';
  return 'search_messages';
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Scope resolution ─────────────────────────────────────────────────────

// `source` records *why* a scope resolved — an explicitly named space, a
// contextual reference ("that group") grounded to the prior conversation
// turn, or the plain default (a manually-picked scope, or the sole approved
// chat with no name/context signal at all). Retrieval uses this only to
// phrase the answer (e.g. crediting "the current plan context"); it never
// changes which space is actually searched.
export type ScopeResolutionSource = 'explicit' | 'context' | 'default';

export type ScopeResolution =
  | { ok: true; chat: Chat; label: string; source: ScopeResolutionSource }
  | { ok: false; reason: 'none' }
  | { ok: false; reason: 'ambiguous'; candidates: Array<{ scopeId: string; label: string }> };

async function resolveAuthorizedCandidates(
  candidates: VeyraSettingsDocument['scopes'],
  userId: ObjectId,
  source: ScopeResolutionSource
): Promise<ScopeResolution> {
  const authorized: Array<{ scopeId: string; label: string; chat: Chat }> = [];
  for (const scope of candidates) {
    if (!scope.targetId) continue;
    const chat = await reauthorizeChatForUser(scope.targetId, userId);
    if (chat) authorized.push({ scopeId: scope.id, label: scope.label || 'Chat', chat });
  }
  if (authorized.length === 0) return { ok: false, reason: 'none' };
  if (authorized.length === 1) return { ok: true, chat: authorized[0].chat, label: authorized[0].label, source };
  return { ok: false, reason: 'ambiguous', candidates: authorized.map(({ scopeId, label }) => ({ scopeId, label })) };
}

/**
 * Resolves which approved `chat`-type Veyra scope a retrieval request should
 * run against.
 *
 * Priority order:
 *  1. An explicit chat name mentioned in the prompt (normalized against
 *     whitespace/punctuation/casing differences) — if it matches one or more
 *     approved scopes, it ALWAYS wins, overriding any manually-selected scope
 *     or prior grounded context. If it matches zero approved scopes, the
 *     request is refused outright (never silently falls back to "just use
 *     whatever scope was already selected") — this is what makes an explicit,
 *     unapproved target name safe rather than accidentally answering from a
 *     different chat.
 *  2. No name was mentioned at all: fall back to prior grounded conversation
 *     context (`context.activeSpaceId`), then the manually-selected scope
 *     picker (`scopeId`).
 *  3. Neither of the above: every approved chat scope is a candidate (one
 *     resolves directly, several are ambiguous).
 *
 * Every candidate is re-authorized right now, never taken on trust.
 */
export async function resolveScopedChat(
  userId: ObjectId,
  settings: VeyraSettingsDocument,
  opts: { scopeId?: string; prompt: string; context?: Pick<VeyraConversationContext, 'activeSpaceId'> }
): Promise<ScopeResolution> {
  const chatScopes = settings.scopes.filter((scope) => scope.type === 'chat' && scope.targetId);
  const nameQuery = extractNameQuery(opts.prompt);

  if (nameQuery) {
    const normalizedQuery = normalizeLabel(nameQuery);
    const matches = chatScopes.filter((scope) => {
      const normalizedLabel = normalizeLabel(scope.label || '');
      return normalizedLabel.length > 0 && (normalizedLabel.includes(normalizedQuery) || normalizedQuery.includes(normalizedLabel));
    });
    if (matches.length > 0) return resolveAuthorizedCandidates(matches, userId, 'explicit');
    // An explicit name was mentioned but matched no approved space — refuse
    // rather than guess at (or reveal the existence of) anything else.
    return { ok: false, reason: 'none' };
  }

  const fallbackScopeId = opts.context?.activeSpaceId || opts.scopeId;
  if (fallbackScopeId) {
    const scope = chatScopes.find((item) => item.id === fallbackScopeId);
    if (!scope?.targetId) return { ok: false, reason: 'none' };
    const chat = await reauthorizeChatForUser(scope.targetId, userId);
    if (!chat) return { ok: false, reason: 'none' };
    const source: ScopeResolutionSource = opts.context?.activeSpaceId ? 'context' : 'default';
    return { ok: true, chat, label: scope.label || 'Chat', source };
  }

  if (chatScopes.length === 0) return { ok: false, reason: 'none' };
  return resolveAuthorizedCandidates(chatScopes, userId, 'default');
}

// ── Retrieval tools ──────────────────────────────────────────────────────

const RESULT_LIMIT = 6;

export async function findChats(userId: ObjectId, settings: VeyraSettingsDocument, query?: string): Promise<VeyraResultCard[]> {
  const chatScopes = settings.scopes.filter((scope) => scope.type === 'chat' && scope.targetId);
  const cards: VeyraResultCard[] = [];
  for (const scope of chatScopes) {
    if (query && !(scope.label || '').toLowerCase().includes(query.toLowerCase())) continue;
    const chat = await reauthorizeChatForUser(scope.targetId!, userId);
    if (!chat) continue;
    cards.push({
      resultType: 'chat',
      id: chat._id.toString(),
      title: scope.label || 'Chat',
      subtitle: chat.type === 'group' ? `${chat.participants.length} members` : 'Direct chat',
      chatId: chat._id.toString(),
    });
  }
  return cards.slice(0, RESULT_LIMIT);
}

export async function listAttachments(
  chat: Chat,
  userId: ObjectId,
  type: 'image' | 'document' | 'pdf' | 'video',
  query?: string
): Promise<VeyraResultCard[]> {
  const names = await loadUserNames(chat.participants);
  const chatLabel = chatLabelFor(chat, userId, names);
  const filter: Record<string, unknown> = { chatId: chat._id, deletedAt: { $exists: false }, deletedFor: { $ne: userId } };
  if (type === 'pdf') {
    filter['media.type'] = 'document';
    filter['media.mimeType'] = 'application/pdf';
  } else if (type === 'document') {
    filter['media.type'] = 'document';
    filter['media.mimeType'] = { $ne: 'application/pdf' };
  } else if (type === 'video') {
    filter['media.type'] = 'video';
  } else {
    filter['media.type'] = 'image';
  }
  if (query) filter.$text = { $search: query };

  const messages = await getDatabase()
    .collection('messages')
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(RESULT_LIMIT)
    .toArray();
  const senderNames = await loadUserNames(messages.map((message) => message.senderId));

  return messages.map((message) => ({
    resultType: 'attachment' as const,
    id: message._id.toString(),
    title: message.media?.fileName || (type === 'image' ? 'Photo' : type === 'video' ? 'Video' : type === 'pdf' ? 'PDF' : 'Document'),
    subtitle: chatLabel,
    senderName: senderNames.get(message.senderId.toString()) || 'Someone',
    chatId: chat._id.toString(),
    chatLabel,
    createdAt: message.createdAt.toISOString(),
    deepLink: { kind: 'chat_message' as const, chatId: chat._id.toString(), messageId: message._id.toString() },
  }));
}

const URL_PATTERN = /https?:\/\/[^\s]+/i;

export async function listLinks(chat: Chat, userId: ObjectId, query?: string): Promise<VeyraResultCard[]> {
  const names = await loadUserNames(chat.participants);
  const chatLabel = chatLabelFor(chat, userId, names);
  const filter: Record<string, unknown> = {
    chatId: chat._id,
    deletedAt: { $exists: false },
    deletedFor: { $ne: userId },
    body: { $regex: 'https?://', $options: 'i' },
  };
  if (query) filter.$text = { $search: query };

  const messages = await getDatabase()
    .collection('messages')
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(RESULT_LIMIT * 2)
    .toArray();
  const senderNames = await loadUserNames(messages.map((message) => message.senderId));

  const cards: VeyraResultCard[] = [];
  for (const message of messages) {
    const match = String(message.body || '').match(URL_PATTERN);
    if (!match) continue;
    cards.push({
      resultType: 'link',
      id: message._id.toString(),
      title: match[0],
      subtitle: String(message.body || '').replace(match[0], '').trim().slice(0, 140) || undefined,
      senderName: senderNames.get(message.senderId.toString()) || 'Someone',
      chatId: chat._id.toString(),
      chatLabel,
      createdAt: message.createdAt.toISOString(),
      deepLink: { kind: 'chat_message', chatId: chat._id.toString(), messageId: message._id.toString() },
    });
    if (cards.length >= RESULT_LIMIT) break;
  }
  return cards;
}

export async function searchMessagesInChat(chat: Chat, userId: ObjectId, query: string): Promise<VeyraResultCard[]> {
  const names = await loadUserNames(chat.participants);
  const chatLabel = chatLabelFor(chat, userId, names);
  const filter: Record<string, unknown> = { chatId: chat._id, deletedAt: { $exists: false }, deletedFor: { $ne: userId } };
  if (query.trim()) filter.$text = { $search: query };

  const messages = await getDatabase()
    .collection('messages')
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(RESULT_LIMIT)
    .toArray();
  const senderNames = await loadUserNames(messages.map((message) => message.senderId));

  return messages.map((message) => ({
    resultType: 'message' as const,
    id: message._id.toString(),
    title: String(message.body || message.media?.fileName || 'Message').slice(0, 140),
    subtitle: chatLabel,
    senderName: senderNames.get(message.senderId.toString()) || 'Someone',
    chatId: chat._id.toString(),
    chatLabel,
    createdAt: message.createdAt.toISOString(),
    deepLink: { kind: 'chat_message' as const, chatId: chat._id.toString(), messageId: message._id.toString() },
  }));
}

/**
 * Searches Plan This proposals/finalized plans, event messages, and My Actions
 * tasks across every currently-authorized approved scope — not the whole
 * database. Used for "where did we plan X" / "who started that plan" style
 * questions that don't name one specific chat.
 */
export async function findPlansAndEventsAndTasks(
  userId: ObjectId,
  settings: VeyraSettingsDocument,
  query: string
): Promise<VeyraResultCard[]> {
  const chatScopes = settings.scopes.filter((scope) => scope.type === 'chat' && scope.targetId);
  const hasMyActionsScope = settings.scopes.some((scope) => scope.type === 'my_actions');

  const authorizedChats: Chat[] = [];
  const chatLabelById = new Map<string, string>();
  for (const scope of chatScopes) {
    const chat = await reauthorizeChatForUser(scope.targetId!, userId);
    if (chat) {
      authorizedChats.push(chat);
      chatLabelById.set(chat._id.toString(), scope.label || 'Chat');
    }
  }
  const authorizedChatIds = authorizedChats.map((chat) => chat._id);
  if (authorizedChatIds.length === 0 && !hasMyActionsScope) return [];

  const cards: VeyraResultCard[] = [];
  const searchWords = query.trim();

  if (authorizedChatIds.length > 0) {
    // Word-overlap matching rather than one literal contiguous regex: a plan
    // titled "Santa Cruz Trip ORBIT-719" must still be found by "Santa Cruz
    // Trip ORBIT-719" even though a stopword ("trip") or punctuation (the
    // hyphen) breaks contiguity between the surviving query words. Still
    // bounded strictly to chats already authorized above — never a broader
    // database-wide search.
    const allPlans = await getPlanThisCollection().find({ chatId: { $in: authorizedChatIds } }).sort({ updatedAt: -1 }).toArray();
    const queryWords = tokenizeForMatch(searchWords);
    const plans = (queryWords.length > 0 ? allPlans.filter((plan) => planMatchesAllWords(plan, queryWords)) : allPlans).slice(
      0,
      RESULT_LIMIT
    );
    const creatorNames = await loadUserNames(plans.map((plan) => plan.creatorUserId));
    for (const plan of plans) {
      cards.push({
        resultType: 'plan',
        id: plan._id.toString(),
        title: plan.title,
        subtitle: `${plan.state.replace(/_/g, ' ')} · ${chatLabelById.get(plan.chatId.toString()) || 'Chat'}`,
        senderName: creatorNames.get(plan.creatorUserId.toString()) || 'Someone',
        chatId: plan.chatId.toString(),
        chatLabel: chatLabelById.get(plan.chatId.toString()),
        createdAt: plan.createdAt.toISOString(),
        deepLink: plan.proposalMessageId
          ? { kind: 'chat_message', chatId: plan.chatId.toString(), messageId: plan.proposalMessageId.toString() }
          : undefined,
      });
    }

    const eventFilter: Record<string, unknown> = {
      chatId: { $in: authorizedChatIds },
      type: 'event',
      deletedAt: { $exists: false },
      deletedFor: { $ne: userId },
    };
    if (searchWords) eventFilter.$text = { $search: searchWords };
    const events = await getDatabase()
      .collection('messages')
      .find(eventFilter)
      .sort({ createdAt: -1 })
      .limit(RESULT_LIMIT)
      .toArray();
    const eventSenderNames = await loadUserNames(events.map((event) => event.senderId));
    for (const event of events) {
      cards.push({
        resultType: 'event',
        id: event._id.toString(),
        title: event.event?.title || 'Event',
        subtitle: chatLabelById.get(event.chatId.toString()),
        senderName: eventSenderNames.get(event.senderId.toString()) || 'Someone',
        chatId: event.chatId.toString(),
        chatLabel: chatLabelById.get(event.chatId.toString()),
        createdAt: event.createdAt.toISOString(),
        deepLink: { kind: 'chat_message', chatId: event.chatId.toString(), messageId: event._id.toString() },
      });
    }
  }

  if (hasMyActionsScope) {
    const taskFilter: Record<string, unknown> = {
      deletedAt: { $exists: false },
      $or: [{ 'assignedTo.userId': userId.toString() }, { personalOwnerUserId: userId }],
    };
    if (searchWords) taskFilter.title = { $regex: escapeRegex(searchWords), $options: 'i' };
    const tasks = await getChatActionsCollection().find(taskFilter).sort({ updatedAt: -1 }).limit(RESULT_LIMIT).toArray();
    for (const task of tasks) {
      cards.push({
        resultType: 'task',
        id: task._id.toString(),
        title: task.title,
        subtitle: task.status,
        chatId: task.chatId.toString(),
        createdAt: task.createdAt.toISOString(),
        deepLink: { kind: 'action', actionId: task._id.toString() },
      });
    }
  }

  return cards.slice(0, RESULT_LIMIT);
}

export function resultTypeForCards(cards: VeyraResultCard[]): VeyraResultType {
  return cards[0]?.resultType ?? 'empty';
}

/**
 * Treats a bare utterance (e.g. a reply to "Which plan would you like to know
 * about?") as a plan-title lookup rather than an unclassifiable prompt —
 * bounded to plans inside already-authorized chat scopes, so this is never a
 * broader/global search. Word-overlap matching (see `planMatchesAllWords`)
 * makes it tolerant of normalization differences (spacing/casing/hyphens).
 */
export async function findPlanByTitleLookup(
  userId: ObjectId,
  settings: VeyraSettingsDocument,
  prompt: string
): Promise<
  | { outcome: 'none' }
  | { outcome: 'ambiguous'; labels: string[] }
  | { outcome: 'ok'; card: VeyraResultCard; scopeId?: string }
> {
  const query = extractNameQuery(prompt);
  if (!query) return { outcome: 'none' };
  const chatScopes = settings.scopes.filter((scope) => scope.type === 'chat' && scope.targetId);
  const authorizedChats: Chat[] = [];
  const chatLabelById = new Map<string, string>();
  const scopeIdByChatId = new Map<string, string>();
  for (const scope of chatScopes) {
    const chat = await reauthorizeChatForUser(scope.targetId!, userId);
    if (chat) {
      authorizedChats.push(chat);
      chatLabelById.set(chat._id.toString(), scope.label || 'Chat');
      scopeIdByChatId.set(chat._id.toString(), scope.id);
    }
  }
  if (authorizedChats.length === 0) return { outcome: 'none' };

  const queryWords = tokenizeForMatch(query);
  if (queryWords.length === 0) return { outcome: 'none' };
  const allPlans = await getPlanThisCollection()
    .find({ chatId: { $in: authorizedChats.map((chat) => chat._id) } })
    .toArray();
  const matches = allPlans.filter((plan) => planMatchesAllWords(plan, queryWords));
  if (matches.length === 0) return { outcome: 'none' };
  if (matches.length > 1) {
    return { outcome: 'ambiguous', labels: matches.map((plan) => `"${plan.title}" in ${chatLabelById.get(plan.chatId.toString()) || 'a chat'}`) };
  }

  const [plan] = matches;
  const creatorNames = await loadUserNames([plan.creatorUserId]);
  const chatLabel = chatLabelById.get(plan.chatId.toString()) || 'Chat';
  return {
    outcome: 'ok',
    scopeId: scopeIdByChatId.get(plan.chatId.toString()),
    card: {
      resultType: 'plan',
      id: plan._id.toString(),
      title: plan.title,
      subtitle: `${plan.state.replace(/_/g, ' ')} · ${chatLabel}`,
      senderName: creatorNames.get(plan.creatorUserId.toString()) || 'Someone',
      chatId: plan.chatId.toString(),
      chatLabel,
      createdAt: plan.createdAt.toISOString(),
      deepLink: plan.proposalMessageId
        ? { kind: 'chat_message', chatId: plan.chatId.toString(), messageId: plan.proposalMessageId.toString() }
        : undefined,
    },
  };
}

/**
 * Re-resolves a plan named by an echoed `activePlanId` follow-up context: the
 * plan must still exist, its chat must still be reachable by the user right
 * now (membership/expiry/block), AND that chat must still be an approved
 * Veyra `chat` scope — never just "the user happens to be a member". This is
 * what makes scope revocation between turns safe (see `askVeyra`'s
 * `plan_creator`/plan-linked-task handling).
 */
export async function resolvePlanForContext(
  userId: ObjectId,
  settings: VeyraSettingsDocument,
  planId: string
): Promise<{ plan: PlanThisDocument; chat: Chat; label: string; scopeId: string } | null> {
  if (!ObjectId.isValid(planId)) return null;
  const plan = await getPlanThisCollection().findOne({ _id: new ObjectId(planId) });
  if (!plan) return null;
  const chat = await reauthorizeChatForUser(plan.chatId, userId);
  if (!chat) return null;
  const matchedScope = settings.scopes.find((scope) => scope.type === 'chat' && scope.targetId?.equals(plan.chatId));
  if (!matchedScope) return null;
  return { plan, chat, label: matchedScope.label || 'Chat', scopeId: matchedScope.id };
}

/**
 * Finds the user's own pending tasks grounded to a follow-up target: a
 * specific Plan (via its assignments, the only link from plan -> chat_action)
 * takes priority, falling back to every pending task in a specific chat.
 * Re-authorization of the plan/chat happens in the caller before this runs.
 */
export async function findTasksForContext(
  userId: ObjectId,
  target: { plan: PlanThisDocument } | { chat: Chat }
): Promise<VeyraResultCard[]> {
  if ('plan' in target) {
    // Strictly the tasks this plan's own assignments link to, and only the
    // ones actually assigned to the requesting user — never a broader "every
    // task in this chat" fallback, so unrelated chat actions (e.g. "Hello")
    // can never surface for a "what tasks do I have for this [plan]" ask.
    const actionIds = target.plan.assignments
      .filter((assignment) => assignment.actionId && assignment.assigneeUserId?.equals(userId))
      .map((assignment) => assignment.actionId!);
    if (actionIds.length === 0) return [];
    const tasks = await getChatActionsCollection()
      .find({ _id: { $in: actionIds }, deletedAt: { $exists: false }, status: { $nin: ['completed', 'dismissed'] as any } })
      .sort({ dueAt: 1, updatedAt: -1 })
      .limit(RESULT_LIMIT)
      .toArray();
    return tasks.map((task) => ({
      resultType: 'task' as const,
      id: task._id.toString(),
      title: task.title,
      subtitle: task.status,
      chatId: task.chatId.toString(),
      createdAt: task.createdAt.toISOString(),
      deepLink: { kind: 'action' as const, actionId: task._id.toString() },
    }));
  }

  const tasks = await getChatActionsCollection()
    .find({
      chatId: target.chat._id,
      deletedAt: { $exists: false },
      status: { $nin: ['completed', 'dismissed'] as any },
      $or: [{ 'assignedTo.userId': userId.toString() }, { personalOwnerUserId: userId }],
    })
    .sort({ dueAt: 1, updatedAt: -1 })
    .limit(RESULT_LIMIT)
    .toArray();
  return tasks.map((task) => ({
    resultType: 'task' as const,
    id: task._id.toString(),
    title: task.title,
    subtitle: task.status,
    chatId: task.chatId.toString(),
    createdAt: task.createdAt.toISOString(),
    deepLink: { kind: 'action' as const, actionId: task._id.toString() },
  }));
}

// ── Full Access global aggregation ──────────────────────────────────────

type GlobalContentIntent = 'find_photos' | 'find_videos' | 'find_documents' | 'find_links' | 'search_messages';

/**
 * Full Access only: when a broad/unnamed retrieval question (no specific chat
 * named, so `resolveScopedChat` came back ambiguous) has more than one
 * accessible candidate chat, this searches every one of them — instead of
 * asking the user to disambiguate — and merges the results by recency.
 * Approved-spaces mode never calls this; it keeps asking which space, since
 * "ambiguous" there means the user has multiple *explicitly approved* spaces
 * and Veyra must not guess which one they meant. Every candidate chat is
 * still re-authorized right now via the same scope lookup + `listAttachments`
 * / `listLinks` / `searchMessagesInChat` tools already used for a single
 * named chat — this only changes "ask which one" into "search all of them",
 * never who or what is allowed to be searched.
 */
export async function searchAcrossCandidateChats(
  contentIntent: GlobalContentIntent,
  candidates: Array<{ scopeId: string; label: string }>,
  settings: VeyraSettingsDocument,
  userId: ObjectId,
  prompt: string
): Promise<{ cards: VeyraResultCard[]; attachmentKind?: 'pdf' | 'document' }> {
  const query = extractNameQuery(prompt) || '';
  const attachmentKind: 'pdf' | 'document' | undefined =
    contentIntent === 'find_documents' ? (/\bpdf/i.test(prompt) ? 'pdf' : 'document') : undefined;

  const merged: VeyraResultCard[] = [];
  for (const candidate of candidates) {
    const scope = settings.scopes.find((item) => item.id === candidate.scopeId);
    if (!scope?.targetId) continue;
    const chat = await reauthorizeChatForUser(scope.targetId, userId);
    if (!chat) continue;

    let cards: VeyraResultCard[];
    if (contentIntent === 'find_photos') cards = await listAttachments(chat, userId, 'image', query || undefined);
    else if (contentIntent === 'find_videos') cards = await listAttachments(chat, userId, 'video', query || undefined);
    else if (contentIntent === 'find_documents') cards = await listAttachments(chat, userId, attachmentKind!, query || undefined);
    else if (contentIntent === 'find_links') cards = await listLinks(chat, userId, query || undefined);
    else cards = await searchMessagesInChat(chat, userId, query);
    merged.push(...cards);
  }

  merged.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return { cards: merged.slice(0, RESULT_LIMIT), attachmentKind };
}

export interface DailyRecapEvidence {
  activeChatLabels: string[];
  messages: VeyraResultCard[];
  media: VeyraResultCard[];
  decisions: Array<{ title: string; chatLabel?: string }>;
  plansAndEvents: VeyraResultCard[];
  tasks: VeyraResultCard[];
}

/**
 * Gathers a broad evidence set for "summarize today" / "catch me up" style
 * questions, bounded strictly to `settings.scopes` — in approved_spaces mode
 * that's only the chats/My-Actions the user explicitly granted; in
 * full_access mode `settings` is already the virtual-scope projection from
 * `resolveEffectiveVeyraSettings`, so this naturally covers every chat the
 * user can currently access. No new authorization path is introduced here —
 * every chat is re-verified live via `reauthorizeChatForUser`, and plans/
 * events/tasks are gathered via the exact same `findPlansAndEventsAndTasks`
 * used by "show my plans", never a separate/looser query.
 */
export async function gatherDailyRecapEvidence(
  userId: ObjectId,
  settings: VeyraSettingsDocument,
  sinceHours = 24
): Promise<DailyRecapEvidence> {
  const chatScopes = settings.scopes.filter((scope) => scope.type === 'chat' && scope.targetId);
  const authorizedChats: Chat[] = [];
  const chatLabelById = new Map<string, string>();
  for (const scope of chatScopes) {
    const chat = await reauthorizeChatForUser(scope.targetId!, userId);
    if (chat) {
      authorizedChats.push(chat);
      chatLabelById.set(chat._id.toString(), scope.label || 'Chat');
    }
  }
  const authorizedChatIds = authorizedChats.map((chat) => chat._id);

  if (authorizedChatIds.length === 0) {
    return { activeChatLabels: [], messages: [], media: [], decisions: [], plansAndEvents: [], tasks: [] };
  }

  const sinceDate = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
  const recentMessages = await getDatabase()
    .collection('messages')
    .find({ chatId: { $in: authorizedChatIds }, deletedAt: { $exists: false }, deletedFor: { $ne: userId }, createdAt: { $gte: sinceDate } })
    .sort({ createdAt: -1 })
    .limit(150)
    .toArray();

  const senderNames = await loadUserNames(recentMessages.map((message) => message.senderId));
  const activeChatIds = new Set<string>();
  const perChatCount = new Map<string, number>();
  const messageCards: VeyraResultCard[] = [];
  const mediaCards: VeyraResultCard[] = [];

  for (const message of recentMessages) {
    const chatKey = message.chatId.toString();
    activeChatIds.add(chatKey);
    const count = perChatCount.get(chatKey) || 0;
    // Capped per chat so one noisy conversation can't crowd out everything
    // else in the recap, and capped overall so the synthesis prompt stays a
    // manageable size.
    if (count >= 6 || messageCards.length + mediaCards.length >= 60) continue;
    perChatCount.set(chatKey, count + 1);

    const chatLabel = chatLabelById.get(chatKey) || 'Chat';
    const senderName = senderNames.get(message.senderId.toString()) || 'Someone';
    const bodyText = String(message.body || '');
    const isLink = URL_PATTERN.test(bodyText);
    const card: VeyraResultCard = {
      resultType: message.media ? 'attachment' : isLink ? 'link' : 'message',
      id: message._id.toString(),
      title: message.media?.fileName || (isLink ? bodyText.match(URL_PATTERN)?.[0] || 'Link' : bodyText.slice(0, 140) || 'Message'),
      subtitle: chatLabel,
      senderName,
      chatId: chatKey,
      chatLabel,
      createdAt: message.createdAt.toISOString(),
      deepLink: { kind: 'chat_message', chatId: chatKey, messageId: message._id.toString() },
    };
    if (message.media || isLink) mediaCards.push(card);
    else messageCards.push(card);
  }

  const decisionDocs = await getChatDecisionsCollection()
    .find({ chatId: { $in: authorizedChatIds } })
    .sort({ updatedAt: -1 })
    .limit(10)
    .toArray();
  const decisions = decisionDocs.map((decision) => ({
    title: decision.title,
    chatLabel: chatLabelById.get(decision.chatId.toString()),
  }));

  const plansEventsAndTasks = await findPlansAndEventsAndTasks(userId, settings, '');
  const plansAndEvents = plansEventsAndTasks.filter((card) => card.resultType === 'plan' || card.resultType === 'event');
  const tasks = plansEventsAndTasks.filter((card) => card.resultType === 'task');

  const activeChatLabels = Array.from(activeChatIds).map((chatId) => chatLabelById.get(chatId) || 'Chat');

  return {
    activeChatLabels: Array.from(new Set(activeChatLabels)),
    messages: messageCards,
    media: mediaCards,
    decisions,
    plansAndEvents,
    tasks,
  };
}
