import express, { Request, Response, Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { loadCommonConfig, loadCORSConfig } from '@repo/config';
import {
  createAuthMiddleware,
  errorHandler,
  notFoundHandler,
  requestIdMiddleware,
  requestLogger,
  runReadinessChecks,
} from '@repo/utils';
import { getDatabase } from './db';
import { connectToRedis } from './redis';

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

// Security middleware. Local media is intentionally served to the web app from a
// different localhost origin during development.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

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
app.use(requestLogger('media'));

// Health check endpoint
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'media',
    timestamp: new Date().toISOString(),
  });
});

app.get('/readyz', async (_req: Request, res: Response) => {
  const readiness = await runReadinessChecks([
    { name: 'mongo', check: () => getDatabase().command({ ping: 1 }).then(() => undefined) },
    { name: 'redis', check: () => connectToRedis().ping().then(() => undefined) },
  ]);
  res.status(readiness.ready ? 200 : 503).json({
    status: readiness.ready ? 'ready' : 'not_ready',
    service: 'media',
    checks: readiness.checks,
  });
});

// Media routes
import { getLocalMedia, presign, uploadLocalMedia, uploadMultipartMedia } from './routes/presign';
import { linkPreview } from './routes/link-preview';
app.post('/presign', authMiddleware, presign);
app.post('/upload', authMiddleware, express.raw({ type: 'multipart/form-data', limit: '50mb' }), uploadMultipartMedia);
app.put('/local/:id', authMiddleware, express.raw({ type: '*/*', limit: '50mb' }), uploadLocalMedia);
app.get('/local/:id', getLocalMedia);
app.get('/link-preview', linkPreview);

// 404 handler
app.use(notFoundHandler);

// Error handling middleware
app.use(errorHandler('media', commonConfig.NODE_ENV));

export default app;
