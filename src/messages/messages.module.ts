import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MessagesService } from './messages.service.js';
import { MessagesController } from './messages.controller.js';
import { MessageEventListeners } from './listeners/message-event.listeners.js';
import { Message, MessageSchema } from './schemas/message.schema.js';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { QueueModule } from '../queue/queue.module.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Message.name, schema: MessageSchema },
    ]),
    ConversationsModule,
    QueueModule,
  ],
  controllers: [MessagesController],
  providers: [MessagesService, MessageEventListeners],
  exports: [MessagesService],
})
export class MessagesModule {}
