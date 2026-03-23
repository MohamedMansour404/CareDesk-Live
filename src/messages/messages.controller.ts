import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { MessagesService } from './messages.service.js';
import { CreateMessageDto } from './dto/create-message.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { UserRole } from '../common/constants.js';

interface AuthenticatedRequest {
  user: { userId: string; role: UserRole };
}

@Controller('api/conversations/:conversationId/messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

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
      );
    }
    return this.messagesService.createPatientMessage(
      conversationId,
      req.user.userId,
      dto,
    );
  }

  @Get()
  async findAll(@Param('conversationId') conversationId: string) {
    return this.messagesService.findByConversation(conversationId);
  }

  @Get('ai-assist')
  @Roles(UserRole.AGENT)
  @UseGuards(RolesGuard)
  async getAiAssistance(@Param('conversationId') conversationId: string) {
    return this.messagesService.getAiAssistance(conversationId);
  }
}
