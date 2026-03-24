import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../config/redis.module.js';

/**
 * Generic Redis cache service.
 * Gracefully degrades to no-op when Redis is unavailable.
 * All methods are safe to call even without Redis connection.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(
    @Inject(REDIS_CLIENT) @Optional() private readonly redis: Redis | null,
  ) {
    if (this.redis) {
      this.logger.log('CacheService initialized with Redis');
    } else {
      this.logger.warn('CacheService running without Redis — caching disabled');
    }
  }

  /**
   * Get a cached value by key.
   * Returns null on cache miss or Redis error.
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.redis) return null;
    try {
      const data = await this.redis.get(key);
      if (data) {
        this.logger.debug(`Cache HIT: ${key}`);
        return JSON.parse(data) as T;
      }
    } catch (err: unknown) {
      this.logger.warn(`Cache get failed: ${err}`);
    }
    return null;
  }

  /**
   * Set a cached value with TTL (in seconds).
   */
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
    } catch (err: unknown) {
      this.logger.warn(`Cache set failed: ${err}`);
    }
  }

  /**
   * Invalidate a specific cache key.
   */
  async invalidate(key: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(key);
      this.logger.debug(`Cache invalidated: ${key}`);
    } catch (err: unknown) {
      this.logger.warn(`Cache invalidate failed: ${err}`);
    }
  }

  /**
   * Invalidate all keys matching a glob pattern.
   * Uses SCAN to avoid blocking Redis.
   */
  async invalidatePattern(pattern: string): Promise<void> {
    if (!this.redis) return;
    try {
      let cursor = '0';
      do {
        const [newCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = newCursor;
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
      this.logger.debug(`Cache pattern invalidated: ${pattern}`);
    } catch (err: unknown) {
      this.logger.warn(`Cache invalidatePattern failed: ${err}`);
    }
  }

  /**
   * Check if Redis is available.
   */
  isAvailable(): boolean {
    return this.redis !== null;
  }
}
