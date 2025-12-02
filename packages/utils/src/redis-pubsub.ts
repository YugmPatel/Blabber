import Redis from 'ioredis';
import { AppEvent, EventType } from '@repo/types';
import { logger } from './logger';

const EVENTS_CHANNEL = 'app:events';

export class RedisPubSub {
  private publisher: Redis;
  private subscriber: Redis;
  private handlers: Map<EventType, Array<(event: AppEvent) => void | Promise<void>>>;

  constructor(redisConfig: { host: string; port: number; password?: string }) {
    // Create separate connections for pub and sub
    this.publisher = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password || undefined,
    });

    this.subscriber = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password || undefined,
    });

    this.handlers = new Map();

    this.setupSubscriber();
  }

  private setupSubscriber(): void {
    this.subscriber.subscribe(EVENTS_CHANNEL, (err) => {
      if (err) {
        logger.error({ err }, 'Failed to subscribe to events channel');
      } else {
        logger.info('Subscribed to events channel');
      }
    });

    this.subscriber.on('message', (channel, message) => {
      if (channel === EVENTS_CHANNEL) {
        try {
          const event = JSON.parse(message) as AppEvent;
          this.handleEvent(event);
        } catch (error) {
          logger.error({ error, message }, 'Failed to parse event');
        }
      }
    });
  }

  private handleEvent(event: AppEvent): void {
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          const result = handler(event);
          if (result instanceof Promise) {
            result.catch((error) => {
              logger.error({ error, event }, 'Event handler failed');
            });
          }
        } catch (error) {
          logger.error({ error, event }, 'Event handler threw error');
        }
      });
    }
  }

  /**
   * Publish an event to Redis
   */
  async publish(event: AppEvent): Promise<void> {
    try {
      const message = JSON.stringify(event);
      await this.publisher.publish(EVENTS_CHANNEL, message);
      logger.debug({ event: event.type }, 'Published event');
    } catch (error) {
      logger.error({ error, event }, 'Failed to publish event');
      throw error;
    }
  }

  /**
   * Subscribe to specific event types
   */
  on(eventType: EventType, handler: (event: AppEvent) => void | Promise<void>): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);
  }

  /**
   * Subscribe to all events
   */
  onAny(handler: (event: AppEvent) => void | Promise<void>): void {
    Object.values(EventType).forEach((eventType) => {
      this.on(eventType as EventType, handler);
    });
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    await this.subscriber.quit();
    await this.publisher.quit();
    logger.info('Closed Redis Pub/Sub connections');
  }
}

// Helper function to create event with timestamp
export function createEvent<T extends AppEvent>(type: T['type'], data: T['data']): T {
  return {
    type,
    data,
    timestamp: new Date().toISOString(),
  } as T;
}
