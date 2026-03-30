import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import { EvaluationService } from './evaluation.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { UserRole } from '../common/constants.js';
import { ConversationAccessGuard } from '../conversations/access/conversation-access.guard.js';
import { ConversationAccess } from '../conversations/access/conversation-access.decorator.js';
import { ConversationAccessAction } from '../conversations/access/conversation-access.types.js';

interface AuthenticatedRequest {
  user: { userId: string; role: UserRole };
}

@Controller('api/evaluations')
@UseGuards(JwtAuthGuard)
export class EvaluationController {
  constructor(private readonly evaluationService: EvaluationService) {}

  @Get('agent/:agentId')
  @Roles(UserRole.AGENT, UserRole.ADMIN)
  @UseGuards(RolesGuard)
  async findByAgent(
    @Param('agentId') agentId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    if (req.user.role === UserRole.AGENT && req.user.userId !== agentId) {
      throw new ForbiddenException('Agents can only access their own metrics');
    }

    const [evaluations, stats] = await Promise.all([
      this.evaluationService.findByAgent(agentId),
      this.evaluationService.getAgentAverageScore(agentId),
    ]);
    return { evaluations, stats };
  }

  @Get('conversation/:conversationId')
  @UseGuards(ConversationAccessGuard)
  @ConversationAccess({
    action: ConversationAccessAction.VIEW_MESSAGES,
    paramName: 'conversationId',
    options: { allowQueueViewForAgents: false },
  })
  async findByConversation(@Param('conversationId') conversationId: string) {
    return this.evaluationService.findByConversation(conversationId);
  }
}
