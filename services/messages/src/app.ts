import express, { Request, Response, Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { loadCommonConfig, loadCORSConfig, loadJWTConfig } from '@repo/config';
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
    credentials: true,
  })
);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(requestIdMiddleware);
app.use(requestLogger('messages'));

// Health check endpoint
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'messages',
    timestamp: new Date().toISOString(),
  });
});

app.get('/readyz', async (_req: Request, res: Response) => {
  const readiness = await runReadinessChecks([
    { name: 'mongo', check: () => getDatabase().command({ ping: 1 }).then(() => undefined) },
  ]);
  res.status(readiness.ready ? 200 : 503).json({
    status: readiness.ready ? 'ready' : 'not_ready',
    service: 'messages',
    checks: readiness.checks,
  });
});

// Message routes
import { getMessages } from './routes/get-messages';
import { sendMessage } from './routes/send-message';
import { editMessage } from './routes/edit-message';
import { deleteMessage } from './routes/delete-message';
import { reactToMessage } from './routes/react-message';
import { markMessagesAsRead } from './routes/mark-read';
import { votePoll } from './routes/vote-poll';
import { getMessageWindow } from './routes/get-message-window';
import { searchMessages, searchMessagesGlobal } from './routes/search-messages';
import { forwardMessage } from './routes/forward-message';
import { listPins, pinMessage, unpinMessage } from './routes/message-pins';
import { listSavedMessages, saveMessage, unsaveMessage } from './routes/saved-messages';
import { listSharedContent } from './routes/shared-content';
import { closePoll } from './routes/poll-actions';
import { cancelEvent, exportEventIcs, rsvpEvent, updateEvent } from './routes/event-actions';
// Note: Specific routes must come before parameterized routes
app.post('/read', authMiddleware, markMessagesAsRead);
app.post('/:messageId/read', authMiddleware, markMessagesAsRead);
app.get('/source/:messageId/window', authMiddleware, getMessageWindow);
app.get('/search/global', authMiddleware, searchMessagesGlobal);
app.get('/search', authMiddleware, searchMessages);
app.get('/shared', authMiddleware, listSharedContent);
app.get('/saved', authMiddleware, listSavedMessages);
app.get('/pins/:chatId', authMiddleware, listPins);
app.post('/:messageId/forward', authMiddleware, forwardMessage);
app.post('/:messageId/pin', authMiddleware, pinMessage);
app.delete('/:messageId/pin', authMiddleware, unpinMessage);
app.post('/:messageId/save', authMiddleware, saveMessage);
app.delete('/:messageId/save', authMiddleware, unsaveMessage);
app.post('/:messageId/poll/close', authMiddleware, closePoll);
app.post('/:messageId/event/rsvp', authMiddleware, rsvpEvent);
app.patch('/:messageId/event', authMiddleware, updateEvent);
app.post('/:messageId/event/cancel', authMiddleware, cancelEvent);
app.get('/:messageId/event.ics', authMiddleware, exportEventIcs);
app.get('/:chatId', authMiddleware, getMessages);
app.post('/:chatId', authMiddleware, sendMessage);
app.patch('/:messageId', authMiddleware, editMessage);
app.delete('/:messageId', authMiddleware, deleteMessage);
app.post('/:messageId/react', authMiddleware, reactToMessage);
app.post('/:messageId/poll/vote', authMiddleware, votePoll);

// 404 handler
app.use(notFoundHandler);

// Error handling middleware
app.use(errorHandler('messages', commonConfig.NODE_ENV));

export default app;
