import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { MongooseModule } from '@nestjs/mongoose';
import { QueueService } from './queue.service.js';
import { MessageProcessor } from './processors/message.processor.js';
import { QueueController } from './queue.controller.js';
import { QUEUE_NAMES } from '../common/constants.js';
import {
  Conversation,
  ConversationSchema,
} from '../conversations/schemas/conversation.schema.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [
    AuthModule,
    BullModule.registerQueue({
      name: QUEUE_NAMES.MESSAGE_PROCESSING,
    }),
    BullModule.registerQueue({
      name: QUEUE_NAMES.MESSAGE_DLQ,
    }),
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
    ]),
  ],
  controllers: [QueueController],
  providers: [QueueService, MessageProcessor],
  exports: [QueueService],
})
export class QueueModule {}
