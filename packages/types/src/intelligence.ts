import { z } from 'zod';

export const SourceReferenceSchema = z.object({
  messageId: z.string(),
  chatId: z.string(),
  senderId: z.string(),
  senderDisplayName: z.string(),
  createdAt: z.string(),
  snippet: z.string(),
  label: z.string().optional(),
  relevance: z.number().min(0).max(1).optional(),
});

export type SourceReference = z.infer<typeof SourceReferenceSchema>;

export const ChatSummaryDecisionSchema = z.object({
  title: z.string().min(1),
  status: z.enum(['proposed', 'final', 'reverted']),
  sourceMessageIds: z.array(z.string()),
  sources: z.array(SourceReferenceSchema).optional(),
});

export type ChatSummaryDecision = z.infer<typeof ChatSummaryDecisionSchema>;

export const ChatSummaryTaskSchema = z.object({
  title: z.string().min(1),
  assignedTo: z.string().nullable(),
  assignedToUserId: z.string().nullable().optional(),
  dueDate: z.string().nullable(),
  status: z.enum(['pending', 'in_progress', 'done', 'blocked']),
  sourceMessageId: z.string(),
  sources: z.array(SourceReferenceSchema).optional(),
});

export type ChatSummaryTask = z.infer<typeof ChatSummaryTaskSchema>;

export const ChatSummaryQuestionSchema = z.object({
  question: z.string().min(1),
  sourceMessageId: z.string(),
  sources: z.array(SourceReferenceSchema).optional(),
});

export type ChatSummaryQuestion = z.infer<typeof ChatSummaryQuestionSchema>;

export const ChatSummaryImportantLinkSchema = z.object({
  url: z.string().url(),
  label: z.string().nullable(),
  sourceMessageId: z.string(),
  sources: z.array(SourceReferenceSchema).optional(),
});

export type ChatSummaryImportantLink = z.infer<typeof ChatSummaryImportantLinkSchema>;

export const ChatSummaryWaitingOnItemSchema = z.object({
  title: z.string().min(1),
  owner: z.string().nullable(),
  dueDate: z.string().nullable(),
  status: z.enum(['waiting', 'done', 'blocked']),
  sourceMessageId: z.string(),
  sources: z.array(SourceReferenceSchema).optional(),
});

export type ChatSummaryWaitingOnItem = z.infer<typeof ChatSummaryWaitingOnItemSchema>;

export const ChatSummaryNoiseItemSchema = z.object({
  text: z.string().min(1),
  sourceMessageId: z.string(),
  sources: z.array(SourceReferenceSchema).optional(),
});

export type ChatSummaryNoiseItem = z.infer<typeof ChatSummaryNoiseItemSchema>;

export const ChatIntelligenceSummarySchema = z.object({
  summary: z.string(),
  overview: z.string().optional(),
  scope: z.object({
    label: z.string(),
    messageCount: z.number().int().nonnegative(),
    since: z.string().optional(),
    mode: z.enum(['unread', 'recent', 'custom']).optional(),
  }).optional(),
  decisions: z.array(ChatSummaryDecisionSchema),
  tasks: z.array(ChatSummaryTaskSchema),
  questionsForMe: z.array(ChatSummaryQuestionSchema),
  importantLinks: z.array(ChatSummaryImportantLinkSchema),
  waitingOn: z.array(ChatSummaryWaitingOnItemSchema),
  noise: z.array(ChatSummaryNoiseItemSchema),
  sourceMessageIds: z.array(z.string()),
  sources: z.array(SourceReferenceSchema).optional(),
  generatedAt: z.string(),
});

export type ChatIntelligenceSummary = z.infer<typeof ChatIntelligenceSummarySchema>;

export const SummarizeChatDTOSchema = z.object({
  messageLimit: z.number().int().min(20).max(500).optional(),
});

export type SummarizeChatDTO = z.infer<typeof SummarizeChatDTOSchema>;

export const ChatActionTypeSchema = z.enum([
  'task',
  'event',
  'reminder',
  'request',
  'follow_up',
  'promise',
]);

export type ChatActionType = z.infer<typeof ChatActionTypeSchema>;

export const ChatActionStatusSchema = z.enum([
  'open',
  'in_progress',
  'completed',
  // Legacy statuses are accepted for backward-compatible reads.
  'pending',
  'accepted',
  'dismissed',
]);

export type ChatActionStatus = z.infer<typeof ChatActionStatusSchema>;

export const ChatActionPrioritySchema = z.enum(['low', 'medium', 'high']);

export type ChatActionPriority = z.infer<typeof ChatActionPrioritySchema>;

export const ChatActionVisibilitySchema = z.enum(['chat', 'personal']);

export type ChatActionVisibility = z.infer<typeof ChatActionVisibilitySchema>;

export const ChatActionPersonSchema = z.object({
  userId: z.string().optional(),
  name: z.string().optional(),
});

export type ChatActionPerson = z.infer<typeof ChatActionPersonSchema>;

export const ChatActionUpdateSchema = z.object({
  id: z.string(),
  body: z.string().min(1),
  author: ChatActionPersonSchema,
  createdAt: z.string(),
});

export type ChatActionUpdate = z.infer<typeof ChatActionUpdateSchema>;

export const ChatActionActivitySchema = z.object({
  id: z.string(),
  type: z.enum(['created', 'edited', 'status_changed', 'commented', 'completed', 'reopened']),
  actor: ChatActionPersonSchema,
  message: z.string(),
  createdAt: z.string(),
});

export type ChatActionActivity = z.infer<typeof ChatActionActivitySchema>;

export const ChatActionItemSchema = z.object({
  id: z.string().optional(),
  chatId: z.string(),
  type: ChatActionTypeSchema,
  title: z.string().min(1),
  description: z.string().optional(),
  assignedTo: ChatActionPersonSchema.optional(),
  createdBy: ChatActionPersonSchema.optional(),
  dueDate: z.string().optional(),
  dueAt: z.string().optional(),
  eventStart: z.string().optional(),
  eventEnd: z.string().optional(),
  status: ChatActionStatusSchema,
  priority: ChatActionPrioritySchema.optional(),
  visibility: ChatActionVisibilitySchema.optional(),
  personalOwnerUserId: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  sourceMessageIds: z.array(z.string()).default([]),
  sourceText: z.string().optional(),
  sources: z.array(SourceReferenceSchema).optional(),
  updates: z.array(ChatActionUpdateSchema).optional(),
  activity: z.array(ChatActionActivitySchema).optional(),
  completedAt: z.string().optional(),
  completedBy: ChatActionPersonSchema.optional(),
  lastActivityAt: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  permissions: z.object({
    canUpdateStatus: z.boolean().optional(),
    canEdit: z.boolean().optional(),
    canDelete: z.boolean().optional(),
  }).optional(),
  deletedAt: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ChatActionItem = z.infer<typeof ChatActionItemSchema>;

export const ChatActionExtractionResultSchema = z.object({
  chatId: z.string(),
  summary: z.string().optional(),
  actions: z.array(ChatActionItemSchema),
  generatedAt: z.string(),
  sourceMessageIds: z.array(z.string()),
});

export type ChatActionExtractionResult = z.infer<typeof ChatActionExtractionResultSchema>;

export const ExtractChatActionsDTOSchema = z.object({
  messageLimit: z.number().int().min(1).max(500).optional(),
});

export type ExtractChatActionsDTO = z.infer<typeof ExtractChatActionsDTOSchema>;

export const UpdateChatActionDTOSchema = z.object({
  title: z.string().min(1).max(240).optional(),
  description: z.string().max(1000).optional(),
  ownerUserId: z.string().optional(),
  ownerName: z.string().optional(),
  dueDate: z.string().optional(),
  dueAt: z.string().optional(),
  status: z.enum(['open', 'in_progress', 'completed']).optional(),
});

export type UpdateChatActionDTO = z.infer<typeof UpdateChatActionDTOSchema>;

export const CreateChatActionDTOSchema = z.object({
  title: z.string().min(1).max(240),
  description: z.string().max(1000).optional(),
  ownerUserId: z.string().optional(),
  ownerName: z.string().optional(),
  dueDate: z.string().optional(),
  dueAt: z.string().optional(),
  sourceMessageIds: z.array(z.string()).default([]),
  sourceText: z.string().optional(),
});

export type CreateChatActionDTO = z.infer<typeof CreateChatActionDTOSchema>;

export const AddChatActionUpdateDTOSchema = z.object({
  body: z.string().min(1).max(1000),
});

export type AddChatActionUpdateDTO = z.infer<typeof AddChatActionUpdateDTOSchema>;

export const DeleteChatActionDTOSchema = z.object({
  reason: z.string().max(240).optional(),
});

export type DeleteChatActionDTO = z.infer<typeof DeleteChatActionDTOSchema>;

export const GroupBrainAnswerSchema = z.object({
  question: z.string().optional(),
  answer: z.string(),
  answerState: z.enum(['grounded', 'insufficient_evidence', 'conflicting_evidence']).optional(),
  answerCategory: z.enum([
    'decision',
    'ownership',
    'pending',
    'link',
    'change_summary',
    'factual_lookup',
    'unknown',
  ]).optional(),
  confidence: z.enum(['grounded', 'uncertain']),
  sourceMessageIds: z.array(z.string()),
  sources: z.array(SourceReferenceSchema).optional(),
  sourceDates: z.array(z.string()).optional(),
  relevantDateRange: z.object({
    start: z.string().optional(),
    end: z.string().optional(),
    label: z.string().optional(),
  }).optional(),
  caveat: z.string().optional(),
});

export type GroupBrainAnswer = z.infer<typeof GroupBrainAnswerSchema>;

export const ChatDecisionStatusSchema = z.enum(['proposed', 'final', 'changed', 'dismissed']);

export type ChatDecisionStatus = z.infer<typeof ChatDecisionStatusSchema>;

export const ChatDecisionCategorySchema = z.enum([
  'planning',
  'technical',
  'financial',
  'social',
  'logistics',
  'other',
]);

export type ChatDecisionCategory = z.infer<typeof ChatDecisionCategorySchema>;

export const ChatDecisionPersonSchema = z.object({
  userId: z.string().optional(),
  name: z.string().optional(),
});

export type ChatDecisionPerson = z.infer<typeof ChatDecisionPersonSchema>;

export const ChatDecisionSchema = z.object({
  id: z.string().optional(),
  chatId: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  status: ChatDecisionStatusSchema,
  decidedBy: z.array(ChatDecisionPersonSchema).optional(),
  decidedAt: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  sourceMessageIds: z.array(z.string()).min(1),
  sourceText: z.string().optional(),
  sources: z.array(SourceReferenceSchema).optional(),
  relatedActionIds: z.array(z.string()).optional(),
  category: ChatDecisionCategorySchema.optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ChatDecision = z.infer<typeof ChatDecisionSchema>;

export const DecisionExtractionResultSchema = z.object({
  chatId: z.string(),
  summary: z.string().optional(),
  decisions: z.array(ChatDecisionSchema),
  generatedAt: z.string(),
  sourceMessageIds: z.array(z.string()),
});

export type DecisionExtractionResult = z.infer<typeof DecisionExtractionResultSchema>;

export const ExtractChatDecisionsDTOSchema = z.object({
  messageLimit: z.number().int().min(1).max(500).optional(),
});

export type ExtractChatDecisionsDTO = z.infer<typeof ExtractChatDecisionsDTOSchema>;

export const UpdateChatDecisionDTOSchema = z.object({
  status: ChatDecisionStatusSchema.optional(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
});

export type UpdateChatDecisionDTO = z.infer<typeof UpdateChatDecisionDTOSchema>;

export const WaitingOnDirectionSchema = z.enum(['waiting_on_them', 'waiting_on_me']);

export type WaitingOnDirection = z.infer<typeof WaitingOnDirectionSchema>;

export const WaitingOnStatusSchema = z.enum(['open', 'resolved', 'dismissed']);

export type WaitingOnStatus = z.infer<typeof WaitingOnStatusSchema>;

export const WaitingOnPersonSchema = z.object({
  userId: z.string().optional(),
  name: z.string().optional(),
});

export type WaitingOnPerson = z.infer<typeof WaitingOnPersonSchema>;

export const WaitingOnItemSchema = z.object({
  id: z.string().optional(),
  chatId: z.string(),
  direction: WaitingOnDirectionSchema,
  title: z.string().min(1),
  description: z.string().optional(),
  person: WaitingOnPersonSchema.optional(),
  requester: WaitingOnPersonSchema.optional(),
  owner: WaitingOnPersonSchema.optional(),
  status: WaitingOnStatusSchema,
  priority: ChatActionPrioritySchema.optional(),
  dueDate: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  sourceMessageIds: z.array(z.string()).min(1),
  sourceText: z.string().optional(),
  sources: z.array(SourceReferenceSchema).optional(),
  relatedActionIds: z.array(z.string()).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type WaitingOnItem = z.infer<typeof WaitingOnItemSchema>;

export const WaitingOnExtractionResultSchema = z.object({
  chatId: z.string(),
  summary: z.string().optional(),
  waitingOn: z.array(WaitingOnItemSchema),
  generatedAt: z.string(),
  sourceMessageIds: z.array(z.string()),
});

export type WaitingOnExtractionResult = z.infer<typeof WaitingOnExtractionResultSchema>;

export const ExtractWaitingOnDTOSchema = z.object({
  messageLimit: z.number().int().min(1).max(500).optional(),
});

export type ExtractWaitingOnDTO = z.infer<typeof ExtractWaitingOnDTOSchema>;

export const UpdateWaitingOnDTOSchema = z.object({
  status: WaitingOnStatusSchema.optional(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: ChatActionPrioritySchema.optional(),
  dueDate: z.string().optional(),
});

export type UpdateWaitingOnDTO = z.infer<typeof UpdateWaitingOnDTOSchema>;

export const GroupBrainLinkSchema = z.object({
  title: z.string().optional(),
  url: z.string().url(),
  sourceMessageId: z.string().optional(),
  sources: z.array(SourceReferenceSchema).optional(),
  addedAt: z.string().optional(),
});

export type GroupBrainLink = z.infer<typeof GroupBrainLinkSchema>;

export const GroupBrainFileSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  url: z.string().optional(),
  type: z.string().optional(),
  sourceMessageId: z.string().optional(),
  sources: z.array(SourceReferenceSchema).optional(),
  addedAt: z.string().optional(),
});

export type GroupBrainFile = z.infer<typeof GroupBrainFileSchema>;

export const GroupBrainQuestionSchema = z.object({
  text: z.string().min(1),
  askedBy: z.string().optional(),
  sourceMessageId: z.string().optional(),
  sources: z.array(SourceReferenceSchema).optional(),
  status: z.enum(['open', 'answered', 'dismissed']).optional(),
});

export type GroupBrainQuestion = z.infer<typeof GroupBrainQuestionSchema>;

export const GroupBrainPlanSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  date: z.string().optional(),
  sourceMessageIds: z.array(z.string()).optional(),
  sources: z.array(SourceReferenceSchema).optional(),
});

export type GroupBrainPlan = z.infer<typeof GroupBrainPlanSchema>;

export const GroupBrainDeadlineSchema = z.object({
  title: z.string().min(1),
  dueDate: z.string().optional(),
  relatedActionId: z.string().optional(),
  sourceMessageIds: z.array(z.string()).optional(),
  sources: z.array(SourceReferenceSchema).optional(),
});

export type GroupBrainDeadline = z.infer<typeof GroupBrainDeadlineSchema>;

export const GroupBrainParticipantSchema = z.object({
  userId: z.string(),
  name: z.string().optional(),
  username: z.string().optional(),
  avatarUrl: z.string().optional(),
});

export type GroupBrainParticipant = z.infer<typeof GroupBrainParticipantSchema>;

export const GroupBrainSchema = z.object({
  chatId: z.string(),
  overview: z.string().optional(),
  summary: z.object({
    id: z.string().optional(),
    text: z.string().optional(),
    generatedAt: z.string().optional(),
    sources: z.array(SourceReferenceSchema).optional(),
  }).optional(),
  decisions: z.array(ChatDecisionSchema),
  actions: z.array(ChatActionItemSchema),
  waitingOn: z.array(WaitingOnItemSchema),
  importantLinks: z.array(GroupBrainLinkSchema),
  importantFiles: z.array(GroupBrainFileSchema),
  openQuestions: z.array(GroupBrainQuestionSchema),
  plans: z.array(GroupBrainPlanSchema),
  deadlines: z.array(GroupBrainDeadlineSchema),
  participants: z.array(GroupBrainParticipantSchema).optional(),
  stats: z.object({
    pendingActions: z.number().int().nonnegative(),
    finalDecisions: z.number().int().nonnegative(),
    openQuestions: z.number().int().nonnegative(),
    openLoops: z.number().int().nonnegative(),
    links: z.number().int().nonnegative(),
    files: z.number().int().nonnegative(),
  }).optional(),
  sourceSummaryId: z.string().optional(),
  sourceActionIds: z.array(z.string()).optional(),
  sourceDecisionIds: z.array(z.string()).optional(),
  sourceWaitingOnIds: z.array(z.string()).optional(),
  lastUpdatedAt: z.string(),
});

export type GroupBrain = z.infer<typeof GroupBrainSchema>;
