import express, { type Express, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import axios from 'axios';
import { requestIdMiddleware, requestLogger, runReadinessChecks } from '@repo/utils';
import { serviceUrls } from './config.js';
import { sensitiveRateLimit } from './rate-limits.js';

const app: Express = express();

// Security middleware. Media files are fetched by the web app from the gateway
// origin, which is different from the Vite/web origin in local development.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'];
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// Rate limiting (relaxed for development)
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000, // Limit each IP to 1000 requests per minute (relaxed for dev)
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Body parsing
app.use(express.json());
app.use(requestIdMiddleware);
app.use(requestLogger('gateway'));
app.use(sensitiveRateLimit);

// Health check endpoint
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/readyz', async (_req: Request, res: Response) => {
  const essentials = ['auth', 'users', 'chats', 'messages', 'media', 'notifications'] as const;
  const readiness = await runReadinessChecks(
    essentials.map((service) => ({
      name: service,
      timeoutMs: 1000,
      check: () => axios.get(`${serviceUrls[service]}/healthz`, { timeout: 750 }).then(() => undefined),
    }))
  );

  res.status(readiness.ready ? 200 : 503).json({
    status: readiness.ready ? 'ready' : 'not_ready',
    service: 'gateway',
    checks: readiness.checks,
  });
});

// Import and use proxy routes
import proxyRouter from './routes/proxy.js';
app.use(proxyRouter);

export default app;
