import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { MongooseModule } from '@nestjs/mongoose';
import { QueueService } from './queue.service.js';
import { MessageProcessor } from './processors/message.processor.js';
import { QUEUE_NAMES } from '../common/constants.js';
import {
  Conversation,
  ConversationSchema,
} from '../conversations/schemas/conversation.schema.js';

@Module({
  imports: [
    BullModule.registerQueue({
      name: QUEUE_NAMES.MESSAGE_PROCESSING,
    }),
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
    ]),
  ],
  providers: [QueueService, MessageProcessor],
  exports: [QueueService],
})
export class QueueModule {}

