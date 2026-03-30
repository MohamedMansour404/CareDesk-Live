import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { RedisHealthIndicator } from './redis.health.js';
import { QueueModule } from '../queue/queue.module.js';
import { GatewayModule } from '../gateway/gateway.module.js';
import { QueueHealthIndicator } from './queue.health.js';
import { WebSocketHealthIndicator } from './websocket.health.js';

@Module({
  imports: [TerminusModule, QueueModule, GatewayModule],
  controllers: [HealthController],
  providers: [
    RedisHealthIndicator,
    QueueHealthIndicator,
    WebSocketHealthIndicator,
  ],
})
export class HealthModule {}
