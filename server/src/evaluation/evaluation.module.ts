import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EvaluationService } from './evaluation.service.js';
import { EvaluationController } from './evaluation.controller.js';
import { EvaluationEventListeners } from './listeners/evaluation-event.listeners.js';
import { Evaluation, EvaluationSchema } from './schemas/evaluation.schema.js';
import { Message, MessageSchema } from '../messages/schemas/message.schema.js';
import { AuthModule } from '../auth/auth.module.js';
import { ConversationsModule } from '../conversations/conversations.module.js';

@Module({
  imports: [
    AuthModule,
    ConversationsModule,
    MongooseModule.forFeature([
      { name: Evaluation.name, schema: EvaluationSchema },
      { name: Message.name, schema: MessageSchema },
    ]),
  ],
  controllers: [EvaluationController],
  providers: [EvaluationService, EvaluationEventListeners],
  exports: [EvaluationService],
})
export class EvaluationModule {}
