import { Controller, Get } from '@nestjs/common';
import {
  HealthCheckService,
  HealthCheck,
  MongooseHealthIndicator,
} from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health.js';
import { QueueHealthIndicator } from './queue.health.js';
import { WebSocketHealthIndicator } from './websocket.health.js';

@Controller('api/health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private mongoose: MongooseHealthIndicator,
    private redis: RedisHealthIndicator,
    private queue: QueueHealthIndicator,
    private websocket: WebSocketHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.mongoose.pingCheck('mongodb'),
      () => this.redis.isHealthy('redis'),
    ]);
  }

  @Get('readiness')
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.mongoose.pingCheck('mongodb'),
      () => this.redis.isReady('redis'),
      () => this.queue.isHealthy('queue'),
      () => this.websocket.isHealthy('websocket'),
    ]);
  }
}
