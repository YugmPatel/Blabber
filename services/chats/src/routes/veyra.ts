import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { asyncHandler, logger } from '@repo/utils';
import { getDatabase } from '../db';
import { getChatsCollection } from '../models/chat';
import { getChatActionsCollection } from '../models/chat-action';
import { getChatDecisionsCollection } from '../models/chat-decision';
import { getPlanThisCollection } from '../models/plan-this';
import {
  GENERAL_VEYRA_INTENTS,
  RETRIEVAL_VEYRA_INTENTS,
  getOrCreateVeyraSettings,
  getVeyraAuditCollection,
  getVeyraSettingsCollection,
  type VeyraConversationContext,
  type VeyraIntentCategory,
  type VeyraResultCard,
  type VeyraScopeType,
  type VeyraSettingsDocument,
} from '../models/veyra';
import { isChatExpired } from '../serialize-chat';
import {
  classifyRetrievalContentType,
  extractNameQuery,
  findPlanByTitleLookup,
  findPlansAndEventsAndTasks,
  findTasksForContext,
  listAttachments,
  listLinks,
  loadUserNames,
  resolvePlanForContext,
  resolveScopedChat,
  resultTypeForCards,
  searchMessagesInChat,
  type ScopeResolution,
  type ScopeResolutionSource,
} from '../veyra-retrieval';

const ContextSchema = z
  .object({
    activeSpaceId: z.string().optional(),
    activeSpaceName: z.string().optional(),
    activePlanId: z.string().optional(),
    activePlanTitle: z.string().optional(),
    activeEventId: z.string().optional(),
    lastResultKind: z.string().optional(),
  })
  .optional();

const UpdateSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  voiceRepliesEnabled: z.boolean().optional(),
});
const GrantScopeSchema = z.object({
  type: z.enum(['general', 'my_actions', 'chat', 'community']),
  targetId: z.string().refine(ObjectId.isValid).optional(),
});
const AskSchema = z.object({
  prompt: z.string().min(1).max(1000),
  scopeId: z.string().optional(),
  context: ContextSchema,
});
const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

function scopeId(type: VeyraScopeType, targetId?: ObjectId) {
  return targetId ? `${type}:${targetId.toString()}` : type;
}

function classifyIntent(prompt: string): VeyraIntentCategory {
  const text = prompt.toLowerCase();
  // Identity / small-talk questions must never fall through to a scoped
  // Blabber question — they are answered locally and never touch chat data.
  if (/\b(what'?s your name|what is your name|who are you|what are you)\b/.test(text)) return 'identity';
  if (/\b(thanks|thank you|thx)\b/.test(text)) return 'acknowledgment';
  // "Which spaces/chats/groups" questions ask Veyra to list the user's own
  // currently-approved spaces — distinct from "what can you do", which is a
  // static explanation that never touches the user's actual scope list.
  if (
    /\b(which (spaces?|chats?|groups?)|what (spaces?|chats?|groups?) can you|spaces? (do|can) you have access|access to right now)\b/.test(
      text
    )
  ) {
    return 'capability_spaces';
  }
  // Action-class language must be checked first, but narrowly: "send me X" is a
  // retrieval request ("fetch and show me"), while "send X to Y" / "forward" /
  // "delete" name an actual destination or mutation, so only those count.
  if (/\bsend\b[^.?!]{0,40}\bto\b/.test(text) || /\b(forward|delete|remove this|update this|edit this|rsvp|schedule a)\b/.test(text)) {
    return 'action_request';
  }
  if (/\bwho (started|created|made|proposed)\b/.test(text)) return 'plan_creator';
  if (/\b(photo|photos|picture|pictures|image|images)\b/.test(text)) return 'find_photos';
  if (/\b(pdf|pdfs|document|documents|file|files)\b/.test(text)) return 'find_documents';
  if (/\b(link|links|url|urls)\b/.test(text)) return 'find_links';
  if (/\b(hi|hello|hey)\b/.test(text) || /how are you/.test(text)) return 'greeting';
  if (
    /\b(what can you|what do you do|your capabilit|tell me what you can do|approved veyra space|what is an approved space)\b/.test(text) ||
    text.trim() === 'help'
  ) {
    return 'general_help';
  }
  if (/\b(where|who)\b.{0,30}\b(plan|planned|trip|hiking|event)\b/.test(text)) return 'find_plans';
  if (/\b(decide|decided|decision|recap)\b/.test(text)) return 'decision_recap';
  if (/\b(plan|vote|waiting for my vote)\b/.test(text)) return 'plan_status';
  if (/\b(actions?|tasks?|reply|need to do|status)\b/.test(text)) return 'action_status';
  if (/\bshared\b/.test(text)) return 'latest_shared_item';
  if (/\b(where|open|go to|navigate)\b/.test(text)) return 'navigation_help';
  if (/\b(search|find|show me|show|list)\b/.test(text)) return 'search_messages';
  return 'unclear';
}

async function audit(userId: ObjectId, scopeType: VeyraScopeType, intentCategory: VeyraIntentCategory, succeeded: boolean) {
  await getVeyraAuditCollection().insertOne({ userId, scopeType, intentCategory, succeeded, createdAt: new Date() });
}

async function globalAiAllowed(userId: ObjectId) {
  const settings = await getDatabase().collection('userSettings').findOne({ userId });
  return settings?.chatIntelligenceEnabled !== false;
}

async function labelForChat(chatId: ObjectId, userId: ObjectId) {
  const chat = await getChatsCollection().findOne({ _id: chatId, participants: userId, deletedAt: { $exists: false } });
  if (!chat) return null;
  if (chat.type === 'group') return chat.title || 'Group chat';
  const other = chat.participants.find((id) => !id.equals(userId));
  if (!other) return 'Direct chat';
  const user = await getDatabase().collection('users').findOne({ _id: other }, { projection: { name: 1, username: 1 } });
  return `Direct chat with ${user?.name || user?.username || 'Someone'}`;
}

async function authorizedScopeLabel(type: VeyraScopeType, targetId: ObjectId | undefined, userId: ObjectId) {
  if (type === 'general') return 'General assistance';
  if (type === 'my_actions') return 'My Actions';
  if (type === 'chat' && targetId) {
    const chat = await getChatsCollection().findOne({ _id: targetId, participants: userId, deletedAt: { $exists: false } });
    if (!chat || (chat.type === 'group' && isChatExpired(chat))) return null;
    return labelForChat(targetId, userId);
  }
  if (type === 'community' && targetId) {
    const membership = await getDatabase().collection('community_memberships').findOne({ communityId: targetId, userId });
    const community = membership
      ? await getDatabase().collection('communities').findOne({ _id: targetId, deletedAt: { $exists: false } })
      : null;
    return community?.name || null;
  }
  return null;
}

function serializeSettings(settings: Awaited<ReturnType<typeof getOrCreateVeyraSettings>>) {
  return {
    enabled: settings.enabled,
    voiceRepliesEnabled: settings.voiceRepliesEnabled,
    scopes: settings.scopes.map((scope) => ({
      id: scope.id,
      type: scope.type,
      targetId: scope.targetId?.toString(),
      label: scope.label,
      grantedAt: scope.grantedAt.toISOString(),
    })),
    updatedAt: settings.updatedAt.toISOString(),
  };
}

export const getVeyraSettings = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  const settings = await getOrCreateVeyraSettings(new ObjectId(userId));
  return res.status(200).json({ settings: serializeSettings(settings), globalAiEnabled: await globalAiAllowed(new ObjectId(userId)) });
});

export const updateVeyraSettings = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  const parsed = UpdateSettingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation Error', message: 'Invalid Veyra settings.' });
  const userObjectId = new ObjectId(userId);
  if (parsed.data.enabled && !await globalAiAllowed(userObjectId)) {
    return res.status(403).json({ error: 'Forbidden', message: 'Turn on AI features in Privacy settings to use Veyra.' });
  }
  await getOrCreateVeyraSettings(userObjectId);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
  if (parsed.data.voiceRepliesEnabled !== undefined) patch.voiceRepliesEnabled = parsed.data.voiceRepliesEnabled;
  const settings = await getVeyraSettingsCollection().findOneAndUpdate(
    { userId: userObjectId },
    { $set: patch },
    { returnDocument: 'after' }
  );
  return res.status(200).json({ settings: serializeSettings(settings!) });
});

export const listVeyraScopeCandidates = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  const userObjectId = new ObjectId(userId);
  const chats = await getChatsCollection().find({ participants: userObjectId, deletedAt: { $exists: false } }).sort({ updatedAt: -1 }).limit(80).toArray();
  const chatCandidates = [];
  for (const chat of chats) {
    if (chat.type === 'group' && isChatExpired(chat)) continue;
    chatCandidates.push({ type: 'chat', targetId: chat._id.toString(), label: await labelForChat(chat._id, userObjectId) });
  }
  const memberships = await getDatabase().collection('community_memberships').find({ userId: userObjectId }).limit(50).toArray();
  const communities = memberships.length
    ? await getDatabase().collection('communities').find({ _id: { $in: memberships.map((item: any) => item.communityId) }, deletedAt: { $exists: false } }).project({ name: 1 }).toArray()
    : [];
  return res.status(200).json({
    candidates: [
      { type: 'general', label: 'General assistance' },
      { type: 'my_actions', label: 'My Actions' },
      ...chatCandidates,
      ...communities.map((community: any) => ({ type: 'community', targetId: community._id.toString(), label: community.name })),
    ],
  });
});

export const grantVeyraScope = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  const parsed = GrantScopeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation Error', message: 'Invalid Veyra scope.' });
  const userObjectId = new ObjectId(userId);
  const targetId = parsed.data.targetId ? new ObjectId(parsed.data.targetId) : undefined;
  const label = await authorizedScopeLabel(parsed.data.type, targetId, userObjectId);
  if (!label) return res.status(404).json({ error: 'Not Found', message: 'That space is not available to Veyra right now.' });
  await getOrCreateVeyraSettings(userObjectId);
  const id = scopeId(parsed.data.type, targetId);
  await getVeyraSettingsCollection().updateOne(
    { userId: userObjectId, 'scopes.id': { $ne: id } },
    { $push: { scopes: { id, type: parsed.data.type, targetId, label, grantedAt: new Date() } }, $set: { updatedAt: new Date() } }
  );
  const settings = await getOrCreateVeyraSettings(userObjectId);
  return res.status(200).json({ settings: serializeSettings(settings) });
});

export const revokeVeyraScope = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  const userObjectId = new ObjectId(userId);
  await getVeyraSettingsCollection().updateOne(
    { userId: userObjectId },
    { $pull: { scopes: { id: req.params.scopeId } }, $set: { updatedAt: new Date() } }
  );
  const settings = await getOrCreateVeyraSettings(userObjectId);
  return res.status(200).json({ settings: serializeSettings(settings) });
});

async function myActionsAnswer(userId: ObjectId) {
  const chats = await getChatsCollection().find({ participants: userId, deletedAt: { $exists: false } }).project({ _id: 1, title: 1, type: 1 }).toArray();
  const chatIds = chats.map((chat) => chat._id);
  const actions = await getChatActionsCollection().find({
    chatId: { $in: chatIds },
    deletedAt: { $exists: false },
    status: { $in: ['open', 'in_progress', 'pending', 'accepted'] as any },
    $or: [{ 'assignedTo.userId': userId.toString() }, { personalOwnerUserId: userId }],
  }).sort({ dueAt: 1, updatedAt: -1 }).limit(5).toArray();
  if (actions.length === 0) return 'From your My Actions: there are no active items waiting on you.';
  return `From your My Actions: ${actions.map((action) => action.title).join('; ')}.`;
}

async function planStatusAnswer(userId: ObjectId) {
  const plans = await getPlanThisCollection().find({
    'participants.userId': userId,
    state: { $in: ['voting', 'ready_to_finalize'] },
  }).sort({ updatedAt: -1 }).limit(5).toArray();
  const waiting = plans.filter((plan) => !plan.votes.some((vote) => vote.userId.equals(userId)));
  if (waiting.length === 0) return 'From your Plan This items: no plan is waiting for your vote right now.';
  return `From your Plan This items: ${waiting.map((plan) => plan.title).join('; ')} ${waiting.length === 1 ? 'is' : 'are'} waiting for your vote.`;
}

/** Only decision_recap / action_status (no-context legacy path) / latest_shared_item reach this now — the old unguarded chat-summary fallback has been removed entirely (bug 5). */
async function chatAnswer(chatId: ObjectId, userId: ObjectId, intent: 'decision_recap' | 'action_status' | 'latest_shared_item') {
  const chat = await getChatsCollection().findOne({ _id: chatId, participants: userId, deletedAt: { $exists: false } });
  if (!chat || (chat.type === 'group' && isChatExpired(chat))) return null;
  const label = await labelForChat(chatId, userId);
  if (intent === 'decision_recap') {
    const decisions = await getChatDecisionsCollection().find({ chatId }).sort({ updatedAt: -1 }).limit(3).toArray();
    if (decisions.length === 0) return `Based on the current decision record in ${label}: no decisions are saved yet.`;
    return `Based on the current decision record in ${label}: ${decisions.map((decision) => decision.title).join('; ')}.`;
  }
  if (intent === 'action_status') {
    const actions = await getChatActionsCollection().find({ chatId, deletedAt: { $exists: false }, status: { $ne: 'completed' as any } }).sort({ updatedAt: -1 }).limit(3).toArray();
    if (actions.length === 0) return `Based on current actions in ${label}: there are no active actions.`;
    return `Based on current actions in ${label}: ${actions.map((action) => action.title).join('; ')}.`;
  }
  const message = await getDatabase().collection('messages').findOne(
    { chatId, deletedFor: { $ne: userId }, $or: [{ 'media.type': 'document' }, { body: /https?:\/\//i }] },
    { sort: { createdAt: -1 }, projection: { body: 1, media: 1, createdAt: 1 } }
  );
  if (!message) return `From shared items in ${label}: nothing is available right now.`;
  const kind = message.media?.type === 'document' ? 'document' : 'link';
  return `From shared items in ${label}: the latest available ${kind} was shared on ${message.createdAt.toISOString().slice(0, 10)}.`;
}

type RetrievalContentIntent = 'find_photos' | 'find_documents' | 'find_links' | 'find_plans' | 'search_messages';

function relativeDay(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) /
      86_400_000
  );
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

/**
 * `usedPlanContext` is true when the target space was resolved from a
 * contextual reference ("that group", "this chat", "from there") grounded to
 * the active plan, rather than an explicit chat name — in that case the
 * answer says so explicitly, so the user can tell Veyra understood the
 * pronoun rather than guessing.
 */
function summarizeRetrieval(
  contentIntent: RetrievalContentIntent,
  cards: VeyraResultCard[],
  scopeLabel: string,
  attachmentKind?: 'pdf' | 'document',
  usedPlanContext?: boolean
) {
  const count = cards.length;
  const nounFor: Record<RetrievalContentIntent, [string, string]> = {
    find_photos: ['photo', 'photos'],
    find_documents: attachmentKind === 'pdf' ? ['PDF', 'PDFs'] : ['document', 'documents'],
    find_links: ['link', 'links'],
    find_plans: ['result', 'results'],
    search_messages: ['message', 'messages'],
  };
  const [singular, plural] = nounFor[contentIntent];
  const noun = count === 1 ? singular : plural;
  const first = cards[0];
  if (contentIntent === 'find_plans' && first) {
    const creator = first.senderName ? `, started by ${first.senderName}` : '';
    return `I found ${count} result${count === 1 ? '' : 's'}. The most relevant is "${first.title}" in ${first.chatLabel || first.subtitle || 'a chat'}${creator}.`;
  }
  if (usedPlanContext) {
    return `I found ${count} ${noun} in ${scopeLabel} related to the current plan context.`;
  }
  const recency = first?.createdAt && first.senderName ? ` The newest is from ${first.senderName} ${relativeDay(first.createdAt)}.` : '';
  return `I found ${count} ${noun} in ${scopeLabel}.${recency}`;
}

async function synthesizeVeyraAnswer(
  prompt: string,
  cards: VeyraResultCard[],
  fallbackAnswer: string
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = process.env.OPENROUTER_MODEL?.trim();
  if (!apiKey || !model || cards.length === 0) return fallbackAnswer;

  const context = cards.slice(0, 6).map((card, index) => ({
    index: index + 1,
    type: card.resultType,
    title: card.title,
    subtitle: card.subtitle,
    senderName: card.senderName,
    chatLabel: card.chatLabel,
    createdAt: card.createdAt,
  }));

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    const referer = process.env.OPENROUTER_HTTP_REFERER || process.env.OPENROUTER_REFERER;
    if (referer) headers['HTTP-Referer'] = referer;

    const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You are Veyra inside Blabber. Answer only from the approved retrieved result metadata provided. Do not invent facts, messages, or spaces. Keep the answer concise and mention that results are from approved spaces.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              question: prompt,
              deterministicAnswer: fallbackAnswer,
              approvedResults: context,
            }),
          },
        ],
        temperature: 0.2,
        max_tokens: 220,
      }),
    });

    if (!response.ok) throw new Error(`openrouter_${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content?.trim();
    return content || fallbackAnswer;
  } catch (error) {
    logger.warn(
      {
        feature: 'veyra',
        approvedResultCount: cards.length,
        reason: error instanceof Error ? error.message : 'unknown_openrouter_error',
      },
      'Veyra OpenRouter synthesis fallback used'
    );
    return fallbackAnswer;
  }
}

function scopeIdForChat(settings: VeyraSettingsDocument, chatId: ObjectId): string | undefined {
  return settings.scopes.find((scope) => scope.type === 'chat' && scope.targetId?.equals(chatId))?.id;
}

async function runRetrieval(
  contentIntent: RetrievalContentIntent,
  userId: ObjectId,
  settings: VeyraSettingsDocument,
  prompt: string,
  scopeId: string | undefined,
  clientContext: VeyraConversationContext | undefined
): Promise<
  | { outcome: 'scope_missing' }
  | { outcome: 'ambiguous'; candidates: Array<{ scopeId: string; label: string }> }
  | {
      outcome: 'ok';
      cards: VeyraResultCard[];
      scopeLabel: string;
      scopeId?: string;
      scopeType: VeyraScopeType;
      attachmentKind?: 'pdf' | 'document';
      resolutionSource?: ScopeResolutionSource;
    }
> {
  if (contentIntent === 'find_plans') {
    const hasRelevantScope = settings.scopes.some((scope) => (scope.type === 'chat' && scope.targetId) || scope.type === 'my_actions');
    if (!hasRelevantScope) return { outcome: 'scope_missing' };
    const query = extractNameQuery(prompt) || '';
    const cards = await findPlansAndEventsAndTasks(userId, settings, query);
    return { outcome: 'ok', cards, scopeLabel: 'your approved spaces', scopeType: 'general' };
  }

  const resolution: ScopeResolution = await resolveScopedChat(userId, settings, {
    scopeId,
    prompt,
    context: { activeSpaceId: clientContext?.activeSpaceId },
  });
  if (!resolution.ok) {
    if (resolution.reason === 'ambiguous') return { outcome: 'ambiguous', candidates: resolution.candidates };
    return { outcome: 'scope_missing' };
  }
  const { chat, label, source } = resolution;
  const matchedScope = settings.scopes.find((scope) => scope.type === 'chat' && scope.targetId?.equals(chat._id));

  let cards: VeyraResultCard[];
  let attachmentKind: 'pdf' | 'document' | undefined;
  if (contentIntent === 'find_photos') {
    cards = await listAttachments(chat, userId, 'image');
  } else if (contentIntent === 'find_documents') {
    attachmentKind = /\bpdf/i.test(prompt) ? 'pdf' : 'document';
    cards = await listAttachments(chat, userId, attachmentKind);
  } else if (contentIntent === 'find_links') {
    cards = await listLinks(chat, userId);
  } else {
    cards = await searchMessagesInChat(chat, userId, extractNameQuery(prompt) || '');
  }
  return { outcome: 'ok', cards, scopeLabel: label, scopeId: matchedScope?.id, scopeType: 'chat', attachmentKind, resolutionSource: source };
}

/** Derives the next turn's server-authoritative context from this turn's outcome. On a failed/empty turn, the prior context is preserved rather than wiped. */
function nextContext(
  prior: VeyraConversationContext | undefined,
  update: Partial<VeyraConversationContext> | 'preserve'
): VeyraConversationContext | undefined {
  if (update === 'preserve') return prior;
  const merged = { ...prior, ...update };
  const cleaned = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));
  return Object.keys(cleaned).length > 0 ? (cleaned as VeyraConversationContext) : undefined;
}

export const askVeyra = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: 'User not authenticated' });
  const parsed = AskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Validation Error', message: 'Invalid Veyra request.' });
  const userObjectId = new ObjectId(userId);
  const settings = await getOrCreateVeyraSettings(userObjectId);
  const intent = classifyIntent(parsed.data.prompt);
  const clientContext = parsed.data.context as VeyraConversationContext | undefined;
  if (!settings.enabled) return res.status(403).json({ error: 'Forbidden', message: 'Turn on Veyra in AI Privacy to begin.' });
  if (!await globalAiAllowed(userObjectId)) return res.status(403).json({ error: 'Forbidden', message: 'Turn on Veyra in AI Privacy to begin.' });

  // A bare reply to "Which plan would you like to know about?" (or any other
  // unclassifiable text) is tried as a plan-title lookup before falling back
  // to the generic "I'm not sure" message — bounded strictly to plans inside
  // already-authorized chat scopes, never a broader search.
  if (intent === 'unclear') {
    const lookup = await findPlanByTitleLookup(userObjectId, settings, parsed.data.prompt);
    if (lookup.outcome === 'ambiguous') {
      await audit(userObjectId, 'general', 'find_plans', false);
      return res.status(200).json({
        answer: `I found more than one matching plan: ${lookup.labels.join(' and ')}. Which one did you mean?`,
        intent: 'find_plans',
        scope: null,
        resultType: 'empty',
        results: [],
        context: nextContext(clientContext, 'preserve'),
      });
    }
    if (lookup.outcome === 'ok') {
      const matchedScope = lookup.scopeId ? settings.scopes.find((scope) => scope.id === lookup.scopeId) : undefined;
      await audit(userObjectId, 'chat', 'find_plans', true);
      return res.status(200).json({
        answer: `Found it: "${lookup.card.title}" in ${lookup.card.chatLabel}, started by ${lookup.card.senderName}.`,
        intent: 'find_plans',
        scope: matchedScope ? { id: matchedScope.id, type: 'chat', label: lookup.card.chatLabel || 'Chat' } : null,
        resultType: 'plan',
        results: [lookup.card],
        context: nextContext(clientContext, {
          activePlanId: lookup.card.id,
          activePlanTitle: lookup.card.title,
          activeSpaceId: lookup.scopeId,
          activeSpaceName: lookup.card.chatLabel,
          lastResultKind: 'plan',
        }),
      });
    }
    // No matching plan — fall through to the standard safe "unclear" message below.
  }

  // General conversation (greetings, identity, "what can you do", acknowledgments,
  // static navigation help) never touches private Blabber data and never falls
  // back to a chat summary — it works even with zero approved scopes, and the
  // prior grounded context (if any) is preserved untouched for the next turn.
  if (GENERAL_VEYRA_INTENTS.has(intent)) {
    let answer: string;
    let suggestManageAiPrivacy: boolean | undefined;
    if (intent === 'identity') {
      answer = "I'm Veyra, your Blabber AI companion.";
    } else if (intent === 'greeting') {
      answer = 'Hi, I am here. Ask me anything, or tell me which Blabber space you would like me to look at.';
    } else if (intent === 'acknowledgment') {
      answer = "You're welcome! Let me know if there's anything else you'd like to find.";
    } else if (intent === 'general_help') {
      answer =
        "I can search the Blabber spaces you've approved for messages, links, PDFs, files, photos, plans, events, and tasks — just tell me what to look for and where. An approved space is a chat, group, or community you've explicitly selected in AI Privacy; I never search anywhere else.";
    } else if (intent === 'capability_spaces') {
      const approvedLabels = settings.scopes
        .filter((scope) => scope.type === 'chat' || scope.type === 'community')
        .map((scope) => scope.label || 'Unnamed space');
      if (approvedLabels.length === 0) {
        answer = "You haven't approved any spaces yet. Go to Manage AI privacy to choose chats, groups, or communities Veyra can search.";
        suggestManageAiPrivacy = true;
      } else {
        answer = `Right now I can search: ${approvedLabels.join(', ')}.`;
      }
    } else if (intent === 'unclear') {
      answer =
        "I'm not sure how to help with that yet. I can search messages, links, PDFs, files, photos, plans, events, and tasks in the spaces you've approved — try asking me to find something specific.";
    } else {
      answer = 'I can help you find Chats, Feed, Reels, Discover, My Actions, Settings, and approved spaces.';
    }
    await audit(userObjectId, 'general', intent, true);
    return res.status(200).json({
      answer,
      intent,
      scope: null,
      resultType: 'empty',
      results: [],
      context: nextContext(clientContext, 'preserve'),
      suggestManageAiPrivacy,
    });
  }

  // "Who started it?" — grounded strictly to the echoed activePlanId, which is
  // re-resolved and re-authorized right now (never trusted). No prior grounded
  // plan means a short clarification, not a guess.
  if (intent === 'plan_creator') {
    const planId = clientContext?.activePlanId;
    if (!planId) {
      await audit(userObjectId, 'general', intent, false);
      return res.status(200).json({
        answer: 'Which plan would you like to know about?',
        intent,
        scope: null,
        resultType: 'empty',
        results: [],
        context: nextContext(clientContext, 'preserve'),
      });
    }
    const resolved = await resolvePlanForContext(userObjectId, settings, planId);
    if (!resolved) {
      // The plan/space is no longer valid (e.g. the scope was revoked since
      // it was grounded) — refuse rather than guess, but do not erase the
      // caller's context: an unrelated later follow-up may still be usable,
      // and every future use re-authorizes independently regardless.
      await audit(userObjectId, 'chat', intent, false);
      return res.status(200).json({
        answer: "I couldn't find an authorized match in your approved Veyra spaces.",
        intent,
        scope: null,
        resultType: 'empty',
        results: [],
        context: nextContext(clientContext, 'preserve'),
      });
    }
    const { plan, label, scopeId: resolvedScopeId } = resolved;
    const names = await loadUserNames([plan.creatorUserId]);
    const creatorName = names.get(plan.creatorUserId.toString()) || 'Someone';
    const card: VeyraResultCard = {
      resultType: 'plan',
      id: plan._id.toString(),
      title: plan.title,
      subtitle: `${plan.state.replace(/_/g, ' ')} · ${label}`,
      senderName: creatorName,
      chatId: plan.chatId.toString(),
      chatLabel: label,
      createdAt: plan.createdAt.toISOString(),
      deepLink: plan.proposalMessageId
        ? { kind: 'chat_message', chatId: plan.chatId.toString(), messageId: plan.proposalMessageId.toString() }
        : undefined,
    };
    await audit(userObjectId, 'chat', intent, true);
    return res.status(200).json({
      answer: `${creatorName} started "${plan.title}" in ${label}.`,
      intent,
      scope: { id: resolvedScopeId, type: 'chat', label },
      resultType: 'plan',
      results: [card],
      context: nextContext(clientContext, {
        activePlanId: plan._id.toString(),
        activePlanTitle: plan.title,
        activeSpaceId: resolvedScopeId,
        activeSpaceName: label,
        lastResultKind: 'plan',
      }),
    });
  }

  // "What tasks do I have for this?" — grounded to the echoed plan/space
  // context when present; otherwise behaves exactly as it always has (prefers
  // the approved My Actions scope, matching every pre-existing test/behavior).
  if (intent === 'action_status' && (clientContext?.activePlanId || clientContext?.activeSpaceId)) {
    if (clientContext.activePlanId) {
      const resolved = await resolvePlanForContext(userObjectId, settings, clientContext.activePlanId);
      if (!resolved) {
        await audit(userObjectId, 'chat', intent, false);
        return res.status(200).json({
          answer: "I couldn't find an authorized match in your approved Veyra spaces.",
          intent,
          scope: null,
          resultType: 'empty',
          results: [],
          context: nextContext(clientContext, 'preserve'),
        });
      }
      const cards = await findTasksForContext(userObjectId, { plan: resolved.plan });
      await audit(userObjectId, 'chat', intent, cards.length > 0);
      return res.status(200).json({
        answer:
          cards.length === 0
            ? `There are no open tasks assigned to you for "${resolved.plan.title}" in ${resolved.label}.`
            : `I found ${cards.length} open task${cards.length === 1 ? '' : 's'} assigned to you for "${resolved.plan.title}" in ${resolved.label}.`,
        intent,
        scope: { id: resolved.scopeId, type: 'chat', label: resolved.label },
        resultType: resultTypeForCards(cards),
        results: cards,
        context: nextContext(clientContext, { lastResultKind: 'task' }),
      });
    }
    const resolution = await resolveScopedChat(userObjectId, settings, {
      scopeId: parsed.data.scopeId,
      prompt: parsed.data.prompt,
      context: { activeSpaceId: clientContext.activeSpaceId },
    });
    if (resolution.ok) {
      const matchedScope = settings.scopes.find((scope) => scope.type === 'chat' && scope.targetId?.equals(resolution.chat._id));
      const cards = await findTasksForContext(userObjectId, { chat: resolution.chat });
      await audit(userObjectId, 'chat', intent, cards.length > 0);
      return res.status(200).json({
        answer:
          cards.length === 0
            ? `There are no active tasks waiting on you in ${resolution.label}.`
            : `I found ${cards.length} task${cards.length === 1 ? '' : 's'} for you in ${resolution.label}.`,
        intent,
        scope: matchedScope ? { id: matchedScope.id, type: 'chat', label: resolution.label } : null,
        resultType: resultTypeForCards(cards),
        results: cards,
        context: nextContext(clientContext, { lastResultKind: 'task' }),
      });
    }
    // Grounded context/name was present but no longer resolves (e.g. scope was
    // revoked) — fall through to the legacy general behavior below rather than
    // silently guessing.
  }

  // Retrieval (find/list/search authorized content) and action-class language
  // (send/forward/create/update/delete) are both handled by the permissioned
  // tools in veyra-retrieval.ts — never by a generic conversation summary.
  // Action requests run the same bounded lookup and return a confirmation-ready
  // proposal; no side effect is ever performed in this batch.
  if (RETRIEVAL_VEYRA_INTENTS.has(intent) || intent === 'action_request') {
    const contentIntent: RetrievalContentIntent =
      intent === 'action_request' ? classifyRetrievalContentType(parsed.data.prompt) : (intent as RetrievalContentIntent);
    const retrieval = await runRetrieval(contentIntent, userObjectId, settings, parsed.data.prompt, parsed.data.scopeId, clientContext);

    if (retrieval.outcome === 'scope_missing') {
      await audit(userObjectId, 'general', intent, false);
      return res.status(403).json({
        error: 'Forbidden',
        message: 'To search that, Veyra needs access to an approved space.',
        code: 'scope_required',
      });
    }
    if (retrieval.outcome === 'ambiguous') {
      await audit(userObjectId, 'general', intent, false);
      const names = retrieval.candidates.map((candidate) => candidate.label).join(' and ');
      return res.status(200).json({
        answer: `I found matches in more than one space: ${names}. Which one should I open?`,
        intent,
        scope: null,
        resultType: 'empty',
        results: [],
        ambiguous: true,
        candidates: retrieval.candidates,
        context: nextContext(clientContext, 'preserve'),
      });
    }

    const { cards, scopeLabel, scopeId: resolvedScopeId, scopeType, attachmentKind, resolutionSource } = retrieval;
    const resultType = resultTypeForCards(cards);
    // A contextual reference ("that group", "this chat", "from there") only
    // gets the "related to the current plan context" phrasing when it's
    // actually grounded to a plan — a bare space reference with no active
    // plan uses the plain wording instead.
    const usedPlanContext = resolutionSource === 'context' && Boolean(clientContext?.activePlanTitle);
    let answer: string;
    if (cards.length === 0) {
      answer = "I couldn't find an authorized match in your approved Veyra spaces.";
    } else if (intent === 'action_request') {
      const noun =
        contentIntent === 'find_photos' ? 'photo' : contentIntent === 'find_documents' ? 'document' : contentIntent === 'find_links' ? 'link' : 'item';
      answer = `I found ${cards.length} ${noun}${cards.length === 1 ? '' : 's'}. Choose one, then confirm where to send it.`;
	    } else {
	      answer = summarizeRetrieval(contentIntent, cards, scopeLabel, attachmentKind, usedPlanContext);
	    }
	    if (cards.length > 0 && intent !== 'action_request') {
	      answer = await synthesizeVeyraAnswer(parsed.data.prompt, cards, answer);
	    }

    await audit(userObjectId, scopeType, intent, cards.length > 0);

    // Ground the next turn's context from this turn's result. A specific
    // resolved chat always sets the active space; a Plan/event result also
    // grounds the plan/event itself; an empty result preserves prior context
    // rather than wiping it out.
    let contextUpdate: Partial<VeyraConversationContext> | 'preserve' = 'preserve';
    if (cards.length > 0) {
      const top = cards[0];
      if (contentIntent === 'find_plans') {
        const topSpaceId = top.chatId ? scopeIdForChat(settings, new ObjectId(top.chatId)) : undefined;
        contextUpdate = {
          activeSpaceId: topSpaceId,
          activeSpaceName: top.chatLabel,
          activePlanId: top.resultType === 'plan' ? top.id : undefined,
          activePlanTitle: top.resultType === 'plan' ? top.title : undefined,
          activeEventId: top.resultType === 'event' ? top.id : undefined,
          lastResultKind: resultType,
        };
      } else if (scopeType === 'chat' && resolvedScopeId) {
        contextUpdate = {
          activeSpaceId: resolvedScopeId,
          activeSpaceName: scopeLabel,
          activePlanId: undefined,
          activePlanTitle: undefined,
          activeEventId: undefined,
          lastResultKind: resultType,
        };
      }
    }

    return res.status(200).json({
      answer,
      intent,
      scope: resolvedScopeId ? { id: resolvedScopeId, type: scopeType, label: scopeLabel } : null,
      resultType,
      results: cards,
      actionDeferred: intent === 'action_request',
      context: nextContext(clientContext, contextUpdate),
    });
  }

  // Everything else is a scoped Blabber question — it must resolve to a scope the user
  // has explicitly approved. `plan_status` spans every chat the user participates in, so
  // (unlike decision/shared-item questions, which are bounded to whichever chat answers
  // them) it specifically requires the user-wide `my_actions` scope rather than accepting
  // any approved scope as a stand-in. decision_recap / latest_shared_item resolve their
  // target chat the same context-aware, name-overrides-everything way retrieval does.
  if (intent === 'decision_recap' || intent === 'latest_shared_item') {
    const resolution = await resolveScopedChat(userObjectId, settings, {
      scopeId: parsed.data.scopeId,
      prompt: parsed.data.prompt,
      context: { activeSpaceId: clientContext?.activeSpaceId },
    });
    if (!resolution.ok) {
      if (resolution.reason === 'ambiguous') {
        await audit(userObjectId, 'general', intent, false);
        const names = resolution.candidates.map((candidate) => candidate.label).join(' and ');
        return res.status(200).json({
          answer: `I found matches in more than one space: ${names}. Which one should I open?`,
          intent,
          scope: null,
          resultType: 'empty',
          results: [],
          ambiguous: true,
          candidates: resolution.candidates,
          context: nextContext(clientContext, 'preserve'),
        });
      }
      await audit(userObjectId, 'general', intent, false);
      return res.status(403).json({
        error: 'Forbidden',
        message: 'To answer that, Veyra needs access to an approved space.',
        code: 'scope_required',
      });
    }
    const matchedScope = settings.scopes.find((scope) => scope.type === 'chat' && scope.targetId?.equals(resolution.chat._id));
    const answer = (await chatAnswer(resolution.chat._id, userObjectId, intent)) || 'That space is not available to Veyra right now.';
    await audit(userObjectId, 'chat', intent, true);
    return res.status(200).json({
      answer,
      intent,
      scope: matchedScope ? { id: matchedScope.id, type: 'chat', label: resolution.label } : null,
      resultType: 'empty',
      results: [],
      context: nextContext(clientContext, {
        activeSpaceId: matchedScope?.id,
        activeSpaceName: resolution.label,
        lastResultKind: 'empty',
      }),
    });
  }

  const requiresMyActionsScope = intent === 'plan_status';
  const selectedScope = parsed.data.scopeId
    ? settings.scopes.find((scope) => scope.id === parsed.data.scopeId)
    : requiresMyActionsScope || intent === 'action_status'
      ? settings.scopes.find((scope) => scope.type === 'my_actions') || settings.scopes[0]
      : settings.scopes.find((scope) => scope.type === 'general') || settings.scopes[0];

  if (!selectedScope || (requiresMyActionsScope && selectedScope.type !== 'my_actions')) {
    await audit(userObjectId, requiresMyActionsScope ? 'my_actions' : 'general', intent, false);
    return res.status(403).json({
      error: 'Forbidden',
      message: 'To answer that, Veyra needs access to an approved space.',
      code: 'scope_required',
    });
  }
  const available = await authorizedScopeLabel(selectedScope.type, selectedScope.targetId, userObjectId);
  if (!available) {
    await audit(userObjectId, selectedScope.type, intent, false);
    return res.status(404).json({ error: 'Not Found', message: 'That space is not available to Veyra right now.' });
  }

  let answer = '';
  if (intent === 'plan_status') {
    answer = await planStatusAnswer(userObjectId);
  } else if (selectedScope.type === 'my_actions') {
    answer = await myActionsAnswer(userObjectId);
  } else if (selectedScope.type === 'chat' && selectedScope.targetId) {
    answer = (await chatAnswer(selectedScope.targetId, userObjectId, 'action_status')) || 'That space is not available to Veyra right now.';
  } else if (selectedScope.type === 'community') {
    answer = `From ${available}: Veyra can use only safe existing Community summary/action metadata in this version. No available summary was found.`;
  } else {
    answer = 'I can chat and help with navigation. Approve My Actions or a specific space to ask about private updates.';
  }

  await audit(userObjectId, selectedScope.type, intent, true);
  return res.status(200).json({
    answer,
    intent,
    scope: { id: selectedScope.id, type: selectedScope.type, label: available },
    resultType: 'empty',
    results: [],
    context: nextContext(clientContext, 'preserve'),
  });
});
