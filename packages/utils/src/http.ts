import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { AppError } from './errors';
import { logger } from './logger';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id') || req.header('x-correlation-id');
  req.requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}

export function requestLogger(service: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      logger.info(
        {
          service,
          requestId: req.requestId,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
        },
        'HTTP request completed'
      );
    });
    next();
  };
}

export function errorHandler(service: string, nodeEnv = process.env.NODE_ENV || 'development') {
  return (err: Error & Partial<AppError>, req: Request, res: Response, _next: NextFunction) => {
    const statusCode = typeof err.statusCode === 'number' ? err.statusCode : 500;
    const isOperational = Boolean(err.isOperational || err.statusCode);
    const code = err.code || (statusCode === 500 ? 'INTERNAL_ERROR' : 'ERROR');
    const message =
      statusCode === 500 && nodeEnv !== 'development'
        ? 'An unexpected error occurred'
        : err.message || 'An unexpected error occurred';

    logger.error(
      {
        service,
        requestId: req.requestId,
        error: err.message,
        errorName: err.name,
        code,
        statusCode,
        method: req.method,
        path: req.path,
        stack: nodeEnv === 'production' ? undefined : err.stack,
      },
      isOperational ? 'Handled request error' : 'Unhandled request error'
    );

    return res.status(statusCode).json({
      error: statusCode === 500 ? 'Internal Server Error' : err.name || 'Error',
      message,
      code,
      requestId: req.requestId,
    });
  };
}

export function notFoundHandler(req: Request, res: Response) {
  return res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
    code: 'NOT_FOUND',
    requestId: req.requestId,
  });
}
