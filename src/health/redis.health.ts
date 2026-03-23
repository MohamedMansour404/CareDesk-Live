import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { createRedisClient } from '../common/utils/redis.js';
import Redis from 'ioredis';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(RedisHealthIndicator.name);
  private redis: Redis;

  constructor(private configService: ConfigService) {
    super();
    const redisUrl = this.configService.get<string>('redis.url') ?? 'redis://localhost:6379';
    this.redis = createRedisClient(redisUrl, {
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
      lazyConnect: true,
    });

    // Suppress unhandled error crashes — health check will report the failure
    this.redis.on('error', (err) => {
      this.logger.debug(`Redis health check connection error: ${err.message}`);
    });
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.redis.connect().catch(() => {});
      const ping = await this.redis.ping();
      if (ping === 'PONG') {
        return this.getStatus(key, true);
      }
      throw new Error('Redis ping failed');
    } catch (error) {
      throw new HealthCheckError(
        'Redis check failed',
        this.getStatus(key, false, { message: (error as Error).message }),
      );
    }
  }
}
