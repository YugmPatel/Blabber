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
import { addMember, removeMember } from './routes/manage-members';
import { updateChat } from './routes/update-chat';
import { pinChat, unpinChat, archiveChat, unarchiveChat } from './routes/pin-archive';
import { requireChatAdmin } from './middleware/rbac';

app.post('/', authMiddleware, createChat);
app.get('/', authMiddleware, listChats);
app.get('/:id', authMiddleware, getChat);
app.patch('/:id', authMiddleware, requireChatAdmin, updateChat);
app.post('/:id/members', authMiddleware, requireChatAdmin, addMember);
app.delete('/:id/members/:userId', authMiddleware, requireChatAdmin, removeMember);
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
