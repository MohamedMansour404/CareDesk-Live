import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MessagesService } from './messages.service.js';
import { MessagesController } from './messages.controller.js';
import { Message, MessageSchema } from './schemas/message.schema.js';
import { ConversationsModule } from '../conversations/conversations.module.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Message.name, schema: MessageSchema },
    ]),
    ConversationsModule,
  ],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
