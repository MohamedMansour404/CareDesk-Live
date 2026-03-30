import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { buildRedisOptions } from '../common/utils/redis.js';
import { CacheService } from '../common/services/cache.service.js';
import { CacheInvalidationService } from '../common/services/cache-invalidation.service.js';
import { IdempotencyService } from '../common/services/idempotency.service.js';
import { RedisLifecycleService } from './redis.lifecycle.js';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Shared Redis module — provides a single managed ioredis client
 * for analytics caching, health checks, and other non-Bull uses.
 * Bull has its own connection with different requirements (maxRetriesPerRequest: null).
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (configService: ConfigService): Redis | null => {
        const redisUrl = configService.get<string>('redis.url');
        if (!redisUrl) return null;

        const client = new Redis({
          ...buildRedisOptions(redisUrl),
          lazyConnect: true,
          retryStrategy: (times: number) => {
            if (times > 5) return null; // stop after 5 retries
            return Math.min(times * 500, 3000);
          },
        });

        client.on('error', (err) => {
          // Suppress to prevent crash — consumers handle gracefully
          if (process.env.LOG_LEVEL === 'debug') {
            console.debug(`[SharedRedis] ${err.message}`);
          }
        });

        // Connect lazily — don't block app startup
        client.connect().catch(() => {});

        return client;
      },
      inject: [ConfigService],
    },
    CacheService,
    CacheInvalidationService,
    IdempotencyService,
    RedisLifecycleService,
  ],
  exports: [
    REDIS_CLIENT,
    CacheService,
    CacheInvalidationService,
    IdempotencyService,
    RedisLifecycleService,
  ],
})
export class RedisModule {}
