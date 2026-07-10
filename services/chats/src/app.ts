import express, { Request, Response, Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { loadCommonConfig, loadCORSConfig, loadJWTConfig, structuredJsonParserOptions, structuredUrlEncodedParserOptions } from '@repo/config';
import {
  createAuthMiddleware,
  errorHandler,
  notFoundHandler,
  requestIdMiddleware,
  requestLogger,
  runReadinessChecks,
} from '@repo/utils';
import { getDatabase } from './db';

const app: Express = express();

// Load configuration
const commonConfig = loadCommonConfig();
const corsConfig = loadCORSConfig();
const jwtConfig = loadJWTConfig();

// Create auth middleware
const authMiddleware = createAuthMiddleware({
  secret: jwtConfig.JWT_ACCESS_SECRET,
});

// Security middleware
app.use(helmet());

// CORS middleware
app.use(
  cors({
    origin: corsConfig.origins,
    credentials: corsConfig.credentials,
  })
);

// Body parsing middleware
app.use(express.json(structuredJsonParserOptions()));
app.use(express.urlencoded(structuredUrlEncodedParserOptions()));

app.use(requestIdMiddleware);
app.use(requestLogger('chats'));

// Health check endpoint
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'chats',
    timestamp: new Date().toISOString(),
  });
});

app.get('/readyz', async (_req: Request, res: Response) => {
  const readiness = await runReadinessChecks([
    { name: 'mongo', check: () => getDatabase().command({ ping: 1 }).then(() => undefined) },
  ]);
  res.status(readiness.ready ? 200 : 503).json({
    status: readiness.ready ? 'ready' : 'not_ready',
    service: 'chats',
    checks: readiness.checks,
  });
});

// Chat routes
import { createChat } from './routes/create-chat';
import { listChats } from './routes/list-chats';
import { getChat } from './routes/get-chat';
import {
  addMember,
  deleteGroup,
  demoteMember,
  leaveGroup,
  promoteMember,
  removeMember,
  transferOwnership,
} from './routes/manage-members';
import { updateChat } from './routes/update-chat';
import { pinChat, unpinChat, archiveChat, unarchiveChat } from './routes/pin-archive';
import {
  createInviteLink,
  getInviteLinkSettings,
  joinInvite,
  previewInvite,
  regenerateInviteLink,
  revokeInviteLink,
} from './routes/invite-links';
import { requireChatAdmin, requireGroupParticipant } from './middleware/rbac';
import { summarizeChat } from './routes/summarize-chat';
import { getChatSummary } from './routes/get-chat-summary';
import {
  addChatActionUpdate,
  createChatAction,
  deleteChatAction,
  extractChatActions,
  getChatActions,
  getMyChatActions,
  updateChatAction,
} from './routes/chat-actions';
import {
  deleteChatDecision,
  extractChatDecisions,
  getChatDecisions,
  updateChatDecision,
} from './routes/chat-decisions';
import { askGroupBrain, getGroupBrain } from './routes/group-brain';
import {
  deleteWaitingOnItem,
  extractWaitingOnItems,
  getWaitingOnItems,
  updateWaitingOnItem,
} from './routes/waiting-on';
import {
  getIntelligenceAvailability,
  requireChatIntelligenceEnabled,
} from './middleware/user-settings';
import { clearMyAiHistory, updateGroupIntelligenceSettings } from './routes/group-intelligence-settings';
import { listCallHistory, recordCallEvent } from './routes/call-history';
import { createGroupCallToken, getActiveGroupCall } from './routes/group-call-token';
import {
  listModerationActivity,
  moderationRemoveMember,
  restrictMember,
  unrestrictMember,
  updateModerationSettings,
} from './routes/group-moderation';
import {
  createPlanProposal,
  finalizePlan,
  generatePlanDraft,
  getPlan,
  getPlanThisEligibility,
  listPlanDestinations,
  cancelPlan,
  respondToAssignment,
  updatePlan,
  votePlan,
} from './routes/plan-this';
import {
  askVeyra,
  getVeyraSettings,
  grantVeyraScope,
  listVeyraScopeCandidates,
  revokeVeyraScope,
  updateVeyraSettings,
} from './routes/veyra';

app.post('/', authMiddleware, createChat);
app.get('/', authMiddleware, listChats);
app.get('/intelligence/availability', authMiddleware, getIntelligenceAvailability);
app.delete('/intelligence/history/me', authMiddleware, clearMyAiHistory);
app.get('/plan-this/eligibility', authMiddleware, getPlanThisEligibility);
app.get('/plan-this/destinations', authMiddleware, listPlanDestinations);
app.post('/plan-this/draft', authMiddleware, generatePlanDraft);
app.post('/plan-this/plans', authMiddleware, createPlanProposal);
app.get('/plan-this/plans/:planId', authMiddleware, getPlan);
app.patch('/plan-this/plans/:planId', authMiddleware, updatePlan);
app.post('/plan-this/plans/:planId/vote', authMiddleware, votePlan);
app.post('/plan-this/plans/:planId/finalize', authMiddleware, finalizePlan);
app.post('/plan-this/plans/:planId/cancel', authMiddleware, cancelPlan);
app.post('/plan-this/plans/:planId/assignments/:assignmentId/respond', authMiddleware, respondToAssignment);
app.get('/veyra/settings', authMiddleware, getVeyraSettings);
app.patch('/veyra/settings', authMiddleware, updateVeyraSettings);
app.get('/veyra/scopes/candidates', authMiddleware, listVeyraScopeCandidates);
app.post('/veyra/scopes', authMiddleware, grantVeyraScope);
app.delete('/veyra/scopes/:scopeId', authMiddleware, revokeVeyraScope);
app.post('/veyra/ask', authMiddleware, askVeyra);
app.post('/intelligence/chats/:chatId/summarize', authMiddleware, requireChatIntelligenceEnabled, summarizeChat);
app.get('/intelligence/chats/:chatId/summary', authMiddleware, requireChatIntelligenceEnabled, getChatSummary);
app.post('/intelligence/chats/:chatId/actions/extract', authMiddleware, requireChatIntelligenceEnabled, extractChatActions);
app.post('/intelligence/chats/:chatId/actions', authMiddleware, requireChatIntelligenceEnabled, createChatAction);
app.get('/intelligence/chats/:chatId/actions', authMiddleware, requireChatIntelligenceEnabled, getChatActions);
app.get('/intelligence/actions/mine', authMiddleware, requireChatIntelligenceEnabled, getMyChatActions);
app.patch('/intelligence/actions/:actionId', authMiddleware, requireChatIntelligenceEnabled, updateChatAction);
app.post('/intelligence/actions/:actionId/updates', authMiddleware, requireChatIntelligenceEnabled, addChatActionUpdate);
app.delete('/intelligence/actions/:actionId', authMiddleware, requireChatIntelligenceEnabled, deleteChatAction);
app.post('/intelligence/chats/:chatId/decisions/extract', authMiddleware, requireChatIntelligenceEnabled, extractChatDecisions);
app.get('/intelligence/chats/:chatId/decisions', authMiddleware, requireChatIntelligenceEnabled, getChatDecisions);
app.patch('/intelligence/decisions/:decisionId', authMiddleware, requireChatIntelligenceEnabled, updateChatDecision);
app.delete('/intelligence/decisions/:decisionId', authMiddleware, requireChatIntelligenceEnabled, deleteChatDecision);
app.post('/intelligence/chats/:chatId/waiting-on/extract', authMiddleware, requireChatIntelligenceEnabled, extractWaitingOnItems);
app.get('/intelligence/chats/:chatId/waiting-on', authMiddleware, requireChatIntelligenceEnabled, getWaitingOnItems);
app.patch('/intelligence/waiting-on/:itemId', authMiddleware, requireChatIntelligenceEnabled, updateWaitingOnItem);
app.delete('/intelligence/waiting-on/:itemId', authMiddleware, requireChatIntelligenceEnabled, deleteWaitingOnItem);
app.get('/intelligence/chats/:chatId/brain', authMiddleware, requireChatIntelligenceEnabled, getGroupBrain);
app.post('/intelligence/chats/:chatId/brain/ask', authMiddleware, requireChatIntelligenceEnabled, askGroupBrain);
app.get('/calls', authMiddleware, listCallHistory);
app.post('/calls/events', authMiddleware, recordCallEvent);
app.get('/invites/:token/preview', authMiddleware, previewInvite);
app.post('/invites/:token/join', authMiddleware, joinInvite);
app.get('/:id/calls/active', authMiddleware, getActiveGroupCall);
app.post('/:id/calls/group-token', authMiddleware, createGroupCallToken);
app.get('/:id/invite-link', authMiddleware, getInviteLinkSettings);
app.post('/:id/invite-link', authMiddleware, createInviteLink);
app.post('/:id/invite-link/regenerate', authMiddleware, regenerateInviteLink);
app.post('/:id/invite-link/revoke', authMiddleware, revokeInviteLink);
app.patch('/:id/intelligence/settings', authMiddleware, requireChatAdmin, updateGroupIntelligenceSettings);
app.patch('/:id/moderation/settings', authMiddleware, updateModerationSettings);
app.post('/:id/moderation/members/:userId/restrict', authMiddleware, restrictMember);
app.delete('/:id/moderation/members/:userId/restrict', authMiddleware, unrestrictMember);
app.delete('/:id/moderation/members/:userId', authMiddleware, moderationRemoveMember);
app.get('/:id/moderation/activity', authMiddleware, listModerationActivity);
app.get('/:id', authMiddleware, getChat);
app.patch('/:id', authMiddleware, requireChatAdmin, updateChat);
app.post('/:id/members', authMiddleware, requireChatAdmin, addMember);
app.delete('/:id/members/:userId', authMiddleware, requireChatAdmin, removeMember);
app.post('/:id/admins', authMiddleware, requireChatAdmin, promoteMember);
app.delete('/:id/admins', authMiddleware, requireChatAdmin, demoteMember);
app.patch('/:id/owner', authMiddleware, requireChatAdmin, transferOwnership);
app.post('/:id/leave', authMiddleware, requireGroupParticipant, leaveGroup);
app.delete('/:id', authMiddleware, requireChatAdmin, deleteGroup);
app.post('/:id/pin', authMiddleware, pinChat);
app.post('/:id/unpin', authMiddleware, unpinChat);
app.post('/:id/archive', authMiddleware, archiveChat);
app.post('/:id/unarchive', authMiddleware, unarchiveChat);

// 404 handler
app.use(notFoundHandler);

// Error handling middleware
app.use(errorHandler('chats', commonConfig.NODE_ENV));

export default app;
