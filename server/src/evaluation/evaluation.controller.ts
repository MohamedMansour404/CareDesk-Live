import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { EvaluationService } from './evaluation.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { UserRole } from '../common/constants.js';

@Controller('api/evaluations')
@UseGuards(JwtAuthGuard)
export class EvaluationController {
  constructor(private readonly evaluationService: EvaluationService) {}

  @Get('agent/:agentId')
  @Roles(UserRole.AGENT)
  @UseGuards(RolesGuard)
  async findByAgent(@Param('agentId') agentId: string) {
    const [evaluations, stats] = await Promise.all([
      this.evaluationService.findByAgent(agentId),
      this.evaluationService.getAgentAverageScore(agentId),
    ]);
    return { evaluations, stats };
  }

  @Get('conversation/:conversationId')
  async findByConversation(
    @Param('conversationId') conversationId: string,
  ) {
    return this.evaluationService.findByConversation(conversationId);
  }
}
