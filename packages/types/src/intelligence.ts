import { z } from 'zod';

export const ChatSummaryDecisionSchema = z.object({
  title: z.string().min(1),
  status: z.enum(['proposed', 'final', 'reverted']),
  sourceMessageIds: z.array(z.string()),
});

export type ChatSummaryDecision = z.infer<typeof ChatSummaryDecisionSchema>;

export const ChatSummaryTaskSchema = z.object({
  title: z.string().min(1),
  assignedTo: z.string().nullable(),
  dueDate: z.string().nullable(),
  status: z.enum(['pending', 'in_progress', 'done', 'blocked']),
  sourceMessageId: z.string(),
});

export type ChatSummaryTask = z.infer<typeof ChatSummaryTaskSchema>;

export const ChatSummaryQuestionSchema = z.object({
  question: z.string().min(1),
  sourceMessageId: z.string(),
});

export type ChatSummaryQuestion = z.infer<typeof ChatSummaryQuestionSchema>;

export const ChatSummaryImportantLinkSchema = z.object({
  url: z.string().url(),
  label: z.string().nullable(),
  sourceMessageId: z.string(),
});

export type ChatSummaryImportantLink = z.infer<typeof ChatSummaryImportantLinkSchema>;

export const ChatSummaryWaitingOnItemSchema = z.object({
  title: z.string().min(1),
  owner: z.string().nullable(),
  dueDate: z.string().nullable(),
  status: z.enum(['waiting', 'done', 'blocked']),
  sourceMessageId: z.string(),
});

export type ChatSummaryWaitingOnItem = z.infer<typeof ChatSummaryWaitingOnItemSchema>;

export const ChatSummaryNoiseItemSchema = z.object({
  text: z.string().min(1),
  sourceMessageId: z.string(),
});

export type ChatSummaryNoiseItem = z.infer<typeof ChatSummaryNoiseItemSchema>;

export const ChatIntelligenceSummarySchema = z.object({
  summary: z.string(),
  decisions: z.array(ChatSummaryDecisionSchema),
  tasks: z.array(ChatSummaryTaskSchema),
  questionsForMe: z.array(ChatSummaryQuestionSchema),
  importantLinks: z.array(ChatSummaryImportantLinkSchema),
  waitingOn: z.array(ChatSummaryWaitingOnItemSchema),
  noise: z.array(ChatSummaryNoiseItemSchema),
  sourceMessageIds: z.array(z.string()),
  generatedAt: z.string(),
});

export type ChatIntelligenceSummary = z.infer<typeof ChatIntelligenceSummarySchema>;

export const SummarizeChatDTOSchema = z.object({
  messageLimit: z.number().int().min(20).max(500).optional(),
});

export type SummarizeChatDTO = z.infer<typeof SummarizeChatDTOSchema>;