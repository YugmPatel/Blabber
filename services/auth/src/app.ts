import express, { Request, Response, Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
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
import { emailOperationalStatus } from './utils/email';

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
app.use(cookieParser());

app.use(requestIdMiddleware);
app.use(requestLogger('auth'));

// Health check endpoint
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'auth',
    timestamp: new Date().toISOString(),
  });
});

app.get('/readyz', async (_req: Request, res: Response) => {
  const readiness = await runReadinessChecks([
    { name: 'mongo', check: () => getDatabase().command({ ping: 1 }).then(() => undefined) },
    { name: 'email_config', check: () => {
      const status = emailOperationalStatus();
      if (status.enabled && !status.captureEnabled && !status.configured) throw new Error('email_not_configured');
      return Promise.resolve();
    } },
  ]);
  res.status(readiness.ready ? 200 : 503).json({
    status: readiness.ready ? 'ready' : 'not_ready',
    service: 'auth',
    checks: readiness.checks,
  });
});

// Auth routes
import { register } from './routes/register';
import { login } from './routes/login';
import { refresh } from './routes/refresh';
import { logout } from './routes/logout';
import { mobileLogin, mobileLogout, mobileRefresh, mobileRegister, mobileSession } from './routes/mobile';
import { passwordForgot } from './routes/password-forgot';
import { passwordReset } from './routes/password-reset';
import { getMe } from './routes/me';
import { googleStart, googleCallback } from './routes/google-oauth';
import {
  cancelAccountDeletion,
  confirmEmailChange,
  confirmVerification,
  downloadDataExport,
  getAccountDeletion,
  getAccountStatus,
  getCapturedMailbox,
  listDataExports,
  listSessions,
  logoutOtherSessions,
  requestAccountDeletion,
  requestDataExport,
  requestEmailChange,
  resendVerification,
  revokeSession,
  runDeletionWorker,
} from './routes/account';
app.post('/register', register);
app.post('/login', login);
app.post('/refresh', refresh);
app.post('/logout', logout);
app.post('/mobile/register', mobileRegister);
app.post('/mobile/login', mobileLogin);
app.post('/mobile/refresh', mobileRefresh);
app.post('/mobile/logout', mobileLogout);
app.get('/mobile/session', authMiddleware, mobileSession);
app.post('/password/forgot', passwordForgot);
app.post('/password/reset', passwordReset);
app.get('/google/start', googleStart);
app.get('/google/callback', googleCallback);
app.get('/me', authMiddleware, getMe);
app.get('/account/status', authMiddleware, getAccountStatus);
app.post('/account/email/verification/resend', authMiddleware, resendVerification);
app.post('/account/email/verification/confirm', confirmVerification);
app.post('/account/email/change/request', authMiddleware, requestEmailChange);
app.post('/account/email/change/confirm', confirmEmailChange);
app.get('/account/sessions', authMiddleware, listSessions);
app.delete('/account/sessions/:sessionId', authMiddleware, revokeSession);
app.post('/account/sessions/logout-others', authMiddleware, logoutOtherSessions);
app.post('/account/export', authMiddleware, requestDataExport);
app.get('/account/export', authMiddleware, listDataExports);
app.get('/account/export/:exportId/download', authMiddleware, downloadDataExport);
app.get('/account/deletion', authMiddleware, getAccountDeletion);
app.post('/account/deletion', authMiddleware, requestAccountDeletion);
app.post('/account/deletion/cancel', cancelAccountDeletion);
app.post('/account/deletion/worker/run', authMiddleware, runDeletionWorker);
app.get('/account/dev/mailbox', authMiddleware, getCapturedMailbox);

// 404 handler
app.use(notFoundHandler);

// Error handling middleware
app.use(errorHandler('auth', commonConfig.NODE_ENV));

export default app;
