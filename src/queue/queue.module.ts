import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QueueService } from './queue.service.js';
import { MessageProcessor } from './processors/message.processor.js';
import { QUEUE_NAMES } from '../common/constants.js';

@Module({
  imports: [
    BullModule.registerQueue({
      name: QUEUE_NAMES.MESSAGE_PROCESSING,
    }),
  ],
  providers: [QueueService, MessageProcessor],
  exports: [QueueService],
})
export class QueueModule {}
