import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bull';
import { EventEmitterModule } from '@nestjs/event-emitter';
import configuration from './config/configuration.js';
import { RedisModule } from './config/redis.module.js';
import { buildBullRedisOptions } from './common/utils/redis.js';
import { CorrelationMiddleware } from './common/middleware/correlation.middleware.js';
import { ShutdownOrchestratorService } from './common/services/shutdown-orchestrator.service.js';
import { SecurityModule } from './security/security.module.js';
import { GlobalRateLimitMiddleware } from './security/global-rate-limit.middleware.js';

// Feature modules.
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { AiModule } from './ai/ai.module.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { MessagesModule } from './messages/messages.module.js';
import { EvaluationModule } from './evaluation/evaluation.module.js';
import { QueueModule } from './queue/queue.module.js';
import { GatewayModule } from './gateway/gateway.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
    }),

    EventEmitterModule.forRoot({
      wildcard: false,
      maxListeners: 20,
    }),

    RedisModule,
    SecurityModule,

    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('mongodb.uri'),
        maxPoolSize: 20,
        minPoolSize: 5,
        socketTimeoutMS: 45000,
        serverSelectionTimeoutMS: 5000,
      }),
      inject: [ConfigService],
    }),

    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const redisUrl =
          configService.get<string>('redis.url') ?? 'redis://localhost:6379';
        return { redis: buildBullRedisOptions(redisUrl) };
      },
      inject: [ConfigService],
    }),

    AuthModule,
    UsersModule,
    AiModule,
    ConversationsModule,
    MessagesModule,
    EvaluationModule,
    QueueModule,
    GatewayModule,
    AnalyticsModule,
    HealthModule,
  ],
  providers: [ShutdownOrchestratorService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply correlation and rate limiting to all routes.
    consumer
      .apply(CorrelationMiddleware, GlobalRateLimitMiddleware)
      .forRoutes('*');
  }
}
