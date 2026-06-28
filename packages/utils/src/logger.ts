import pino from 'pino';

const isDevelopment = process.env.NODE_ENV === 'development';
const logLevel = process.env.LOG_LEVEL || 'info';

export const logger = pino({
  level: logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'headers.authorization',
      'authorization',
      'accessToken',
      'refreshToken',
      'token',
      'password',
      'resetToken',
      'verificationToken',
      'emailVerificationToken',
      'emailChangeToken',
      'deletionToken',
      'downloadToken',
      'cancelToken',
      'cancelTokenHash',
      'tokenHash',
      'inviteToken',
      'inviteUrl',
      'rawInviteUrl',
      'verificationUrl',
      'emailChangeUrl',
      'deletionCancelUrl',
      'downloadUrl',
      'subscription.endpoint',
      'pushEndpoint',
      'endpoint',
      'body',
      'message.body',
      'message.text',
      'sourceText',
      'privateActionData',
      'aiData',
      'messageBody',
      'prompt',
      'context',
    ],
    censor: '[redacted]',
  },
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export default logger;
