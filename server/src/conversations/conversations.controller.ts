import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { TransferConversationDto } from './dto/transfer-conversation.dto.js';
import { PaginationDto } from '../common/dto/pagination.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { UserRole } from '../common/constants.js';

interface AuthenticatedRequest {
  user: { userId: string; role: UserRole };
}

@Controller('api/conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  @Roles(UserRole.PATIENT)
  @UseGuards(RolesGuard)
  async create(
    @Body() dto: CreateConversationDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.conversationsService.create(req.user.userId, dto);
  }

  @Get()
  async findAll(
    @Request() req: AuthenticatedRequest,
    @Query() pagination: PaginationDto,
  ) {
    const { page, limit } = pagination;
    if (req.user.role === UserRole.PATIENT) {
      return this.conversationsService.findByPatient(req.user.userId, page, limit);
    }
    return this.conversationsService.findPendingByPriority(page, limit);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.conversationsService.findById(id);
  }

  @Patch(':id/assign')
  @Roles(UserRole.AGENT)
  @UseGuards(RolesGuard)
  async assign(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.conversationsService.assignAgent(id, req.user.userId);
  }

  @Patch(':id/resolve')
  async resolve(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.conversationsService.resolve(
      id,
      req.user.userId,
      req.user.role,
    );
  }

  @Patch(':id/transfer')
  @Roles(UserRole.AGENT)
  @UseGuards(RolesGuard)
  async transfer(
    @Param('id') id: string,
    @Body() dto: TransferConversationDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.conversationsService.transfer(id, req.user.userId, dto);
  }

  @Patch(':id/escalate')
  @Roles(UserRole.PATIENT)
  @UseGuards(RolesGuard)
  async escalate(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.conversationsService.escalateToHuman(id, req.user.userId);
  }
}
