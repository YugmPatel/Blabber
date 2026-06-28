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
import { pushOperationalStatus } from './push-ops';

const app: Express = express();

// Load configuration
const commonConfig = loadCommonConfig();
const corsConfig = loadCORSConfig();
const jwtAccessSecret = process.env.JWT_ACCESS_SECRET;
if (!jwtAccessSecret || jwtAccessSecret.length < 32) {
  throw new Error('JWT_ACCESS_SECRET is required for notification preferences');
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

app.use(requestIdMiddleware);
app.use(requestLogger('notifications'));

// Health check endpoint
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'notifications',
    timestamp: new Date().toISOString(),
  });
});

app.get('/readyz', async (_req: Request, res: Response) => {
  const readiness = await runReadinessChecks([
    { name: 'mongo', check: () => getDatabase().command({ ping: 1 }).then(() => undefined) },
    { name: 'push_config', check: () => {
      const status = pushOperationalStatus();
      if (status.enabled && !status.mockMode && !status.configured) throw new Error('push_not_configured');
      return Promise.resolve();
    } },
  ]);
  res.status(readiness.ready ? 200 : 503).json({
    status: readiness.ready ? 'ready' : 'not_ready',
    service: 'notifications',
    checks: readiness.checks,
  });
});

// Push notification routes
import { subscribe } from './routes/subscribe';
import { unsubscribe } from './routes/unsubscribe';
import { send } from './routes/send';
import { getPreferences, getVapidPublicKey, updatePreferences } from './routes/preferences';
app.get('/ops/push', (_req: Request, res: Response) => {
  const expected = process.env.OPS_DIAGNOSTIC_TOKEN;
  const provided = _req.get('x-ops-token');
  if (!expected || provided !== expected) {
    return res.status(404).json({ error: 'Not Found', message: 'Not found' });
  }
  return res.status(200).json(pushOperationalStatus());
});
app.post('/push/subscribe', subscribe);
app.post('/push/unsubscribe', unsubscribe);
app.get('/push/vapid-public-key', getVapidPublicKey);
app.get('/preferences/:userId', authMiddleware, getPreferences);
app.patch('/preferences/:userId', authMiddleware, updatePreferences);
app.post('/send', send);

// 404 handler
app.use(notFoundHandler);

// Error handling middleware
app.use(errorHandler('notifications', commonConfig.NODE_ENV));

export default app;
