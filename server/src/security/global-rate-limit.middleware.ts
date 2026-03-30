import {
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  NestMiddleware,
  ServiceUnavailableException,
  Inject,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { NextFunction, Request, Response } from 'express';
import Redis from 'ioredis';
import {
  IRateLimiterRes,
  RateLimiterMemory,
  RateLimiterRedis,
} from 'rate-limiter-flexible';
import { REDIS_CLIENT } from '../config/redis.module.js';

type LimiterConfig = {
  points: number;
  durationSeconds: number;
  blockSeconds: number;
};

@Injectable()
export class GlobalRateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(GlobalRateLimitMiddleware.name);
  private readonly burstLimiter: RateLimiterRedis | null;
  private readonly sustainedLimiter: RateLimiterRedis | null;
  private readonly failClosed: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    @Inject(REDIS_CLIENT) @Optional() private readonly redis: Redis | null,
  ) {
    const burstConfig = this.configService.get<LimiterConfig>(
      'security.rateLimit.burst',
    ) ?? {
      points: 60,
      durationSeconds: 1,
      blockSeconds: 2,
    };

    const sustainedConfig = this.configService.get<LimiterConfig>(
      'security.rateLimit.sustained',
    ) ?? {
      points: 1200,
      durationSeconds: 60,
      blockSeconds: 30,
    };

    this.failClosed =
      this.configService.get<boolean>('security.rateLimit.failClosed') ?? true;

    if (!this.redis) {
      this.burstLimiter = null;
      this.sustainedLimiter = null;
      return;
    }

    const insuranceBurst = new RateLimiterMemory({
      points: burstConfig.points,
      duration: burstConfig.durationSeconds,
      blockDuration: burstConfig.blockSeconds,
      keyPrefix: 'rl:insurance:burst',
    });

    const insuranceSustained = new RateLimiterMemory({
      points: sustainedConfig.points,
      duration: sustainedConfig.durationSeconds,
      blockDuration: sustainedConfig.blockSeconds,
      keyPrefix: 'rl:insurance:sustained',
    });

    this.burstLimiter = new RateLimiterRedis({
      storeClient: this.redis,
      keyPrefix: 'rl:burst',
      points: burstConfig.points,
      duration: burstConfig.durationSeconds,
      blockDuration: burstConfig.blockSeconds,
      insuranceLimiter: insuranceBurst,
      rejectIfRedisNotReady: this.failClosed,
    });

    this.sustainedLimiter = new RateLimiterRedis({
      storeClient: this.redis,
      keyPrefix: 'rl:sustained',
      points: sustainedConfig.points,
      duration: sustainedConfig.durationSeconds,
      blockDuration: sustainedConfig.blockSeconds,
      insuranceLimiter: insuranceSustained,
      rejectIfRedisNotReady: this.failClosed,
    });
  }

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!this.redis && this.failClosed) {
      throw new ServiceUnavailableException(
        'Rate limiting backend unavailable',
      );
    }

    if (!this.redis && !this.failClosed) {
      return next();
    }

    if (!this.burstLimiter || !this.sustainedLimiter) {
      return next();
    }

    const actorKey = this.resolveActorKey(req);

    try {
      await this.burstLimiter.consume(actorKey, 1);
      await this.sustainedLimiter.consume(actorKey, 1);
      next();
    } catch (error: unknown) {
      if (this.isRateLimiterRes(error)) {
        const retryAfter = Math.max(
          1,
          Math.ceil((error.msBeforeNext ?? 1000) / 1000),
        );
        res.setHeader('Retry-After', retryAfter.toString());
        throw new HttpException(
          'Too many requests',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Rate limiter failure: ${errMsg}`);

      if (this.failClosed) {
        throw new ServiceUnavailableException('Rate limiting check failed');
      }

      next();
    }
  }

  private resolveActorKey(req: Request): string {
    const userId = this.extractUserId(req);
    if (userId) {
      return `user:${userId}`;
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    return `ip:${ip}`;
  }

  private extractUserId(req: Request): string | null {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return null;
    }

    const token = auth.slice('Bearer '.length).trim();
    if (!token) {
      return null;
    }

    try {
      const payload = this.jwtService.verify<{
        sub?: string;
        tokenType?: string;
      }>(token);
      if (payload.tokenType && payload.tokenType !== 'access') {
        return null;
      }
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }

  private isRateLimiterRes(error: unknown): error is IRateLimiterRes {
    return (
      typeof error === 'object' &&
      error !== null &&
      'msBeforeNext' in error &&
      typeof (error as { msBeforeNext?: unknown }).msBeforeNext === 'number'
    );
  }
}
