import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { UserRole } from '../common/constants.js';

@Controller('api/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.AGENT)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('stats/overview')
  async getOverviewStats() {
    return this.analyticsService.getOverviewStats();
  }

  @Get('stats/agent/:agentId')
  async getAgentStats(@Param('agentId') agentId: string) {
    return this.analyticsService.getAgentStats(agentId);
  }
}
