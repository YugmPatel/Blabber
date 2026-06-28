import { ObjectId } from 'mongodb';
import type {
  ChatActionItem,
  ChatDecision,
  ChatIntelligenceSummary,
  GroupBrainAnswer,
  SourceReference,
  WaitingOnItem,
} from '@repo/types';
import { buildSourceReferenceMap, refsForIds } from './source-references';

function one(id?: string) {
  return id ? [id] : [];
}

function collectSummarySourceIds(summary: ChatIntelligenceSummary) {
  return [
    ...(summary.sourceMessageIds || []),
    ...(summary.decisions || []).flatMap((item) => item.sourceMessageIds || []),
    ...(summary.tasks || []).flatMap((item) => one(item.sourceMessageId)),
    ...(summary.questionsForMe || []).flatMap((item) => one(item.sourceMessageId)),
    ...(summary.importantLinks || []).flatMap((item) => one(item.sourceMessageId)),
    ...(summary.waitingOn || []).flatMap((item) => one(item.sourceMessageId)),
    ...(summary.noise || []).flatMap((item) => one(item.sourceMessageId)),
  ];
}

export async function materializeSummarySources({
  summary,
  chatId,
  userId,
}: {
  summary: ChatIntelligenceSummary;
  chatId: ObjectId;
  userId: ObjectId;
}): Promise<ChatIntelligenceSummary> {
  const refsById = await buildSourceReferenceMap({
    chatId,
    userId,
    messageIds: collectSummarySourceIds(summary),
  });

  return {
    ...summary,
    sources: refsForIds(refsById, summary.sourceMessageIds || [], 'Summary'),
    decisions: (summary.decisions || []).map((item) => ({
      ...item,
      sources: refsForIds(refsById, item.sourceMessageIds || [], 'Decision'),
    })),
    tasks: (summary.tasks || []).map((item) => ({
      ...item,
      sources: refsForIds(refsById, one(item.sourceMessageId), 'Task'),
    })),
    questionsForMe: (summary.questionsForMe || []).map((item) => ({
      ...item,
      sources: refsForIds(refsById, one(item.sourceMessageId), 'Question'),
    })),
    importantLinks: (summary.importantLinks || []).map((item) => ({
      ...item,
      sources: refsForIds(refsById, one(item.sourceMessageId), 'Link'),
    })),
    waitingOn: (summary.waitingOn || []).map((item) => ({
      ...item,
      sources: refsForIds(refsById, one(item.sourceMessageId), 'Waiting On'),
    })),
    noise: (summary.noise || []).map((item) => ({
      ...item,
      sources: refsForIds(refsById, one(item.sourceMessageId), 'Safe to Skip'),
    })),
  };
}

export async function materializeItemSources<T extends ChatActionItem | ChatDecision | WaitingOnItem>({
  items,
  chatId,
  userId,
  label,
}: {
  items: T[];
  chatId: ObjectId;
  userId: ObjectId;
  label: string;
}): Promise<T[]> {
  const refsById = await buildSourceReferenceMap({
    chatId,
    userId,
    messageIds: items.flatMap((item) => item.sourceMessageIds || []),
  });
  return items.map((item) => ({
    ...item,
    sources: refsForIds(refsById, item.sourceMessageIds || [], label),
  }));
}

export async function materializeAnswerSources({
  answer,
  chatId,
  userId,
}: {
  answer: GroupBrainAnswer;
  chatId: ObjectId;
  userId: ObjectId;
}): Promise<GroupBrainAnswer> {
  const refsById = await buildSourceReferenceMap({
    chatId,
    userId,
    messageIds: answer.sourceMessageIds || [],
  });
  const sources: SourceReference[] = refsForIds(refsById, answer.sourceMessageIds || [], 'Answer');
  return { ...answer, sources };
}
