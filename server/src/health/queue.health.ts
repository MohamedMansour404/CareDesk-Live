import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { QueueService } from '../queue/queue.service.js';

@Injectable()
export class QueueHealthIndicator extends HealthIndicator {
  constructor(private readonly queueService: QueueService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const healthy = await this.queueService.isReady();
    if (!healthy) {
      throw new HealthCheckError(
        'Queue health check failed',
        this.getStatus(key, false),
      );
    }

    return this.getStatus(key, true);
  }
}
