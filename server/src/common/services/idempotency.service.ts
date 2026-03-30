import {
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../config/redis.module.js';

type RunOnceOptions = {
  lockTtlSeconds: number;
  completionTtlSeconds: number;
};

export type RunOnceResult<T> =
  | { executed: true; result: T }
  | { executed: false; reason: 'already-completed' | 'in-progress' };

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly mode: 'redis-required' | 'best-effort-local';
  private readonly localCompletions = new Map<string, number>();
  private readonly localLocks = new Map<string, number>();

  constructor(
    @Inject(REDIS_CLIENT) @Optional() private readonly redis: Redis | null,
    private readonly configService: ConfigService,
  ) {
    const configuredMode = this.configService.get<string>(
      'security.idempotencyMode',
    );
    this.mode =
      configuredMode === 'best-effort-local'
        ? 'best-effort-local'
        : 'redis-required';
  }

  async runOnce<T>(
    scope: string,
    uniqueId: string,
    options: RunOnceOptions,
    operation: () => Promise<T>,
  ): Promise<RunOnceResult<T>> {
    const completionKey = this.toCompletionKey(scope, uniqueId);
    const lockKey = this.toLockKey(scope, uniqueId);

    const alreadyCompleted = await this.isCompleted(completionKey);
    if (alreadyCompleted) {
      return { executed: false, reason: 'already-completed' };
    }

    const locked = await this.acquireLock(lockKey, options.lockTtlSeconds);
    if (!locked) {
      return { executed: false, reason: 'in-progress' };
    }

    try {
      const result = await operation();
      await this.markCompleted(completionKey, options.completionTtlSeconds);
      return { executed: true, result };
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  private toLockKey(scope: string, uniqueId: string): string {
    return `idem:lock:${scope}:${uniqueId}`;
  }

  private toCompletionKey(scope: string, uniqueId: string): string {
    return `idem:done:${scope}:${uniqueId}`;
  }

  private async isCompleted(key: string): Promise<boolean> {
    if (this.redis) {
      try {
        const exists = await this.redis.exists(key);
        return exists === 1;
      } catch (error: unknown) {
        this.handleRedisFailure('isCompleted', error);
      }
    } else {
      this.handleRedisUnavailable('isCompleted');
    }

    this.sweepExpired(this.localCompletions);
    const expiry = this.localCompletions.get(key);
    if (!expiry) return false;

    if (Date.now() > expiry) {
      this.localCompletions.delete(key);
      return false;
    }

    return true;
  }

  private async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    if (this.redis) {
      try {
        const result = await this.redis.set(key, '1', 'EX', ttlSeconds, 'NX');
        return result === 'OK';
      } catch (error: unknown) {
        this.handleRedisFailure('acquireLock', error);
      }
    } else {
      this.handleRedisUnavailable('acquireLock');
    }

    this.sweepExpired(this.localLocks);
    if (this.localLocks.has(key)) {
      return false;
    }

    this.localLocks.set(key, Date.now() + ttlSeconds * 1000);
    return true;
  }

  private async markCompleted(key: string, ttlSeconds: number): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.set(key, '1', 'EX', ttlSeconds);
        return;
      } catch (error: unknown) {
        this.handleRedisFailure('markCompleted', error);
      }
    } else {
      this.handleRedisUnavailable('markCompleted');
    }

    this.localCompletions.set(key, Date.now() + ttlSeconds * 1000);
  }

  private async releaseLock(key: string): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.del(key);
      } catch (error: unknown) {
        this.handleRedisFailure('releaseLock', error);
      }
    } else {
      this.handleRedisUnavailable('releaseLock');
    }

    this.localLocks.delete(key);
  }

  private handleRedisFailure(operation: string, error: unknown): void {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (this.mode === 'redis-required') {
      this.logger.error(
        `Idempotency Redis failure in ${operation} (mode=redis-required): ${errMsg}`,
      );
      throw new ServiceUnavailableException(
        'Idempotency backend unavailable. Please retry shortly.',
      );
    }

    this.logger.warn(
      `Redis ${operation} failed, falling back to local map: ${errMsg}`,
    );
  }

  private handleRedisUnavailable(operation: string): void {
    if (this.mode === 'redis-required') {
      this.logger.error(
        `Idempotency Redis unavailable in ${operation} (mode=redis-required)`,
      );
      throw new ServiceUnavailableException(
        'Idempotency backend unavailable. Please retry shortly.',
      );
    }

    this.logger.warn(
      `Redis unavailable in ${operation}, falling back to local map`,
    );
  }

  private sweepExpired(store: Map<string, number>): void {
    const now = Date.now();
    for (const [key, expiry] of store) {
      if (expiry <= now) {
        store.delete(key);
      }
    }
  }
}
