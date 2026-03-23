import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway.js';
import { AuthModule } from '../auth/auth.module.js';
import { ConversationsModule } from '../conversations/conversations.module.js';

@Module({
  imports: [AuthModule, ConversationsModule],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class GatewayModule {}
