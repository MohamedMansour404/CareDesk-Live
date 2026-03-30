import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MessagesService } from './messages.service.js';
import { MessagesController } from './messages.controller.js';
import { MessageEventListeners } from './listeners/message-event.listeners.js';
import { MessageQueueRetryService } from './listeners/services/message-queue-retry.service.js';
import { MessageProcessingService } from './listeners/services/message-processing.service.js';
import { Message, MessageSchema } from './schemas/message.schema.js';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Message.name, schema: MessageSchema }]),
    AuthModule,
    ConversationsModule,
    QueueModule,
  ],
  controllers: [MessagesController],
  providers: [
    MessagesService,
    MessageEventListeners,
    MessageQueueRetryService,
    MessageProcessingService,
  ],
  exports: [MessagesService],
})
export class MessagesModule {}
