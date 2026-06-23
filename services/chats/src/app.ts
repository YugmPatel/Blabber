import express, { Request, Response, NextFunction, Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { loadCommonConfig, loadCORSConfig, loadJWTConfig } from '@repo/config';
import { logger, createAuthMiddleware } from '@repo/utils';

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
    credentials: true,
  })
);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info(
    {
      method: req.method,
      path: req.path,
      ip: req.ip,
    },
    'Incoming request'
  );
  next();
});

// Health check endpoint
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'chats',
    timestamp: new Date().toISOString(),
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
import { requireChatAdmin, requireGroupParticipant } from './middleware/rbac';
import { summarizeChat } from './routes/summarize-chat';
import { getChatSummary } from './routes/get-chat-summary';
import { createChatAction, extractChatActions, getChatActions, getMyChatActions, updateChatAction } from './routes/chat-actions';
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
import { listCallHistory, recordCallEvent } from './routes/call-history';
import { createGroupCallToken } from './routes/group-call-token';

app.post('/', authMiddleware, createChat);
app.get('/', authMiddleware, listChats);
app.get('/intelligence/availability', authMiddleware, getIntelligenceAvailability);
app.post('/intelligence/chats/:chatId/summarize', authMiddleware, requireChatIntelligenceEnabled, summarizeChat);
app.get('/intelligence/chats/:chatId/summary', authMiddleware, requireChatIntelligenceEnabled, getChatSummary);
app.post('/intelligence/chats/:chatId/actions/extract', authMiddleware, requireChatIntelligenceEnabled, extractChatActions);
app.post('/intelligence/chats/:chatId/actions', authMiddleware, requireChatIntelligenceEnabled, createChatAction);
app.get('/intelligence/chats/:chatId/actions', authMiddleware, requireChatIntelligenceEnabled, getChatActions);
app.get('/intelligence/actions/mine', authMiddleware, requireChatIntelligenceEnabled, getMyChatActions);
app.patch('/intelligence/actions/:actionId', authMiddleware, requireChatIntelligenceEnabled, updateChatAction);
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
app.post('/:id/calls/group-token', authMiddleware, createGroupCallToken);
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
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// Error handling middleware
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  logger.error(
    {
      error: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
      statusCode: err.statusCode,
    },
    'Error occurred'
  );

  // Handle AppError instances
  if (err.statusCode) {
    return res.status(err.statusCode).json({
      error: err.name || 'Error',
      message: err.message,
      code: err.code,
    });
  }

  // Handle unknown errors
  return res.status(500).json({
    error: 'Internal Server Error',
    message: commonConfig.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred',
  });
});

export default app;
