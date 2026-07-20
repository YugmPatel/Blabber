import type { ObjectId } from 'mongodb';
import type { ChatIntelligenceSummary, ChatSummaryNoiseItem, ChatSummaryQuestion } from '@repo/types';

export interface PersonalizationMessage {
  _id: ObjectId;
  senderId: ObjectId;
  body: string;
  createdAt: Date;
}

export interface PersonalizationUser {
  _id: ObjectId;
  name?: string;
  username?: string;
}

function normalizeAlias(value?: string | null) {
  return (value || '').trim().toLowerCase().replace(/^@/, '').replace(/\s+/g, ' ');
}

function aliasesFor(user: PersonalizationUser) {
  return Array.from(
    new Set(
      [user.name, user.username]
        .map(normalizeAlias)
        .filter((value) => value.length >= 2)
    )
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentionsAlias(text: string, alias: string) {
  const escaped = escapeRegExp(alias);
  return new RegExp(`(^|[^a-z0-9])@?${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

function cleanQuestionText(body: string, aliases: string[]) {
  let text = body.replace(/\s+/g, ' ').trim();
  for (const alias of aliases) {
    text = text.replace(new RegExp(`^@?${escapeRegExp(alias)}[,:\\s-]+`, 'i'), '');
    text = text.replace(new RegExp(`[,:\\s-]+@?${escapeRegExp(alias)}$`, 'i'), '');
  }
  text = text.replace(/\?+$/, '').trim();
  text = text.replace(/^can you\s+/i, '');
  text = text.replace(/^could you\s+/i, '');
  text = text.replace(/^please\s+/i, '');
  if (text) text = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  return text || body.trim();
}

function isDirectRequestForViewer(message: PersonalizationMessage, viewer: PersonalizationUser) {
  if (message.senderId.equals(viewer._id)) return false;
  const body = message.body || '';
  if (!/[?]|\b(can you|could you|please|confirm|send|approve|review|share)\b/i.test(body)) return false;
  return aliasesFor(viewer).some((alias) => mentionsAlias(body, alias));
}

export function questionsForViewer(
  messages: PersonalizationMessage[],
  viewer: PersonalizationUser
): ChatSummaryQuestion[] {
  const aliases = aliasesFor(viewer);
  if (aliases.length === 0) return [];

  const seen = new Set<string>();
  return messages
    .filter((message) => isDirectRequestForViewer(message, viewer))
    .map((message) => ({
      question: cleanQuestionText(message.body, aliases),
      sourceMessageId: message._id.toString(),
    }))
    .filter((question) => {
      const key = `${question.question.toLowerCase()}::${question.sourceMessageId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function isLowPriorityText(text: string) {
  const normalized = text.toLowerCase().trim();
  if (!normalized) return false;
  if (/https?:\/\//i.test(text)) return false;
  if (/[?]/.test(text)) return false;
  if (/\b(decided|decision|will|can you|could you|please|due|deadline|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|waiting|blocked|confirm|bring|send|approve|review|deposit|venue|cake|guest count)\b/i.test(text)) {
    return false;
  }
  return /^(hi|hello|hey|thanks|thank you|sounds good|ok|okay|great|perfect|cool|got it|awesome|nice|see you|bye|yep|yes)[!. ]*$/i.test(normalized) ||
    /\b(thanks everyone|sounds good|got it|okay great)\b/i.test(normalized);
}

export function filterSafeToSkip(
  noise: ChatSummaryNoiseItem[],
  messagesById: Map<string, { body?: string }>
) {
  return (noise || []).filter((item) => {
    const sourceText = messagesById.get(item.sourceMessageId)?.body || item.text;
    return isLowPriorityText(sourceText);
  });
}

/**
 * Provider-supplied questions survive personalization only when they are
 * grounded, open asks: the cited source message must really exist, really
 * contain a question mark, and not be the viewer's own message. This keeps
 * group-wide open questions ("Can someone confirm parking and mailbox
 * access?") visible while still dropping anything fabricated or irrelevant.
 */
function groundedOpenQuestions(
  questions: ChatSummaryQuestion[],
  messagesById: Map<string, PersonalizationMessage>,
  viewer: PersonalizationUser
): ChatSummaryQuestion[] {
  return (questions || []).filter((question) => {
    const source = messagesById.get(question.sourceMessageId);
    if (!source) return false;
    if (source.senderId.equals(viewer._id)) return false;
    return /[?]/.test(source.body || '');
  });
}

export function personalizeSummary({
  summary,
  messages,
  viewer,
}: {
  summary: ChatIntelligenceSummary;
  messages: PersonalizationMessage[];
  viewer: PersonalizationUser;
}): ChatIntelligenceSummary {
  const messagesById = new Map(messages.map((message) => [message._id.toString(), message]));

  // Viewer-directed asks first, then remaining grounded open questions from
  // the provider — deduped by source message so one message never shows twice.
  const merged: ChatSummaryQuestion[] = [];
  const seenSources = new Set<string>();
  for (const question of [
    ...questionsForViewer(messages, viewer),
    ...groundedOpenQuestions(summary.questionsForMe || [], messagesById, viewer),
  ]) {
    if (seenSources.has(question.sourceMessageId)) continue;
    seenSources.add(question.sourceMessageId);
    merged.push(question);
  }

  return {
    ...summary,
    questionsForMe: merged.slice(0, 8),
    noise: filterSafeToSkip(summary.noise || [], messagesById),
  };
}
