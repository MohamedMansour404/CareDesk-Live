import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Model, Types, Connection } from 'mongoose';
import {
  Conversation,
  ConversationDocument,
} from './schemas/conversation.schema.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { TransferConversationDto } from './dto/transfer-conversation.dto.js';
import { PaginatedResult } from '../common/dto/pagination.dto.js';
import {
  ConversationChannel,
  ConversationStatus,
  MessagePriority,
  MessageIntent,
  UserRole,
} from '../common/constants.js';
import { UsersService } from '../users/users.service.js';
import {
  SYSTEM_EVENTS,
  ConversationCreatedEvent,
  ConversationAssignedEvent,
  ConversationResolvedEvent,
  ConversationTransferredEvent,
} from '../common/events/index.js';

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @InjectModel(Conversation.name)
    private conversationModel: Model<ConversationDocument>,
    @InjectConnection() private connection: Connection,
    private usersService: UsersService,
    private eventEmitter: EventEmitter2,
  ) {}

  async create(
    patientId: string,
    dto: CreateConversationDto,
  ): Promise<ConversationDocument> {
    const conversation = new this.conversationModel({
      patient: new Types.ObjectId(patientId),
      channel: dto.channel,
      status:
        dto.channel === ConversationChannel.AI
          ? ConversationStatus.IN_PROGRESS
          : ConversationStatus.PENDING,
    });

    const saved = await conversation.save();
    this.logger.log(
      `Conversation created: ${saved._id} (channel=${dto.channel})`,
    );

    // Emit event → WebSocket listener broadcasts to agents
    this.eventEmitter.emit(
      SYSTEM_EVENTS.CONVERSATION_CREATED,
      new ConversationCreatedEvent(
        saved._id.toString(),
        dto.channel,
        saved.toObject(),
      ),
    );

    return saved;
  }

  async findById(id: string): Promise<ConversationDocument> {
    const conversation = await this.conversationModel
      .findById(id)
      .populate('patient', 'name email')
      .populate('agent', 'name email specialization');

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    return conversation;
  }

  async findByPatient(
    patientId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<ConversationDocument>> {
    const filter = { patient: new Types.ObjectId(patientId) };
    const total = await this.conversationModel.countDocuments(filter);

    const data = await this.conversationModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('agent', 'name email specialization')
      .exec();

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findPendingByPriority(
    page = 1,
    limit = 20,
  ): Promise<PaginatedResult<ConversationDocument>> {
    const filter = {
      channel: ConversationChannel.HUMAN,
      status: {
        $in: [ConversationStatus.PENDING, ConversationStatus.ASSIGNED],
      },
    };

    const total = await this.conversationModel.countDocuments(filter);

    const data = await this.conversationModel
      .find(filter)
      .sort({ priority: 1, createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('patient', 'name email')
      .exec();

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ─────────────────────────────────────────────
  // TRANSACTIONAL OPERATIONS
  // ─────────────────────────────────────────────

  async assignAgent(
    conversationId: string,
    agentId: string,
  ): Promise<ConversationDocument> {
    const session = await this.connection.startSession();

    try {
      session.startTransaction();

      const conversation = await this.conversationModel
        .findById(conversationId)
        .session(session);
      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      if (
        conversation.status !== ConversationStatus.PENDING &&
        conversation.status !== ConversationStatus.ASSIGNED
      ) {
        throw new ForbiddenException(
          'Conversation is not available for assignment',
        );
      }

      conversation.agent = new Types.ObjectId(agentId);
      conversation.status = ConversationStatus.IN_PROGRESS;
      await conversation.save({ session });

      await this.usersService.incrementActiveConversations(agentId, 1, session);

      await session.commitTransaction();

      // Emit event → WebSocket broadcasts
      this.eventEmitter.emit(
        SYSTEM_EVENTS.CONVERSATION_ASSIGNED,
        new ConversationAssignedEvent(conversationId, agentId),
      );

      this.logger.log(
        `Conversation ${conversationId} assigned to agent ${agentId}`,
      );
      return conversation;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async resolve(
    conversationId: string,
    userId: string,
    userRole: UserRole,
  ): Promise<ConversationDocument> {
    const session = await this.connection.startSession();

    try {
      session.startTransaction();

      const conversation = await this.conversationModel
        .findById(conversationId)
        .session(session);
      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      if (
        userRole === UserRole.AGENT &&
        conversation.agent?.toString() !== userId
      ) {
        throw new ForbiddenException('Not assigned to this conversation');
      }

      conversation.status = ConversationStatus.RESOLVED;
      conversation.resolvedAt = new Date();
      await conversation.save({ session });

      if (conversation.agent) {
        await this.usersService.incrementActiveConversations(
          conversation.agent.toString(),
          -1,
          session,
        );
      }

      await session.commitTransaction();

      // Emit event
      this.eventEmitter.emit(
        SYSTEM_EVENTS.CONVERSATION_RESOLVED,
        new ConversationResolvedEvent(conversationId),
      );

      this.logger.log(`Conversation ${conversationId} resolved`);
      return conversation;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async transfer(
    conversationId: string,
    currentAgentId: string,
    dto: TransferConversationDto,
  ): Promise<ConversationDocument> {
    const session = await this.connection.startSession();

    try {
      session.startTransaction();

      const conversation = await this.conversationModel
        .findById(conversationId)
        .session(session);
      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      if (conversation.agent?.toString() !== currentAgentId) {
        throw new ForbiddenException('Not assigned to this conversation');
      }

      if (dto.targetAgentId === currentAgentId) {
        throw new BadRequestException('Cannot transfer to yourself');
      }

      const targetAgent = await this.usersService.findById(dto.targetAgentId);
      if (!targetAgent || targetAgent.role !== UserRole.AGENT) {
        throw new NotFoundException('Target agent not found');
      }

      conversation.handoffHistory.push({
        from: new Types.ObjectId(currentAgentId),
        to: new Types.ObjectId(dto.targetAgentId),
        reason: dto.reason ?? 'No reason provided',
        at: new Date(),
      });

      conversation.agent = new Types.ObjectId(dto.targetAgentId);
      conversation.status = ConversationStatus.IN_PROGRESS;
      await conversation.save({ session });

      await this.usersService.incrementActiveConversations(
        currentAgentId,
        -1,
        session,
      );
      await this.usersService.incrementActiveConversations(
        dto.targetAgentId,
        1,
        session,
      );

      await session.commitTransaction();

      // Emit event
      this.eventEmitter.emit(
        SYSTEM_EVENTS.CONVERSATION_TRANSFERRED,
        new ConversationTransferredEvent(
          conversationId,
          currentAgentId,
          dto.targetAgentId,
        ),
      );

      this.logger.log(
        `Conversation ${conversationId} transferred: ${currentAgentId} → ${dto.targetAgentId}`,
      );
      return conversation;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async updatePriority(
    conversationId: string,
    priority: MessagePriority,
    category: MessageIntent,
  ): Promise<void> {
    await this.conversationModel.findByIdAndUpdate(conversationId, {
      priority,
      category,
    });
  }

  async updateSummary(
    conversationId: string,
    summary: string,
  ): Promise<void> {
    await this.conversationModel.findByIdAndUpdate(conversationId, { summary });
  }

  async updateLanguage(
    conversationId: string,
    language: string,
  ): Promise<void> {
    await this.conversationModel.findByIdAndUpdate(conversationId, { language });
  }

  /**
   * Check if a user is a participant in a conversation.
   */
  async isParticipant(
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    const conversation = await this.conversationModel.findById(conversationId);
    if (!conversation) return false;

    return (
      conversation.patient.toString() === userId ||
      conversation.agent?.toString() === userId
    );
  }
}
