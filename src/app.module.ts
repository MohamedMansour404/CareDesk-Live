
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bull';
import { EventEmitterModule } from '@nestjs/event-emitter';
import configuration from './config/configuration.js';
import { buildBullRedisOptions } from './common/utils/redis.js';

// Feature modules
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
    // ── Configuration ──────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
    }),

    // ── Event Emitter (global) ─────────────────
    EventEmitterModule.forRoot({
      wildcard: false,
      maxListeners: 20,
    }),

    // ── MongoDB (with pool config) ─────────────
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

    // ── Redis / BullMQ ─────────────────────────
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('redis.url') ?? 'redis://localhost:6379';
        return { redis: buildBullRedisOptions(redisUrl) };
      },
      inject: [ConfigService],
    }),

    // ── Feature Modules ────────────────────────
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
})
export class AppModule {}
