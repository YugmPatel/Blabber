import express, { Request, Response, NextFunction, Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { loadCommonConfig, loadCORSConfig } from '@repo/config';
import { logger, createAuthMiddleware } from '@repo/utils';

const app: Express = express();

// Load configuration
const commonConfig = loadCommonConfig();
const corsConfig = loadCORSConfig();
const jwtAccessSecret = process.env.JWT_ACCESS_SECRET;

if (!jwtAccessSecret || jwtAccessSecret.length < 32) {
  throw new Error('Invalid JWT_ACCESS_SECRET configuration');
}

const authMiddleware = createAuthMiddleware({
  secret: jwtAccessSecret,
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
    service: 'media',
    timestamp: new Date().toISOString(),
  });
});

// Media routes
import { getLocalMedia, presign, uploadLocalMedia } from './routes/presign';
import { linkPreview } from './routes/link-preview';
app.post('/presign', authMiddleware, presign);
app.put('/local/:id', authMiddleware, express.raw({ type: '*/*', limit: '50mb' }), uploadLocalMedia);
app.get('/local/:id', getLocalMedia);
app.get('/link-preview', linkPreview);

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
