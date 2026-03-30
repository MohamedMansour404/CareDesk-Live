import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { EventsGateway } from '../gateway/events.gateway.js';

@Injectable()
export class WebSocketHealthIndicator extends HealthIndicator {
  constructor(private readonly gateway: EventsGateway) {
    super();
  }

  isHealthy(key: string): HealthIndicatorResult {
    const healthy = this.gateway.isReady();
    if (!healthy) {
      throw new HealthCheckError(
        'WebSocket health check failed',
        this.getStatus(key, false),
      );
    }

    return this.getStatus(key, true);
  }
}
