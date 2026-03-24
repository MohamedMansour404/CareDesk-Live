import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { MessagesService } from './messages.service.js';
import { CreateMessageDto } from './dto/create-message.dto.js';
import { PaginationDto } from '../common/dto/pagination.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { UserRole } from '../common/constants.js';
import { AiService } from '../ai/ai.service.js';

interface AuthenticatedRequest {
  user: { userId: string; role: UserRole };
  correlationId?: string;
}

@Controller('api/conversations/:conversationId/messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly aiService: AiService,
  ) {}

  @Post()
  async create(
    @Param('conversationId') conversationId: string,
    @Body() dto: CreateMessageDto,
    @Request() req: AuthenticatedRequest,
  ) {
    if (req.user.role === UserRole.AGENT) {
      return this.messagesService.createAgentMessage(
        conversationId,
        req.user.userId,
        dto,
        req.correlationId,
      );
    }
    return this.messagesService.createPatientMessage(
      conversationId,
      req.user.userId,
      dto,
      req.correlationId,
    );
  }

  @Get()
  async findAll(
    @Param('conversationId') conversationId: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.messagesService.findByConversation(
      conversationId,
      pagination.page,
      pagination.limit,
    );
  }

  @Get('ai-assist')
  @Roles(UserRole.AGENT)
  @UseGuards(RolesGuard)
  async getAiAssistance(@Param('conversationId') conversationId: string) {
    const messages =
      await this.messagesService.findAllByConversation(conversationId);

    const conversationHistory = messages
      .map((m) => {
        const role = m.senderRole.toUpperCase();
        return `[${role}]: ${m.content}`;
      })
      .join('\n');

    return this.aiService.generateAgentAssistance(conversationHistory);
  }
}
