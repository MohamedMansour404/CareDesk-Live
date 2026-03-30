import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import { EventsGateway } from '../../gateway/events.gateway.js';
import { QueueService } from '../../queue/queue.service.js';
import { RedisLifecycleService } from '../../config/redis.lifecycle.js';

@Injectable()
export class ShutdownOrchestratorService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(ShutdownOrchestratorService.name);
  private isShuttingDown = false;

  constructor(
    private readonly eventsGateway: EventsGateway,
    private readonly queueService: QueueService,
    private readonly redisLifecycleService: RedisLifecycleService,
  ) {}

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    const reason = signal ?? 'app-shutdown';

    this.logger.log(`Starting coordinated shutdown (${reason})`);

    await this.eventsGateway.shutdownGracefully(reason);
    await this.queueService.shutdownGracefully(reason);
    await this.redisLifecycleService.shutdownGracefully(reason);

    this.logger.log(`Coordinated shutdown complete (${reason})`);
  }
}
