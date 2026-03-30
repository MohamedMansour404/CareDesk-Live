import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.module.js';

@Injectable()
export class RedisLifecycleService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisLifecycleService.name);
  private isClosed = false;

  constructor(
    @Inject(REDIS_CLIENT) @Optional() private readonly redis: Redis | null,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.shutdownGracefully('module-destroy');
  }

  async shutdownGracefully(reason: string): Promise<void> {
    await this.closeRedis(reason);
  }

  private async closeRedis(reason: string): Promise<void> {
    if (!this.redis || this.isClosed) {
      return;
    }

    this.isClosed = true;

    try {
      await this.redis.quit();
      this.logger.log(`Shared Redis connection closed (${reason})`);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Redis quit failed (${reason}): ${errMsg}`);
      this.redis.disconnect(false);
    }
  }
}
