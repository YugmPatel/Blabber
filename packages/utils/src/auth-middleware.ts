import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UnauthorizedError } from './errors';

export interface JWTPayload {
  userId: string;
  username: string;
  email: string;
  iat?: number;
  exp?: number;
}

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

export interface AuthMiddlewareOptions {
  secret: string;
  algorithms?: jwt.Algorithm[];
}

/**
 * Middleware to verify JWT access token from Authorization header
 */
export const createAuthMiddleware = (options: AuthMiddlewareOptions) => {
  const { secret, algorithms = ['HS256'] } = options;

  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      // Extract token from Authorization header
      const authHeader = req.headers.authorization;

      if (!authHeader) {
        throw new UnauthorizedError('No authorization header provided');
      }

      const parts = authHeader.split(' ');

      if (parts.length !== 2 || parts[0] !== 'Bearer') {
        throw new UnauthorizedError('Invalid authorization header format');
      }

      const token = parts[1];

      // Verify token
      const decoded = jwt.verify(token, secret, { algorithms }) as JWTPayload;

      // Attach user to request
      req.user = decoded;

      next();
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        next(new UnauthorizedError('Invalid token'));
      } else if (error instanceof jwt.TokenExpiredError) {
        next(new UnauthorizedError('Token expired'));
      } else {
        next(error);
      }
    }
  };
};

/**
 * Optional auth middleware - doesn't throw if no token provided
 */
export const createOptionalAuthMiddleware = (options: AuthMiddlewareOptions) => {
  const { secret, algorithms = ['HS256'] } = options;

  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader) {
        return next();
      }

      const parts = authHeader.split(' ');

      if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return next();
      }

      const token = parts[1];
      const decoded = jwt.verify(token, secret, { algorithms }) as JWTPayload;
      req.user = decoded;

      next();
    } catch (error) {
      // Silently fail for optional auth
      next();
    }
  };
};

export default createAuthMiddleware;
