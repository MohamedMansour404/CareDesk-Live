import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  CONVERSATION_ACCESS_KEY,
  ConversationAccessMeta,
} from './conversation-access.decorator.js';
import { ConversationAccessPolicy } from './conversation-access.policy.js';
import { AuthenticatedUserContext } from './conversation-access.types.js';

@Injectable()
export class ConversationAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessPolicy: ConversationAccessPolicy,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<ConversationAccessMeta>(
      CONVERSATION_ACCESS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!meta) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUserContext;
      params?: Record<string, string | undefined>;
      conversationAccess?: unknown;
    }>();

    const user = request.user;
    if (!user?.userId || !user?.role) {
      throw new UnauthorizedException('Missing authentication context');
    }

    const conversationId = request.params?.[meta.paramName];
    if (!conversationId) {
      throw new UnauthorizedException('Conversation context is missing');
    }

    const snapshot = await this.accessPolicy.assertCanAccess(
      user,
      conversationId,
      meta.action,
      meta.options,
    );

    request.conversationAccess = snapshot;
    return true;
  }
}
