import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConversationsService } from './conversations.service.js';
import { ConversationsController } from './conversations.controller.js';
import {
  Conversation,
  ConversationSchema,
} from './schemas/conversation.schema.js';
import { Message, MessageSchema } from '../messages/schemas/message.schema.js';
import { UsersModule } from '../users/users.module.js';
import { ConversationAccessPolicy } from './access/conversation-access.policy.js';
import { ConversationAccessGuard } from './access/conversation-access.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import { TriageService } from './services/triage.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
    ]),
    AuthModule,
    UsersModule,
  ],
  controllers: [ConversationsController],
  providers: [
    ConversationsService,
    TriageService,
    ConversationAccessPolicy,
    ConversationAccessGuard,
  ],
  exports: [
    ConversationsService,
    ConversationAccessPolicy,
    ConversationAccessGuard,
  ],
})
export class ConversationsModule {}
