import { SetMetadata } from '@nestjs/common';
import {
  ConversationAccessAction,
  ConversationAccessOptions,
} from './conversation-access.types.js';

export interface ConversationAccessMeta {
  action: ConversationAccessAction;
  paramName: string;
  options?: ConversationAccessOptions;
}

export const CONVERSATION_ACCESS_KEY = 'conversation_access';

export const ConversationAccess = (
  meta: ConversationAccessMeta,
): MethodDecorator => SetMetadata(CONVERSATION_ACCESS_KEY, meta);
