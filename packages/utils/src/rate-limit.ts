import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';
import { AppError } from './errors';

export interface RateLimitOptions {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  keyPrefix?: string; // Redis key prefix
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

export class RateLimiter {
  private redis: Redis;
  private options: Required<RateLimitOptions>;

  constructor(redis: Redis, options: RateLimitOptions) {
    this.redis = redis;
    this.options = {
      keyPrefix: 'ratelimit',
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
      ...options,
    };
  }

  middleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const identifier = this.getIdentifier(req);
        const key = `${this.options.keyPrefix}:${identifier}`;
        const windowSeconds = Math.ceil(this.options.windowMs / 1000);

        // Increment counter
        const current = await this.redis.incr(key);

        // Set expiry on first request
        if (current === 1) {
          await this.redis.expire(key, windowSeconds);
        }

        // Get TTL for headers
        const ttl = await this.redis.ttl(key);
        const resetTime = Date.now() + ttl * 1000;

        // Set rate limit headers
        res.setHeader('X-RateLimit-Limit', this.options.maxRequests);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, this.options.maxRequests - current));
        res.setHeader('X-RateLimit-Reset', resetTime);

        // Check if limit exceeded
        if (current > this.options.maxRequests) {
          throw new AppError(
            429,
            'Too many requests, please try again later',
            'RATE_LIMIT_EXCEEDED'
          );
        }

        next();
      } catch (error) {
        next(error);
      }
    };
  }

  private getIdentifier(req: Request): string {
    // Try to get user ID from authenticated request
    const userId = (req as any).user?.userId;
    if (userId) {
      return `user:${userId}`;
    }

    // Fall back to IP address
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return `ip:${ip}`;
  }
}

export default RateLimiter;
