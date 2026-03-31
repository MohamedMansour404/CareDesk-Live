import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Connection, Model, Types } from 'mongoose';
import {
  Conversation,
  ConversationDocument,
} from './schemas/conversation.schema.js';
import {
  Message,
  MessageDocument,
} from '../messages/schemas/message.schema.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { TransferConversationDto } from './dto/transfer-conversation.dto.js';
import { PaginatedResult } from '../common/dto/pagination.dto.js';
import {
  ConversationChannel,
  ConversationStatus,
  MessagePriority,
  MessageIntent,
  UserRole,
  SenderRole,
} from '../common/constants.js';
import { UsersService } from '../users/users.service.js';
import { CacheService } from '../common/services/cache.service.js';
import { CacheInvalidationService } from '../common/services/cache-invalidation.service.js';
import { CACHE_KEYS, CACHE_TTLS } from '../common/cache/cache-keys.js';
import {
  SYSTEM_EVENTS,
  ConversationCreatedEvent,
  ConversationAssignedEvent,
  ConversationResolvedEvent,
  ConversationTransferredEvent,
  ConversationEscalatedEvent,
  MessageCreatedEvent,
} from '../common/events/index.js';
import { TriageService } from './services/triage.service.js';

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @InjectModel(Conversation.name)
    private conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name)
    private messageModel: Model<MessageDocument>,
    @InjectConnection() private readonly connection: Connection,
    private usersService: UsersService,
    private eventEmitter: EventEmitter2,
    private cacheService: CacheService,
    private cacheInvalidationService: CacheInvalidationService,
    private triageService: TriageService,
  ) {}

  private isTransactionUnsupported(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    return (
      lower.includes('transaction numbers are only allowed') ||
      lower.includes('replica set') ||
      lower.includes('transactions are not supported')
    );
  }

  private buildIntakeSnapshot(dto: CreateConversationDto) {
    if (!dto.intake) {
      return undefined;
    }

    const chronicConditions = (dto.intake.clinical.chronicConditions ?? [])
      .map((condition) => condition.trim())
      .filter((condition) => condition.length > 0);

    const normalized = {
      version: dto.intake.version ?? 1,
      demographics: dto.intake.demographics,
      vitals: dto.intake.vitals,
      clinical: {
        ...dto.intake.clinical,
        chronicConditions,
        mainComplaint: dto.intake.clinical.mainComplaint.trim(),
      },
    };

    const triage = this.triageService.assessIntake(normalized);

    return {
      snapshot: {
        ...normalized,
        triage: {
          level: triage.level,
          score: triage.score,
          source: triage.source,
          reasons: triage.reasons,
          classifiedAt: triage.classifiedAt,
        },
      },
      mappedPriority: triage.mappedPriority,
      complaint: normalized.clinical.mainComplaint,
    };
  }

  private buildConversationPayload(
    patientId: string,
    dto: CreateConversationDto,
  ) {
    const intakeResult = this.buildIntakeSnapshot(dto);
    return {
      payload: {
        patient: new Types.ObjectId(patientId),
        channel: dto.channel,
        status:
          dto.channel === ConversationChannel.AI
            ? ConversationStatus.IN_PROGRESS
            : ConversationStatus.PENDING,
        ...(intakeResult
          ? {
              priority: intakeResult.mappedPriority,
              intake: intakeResult.snapshot,
            }
          : {}),
      },
      intakeResult,
    };
  }

  private async emitConversationCreated(
    savedConversation: ConversationDocument,
    dto: CreateConversationDto,
    patientId: string,
    complaintMessage?: MessageDocument,
  ): Promise<void> {
    await this.cacheInvalidationService.invalidateConversationList();

    this.eventEmitter.emit(
      SYSTEM_EVENTS.CONVERSATION_CREATED,
      new ConversationCreatedEvent(
        savedConversation._id.toString(),
        dto.channel,
        savedConversation.toObject(),
      ),
    );

    if (!complaintMessage) {
      return;
    }

    this.eventEmitter.emit(
      SYSTEM_EVENTS.MESSAGE_CREATED,
      new MessageCreatedEvent(
        savedConversation._id.toString(),
        complaintMessage._id.toString(),
        patientId,
        SenderRole.PATIENT,
        complaintMessage.content,
        savedConversation.channel,
        complaintMessage.toObject(),
      ),
    );
  }

  private async createWithTransaction(
    patientId: string,
    dto: CreateConversationDto,
  ): Promise<ConversationDocument> {
    const session = await this.connection.startSession();
    const { payload, intakeResult } = this.buildConversationPayload(
      patientId,
      dto,
    );
    let savedConversation: ConversationDocument | null = null;
    let complaintMessage: MessageDocument | undefined;

    try {
      session.startTransaction();

      savedConversation = await new this.conversationModel(payload).save({
        session,
      });

      if (intakeResult?.complaint) {
        complaintMessage = await new this.messageModel({
          conversation: savedConversation._id,
          sender: new Types.ObjectId(patientId),
          senderRole: SenderRole.PATIENT,
          content: intakeResult.complaint,
        }).save({ session });
      }

      await session.commitTransaction();

      const conversationId = savedConversation._id.toString();

      this.logger.log(
        `Conversation created: ${conversationId} (channel=${dto.channel}, intake=${dto.intake ? 'yes' : 'no'})`,
      );

      await this.emitConversationCreated(
        savedConversation,
        dto,
        patientId,
        complaintMessage,
      );

      return savedConversation;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }

  private async createWithCompensation(
    patientId: string,
    dto: CreateConversationDto,
  ): Promise<ConversationDocument> {
    const { payload, intakeResult } = this.buildConversationPayload(
      patientId,
      dto,
    );
    const savedConversation = await new this.conversationModel(payload).save();
    let complaintMessage: MessageDocument | undefined;

    try {
      if (intakeResult?.complaint) {
        complaintMessage = await new this.messageModel({
          conversation: savedConversation._id,
          sender: new Types.ObjectId(patientId),
          senderRole: SenderRole.PATIENT,
          content: intakeResult.complaint,
        }).save();
      }
    } catch {
      const conversationId = savedConversation._id.toString();
      await this.conversationModel.findByIdAndDelete(savedConversation._id);
      this.logger.error(
        `Rolled back conversation ${conversationId} after complaint message write failure`,
      );
      throw new InternalServerErrorException(
        'Failed to create conversation intake message. Please retry.',
      );
    }

    const conversationId = savedConversation._id.toString();

    this.logger.log(
      `Conversation created: ${conversationId} (channel=${dto.channel}, intake=${dto.intake ? 'yes' : 'no'})`,
    );

    await this.emitConversationCreated(
      savedConversation,
      dto,
      patientId,
      complaintMessage,
    );

    return savedConversation;
  }

  /** Invalidates cache entries touched by conversation mutations. */
  private async invalidateConversationCaches(
    conversationId: string,
  ): Promise<void> {
    await this.cacheInvalidationService.invalidateConversation(conversationId);
  }

  async create(
    patientId: string,
    dto: CreateConversationDto,
  ): Promise<ConversationDocument> {
    try {
      return await this.createWithTransaction(patientId, dto);
    } catch (error: unknown) {
      if (!this.isTransactionUnsupported(error)) {
        throw error;
      }

      this.logger.warn(
        'Mongo transactions unavailable; using compensation fallback for conversation intake creation',
      );

      return this.createWithCompensation(patientId, dto);
    }
  }

  async findById(id: string): Promise<ConversationDocument> {
    const cached = await this.cacheService.get<ConversationDocument>(
      CACHE_KEYS.conversation(id),
    );
    if (cached) return cached;

    const conversation = await this.conversationModel
      .findById(id)
      .populate('patient', 'name email')
      .populate('agent', 'name email specialization');

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    await this.cacheService.set(
      CACHE_KEYS.conversation(id),
      conversation.toObject(),
      CACHE_TTLS.conversation,
    );
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
    const cacheKey = CACHE_KEYS.conversationQueue(page, limit);
    const cached =
      await this.cacheService.get<PaginatedResult<ConversationDocument>>(
        cacheKey,
      );
    if (cached) return cached;

    // Include all operational states so queue/mine/resolved can be filtered client-side.
    const filter = {
      channel: ConversationChannel.HUMAN,
      status: {
        $in: [
          ConversationStatus.PENDING,
          ConversationStatus.ASSIGNED,
          ConversationStatus.IN_PROGRESS,
          ConversationStatus.RESOLVED,
        ],
      },
    };

    const total = await this.conversationModel.countDocuments(filter);

    const data = await this.conversationModel
      .find(filter)
      .sort({ priority: 1, createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('patient', 'name email')
      .populate('agent', 'name email')
      .lean()
      .exec();

    const result = {
      data: data as unknown as ConversationDocument[],
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };

    await this.cacheService.setTracked(
      cacheKey,
      result,
      CACHE_TTLS.conversationQueue,
      CACHE_KEYS.conversationQueueNamespace,
    );
    return result;
  }

  /** Moves pending/assigned conversations to in_progress after first agent reply. */
  async markAsInProgress(
    conversationId: string,
    agentId: string,
  ): Promise<void> {
    const updated = await this.conversationModel.findOneAndUpdate(
      {
        _id: conversationId,
        status: {
          $in: [ConversationStatus.PENDING, ConversationStatus.ASSIGNED],
        },
      },
      {
        $set: {
          status: ConversationStatus.IN_PROGRESS,
          agent: new Types.ObjectId(agentId),
        },
      },
      { new: true },
    );

    if (updated) {
      await this.invalidateConversationCaches(conversationId);
      this.eventEmitter.emit(
        SYSTEM_EVENTS.CONVERSATION_ASSIGNED,
        new ConversationAssignedEvent(conversationId, agentId),
      );
      this.logger.log(
        `Conversation ${conversationId} → IN_PROGRESS (agent ${agentId} replied)`,
      );
    }
  }

  async assignAgent(
    conversationId: string,
    agentId: string,
  ): Promise<ConversationDocument> {
    const existing = await this.conversationModel.findById(conversationId);
    if (!existing) {
      throw new NotFoundException('Conversation not found');
    }

    if (
      existing.agent &&
      existing.agent.toString() !== agentId &&
      [ConversationStatus.ASSIGNED, ConversationStatus.IN_PROGRESS].includes(
        existing.status,
      )
    ) {
      throw new ForbiddenException(
        'Conversation is already assigned to another agent',
      );
    }

    if (existing.agent?.toString() === agentId) {
      return existing.populate('patient', 'name email');
    }

    const conversation = await this.conversationModel.findOneAndUpdate(
      {
        _id: conversationId,
        status: ConversationStatus.PENDING,
      },
      {
        $set: {
          agent: new Types.ObjectId(agentId),
          status: ConversationStatus.ASSIGNED,
        },
      },
      { new: true },
    );

    if (!conversation) {
      throw new NotFoundException(
        'Conversation not found or not available for assignment',
      );
    }

    // Counter updates should not block assignment success.
    await this.usersService
      .incrementActiveConversations(agentId, 1)
      .catch((err: Error) =>
        this.logger.warn(`Failed to increment agent counter: ${err.message}`),
      );

    await this.invalidateConversationCaches(conversationId);

    this.eventEmitter.emit(
      SYSTEM_EVENTS.CONVERSATION_ASSIGNED,
      new ConversationAssignedEvent(conversationId, agentId),
    );

    this.logger.log(
      `Conversation ${conversationId} assigned to agent ${agentId}`,
    );
    return conversation;
  }

  /** Escalates an AI conversation into the human queue. */
  async escalateToHuman(
    conversationId: string,
    patientId: string,
  ): Promise<ConversationDocument> {
    const conversation = await this.conversationModel.findOneAndUpdate(
      {
        _id: conversationId,
        patient: new Types.ObjectId(patientId),
        channel: ConversationChannel.AI,
        status: { $ne: ConversationStatus.RESOLVED },
      },
      {
        $set: {
          channel: ConversationChannel.HUMAN,
          status: ConversationStatus.PENDING,
        },
      },
      { new: true },
    );

    if (!conversation) {
      const existing = await this.conversationModel.findById(conversationId);
      if (!existing) throw new NotFoundException('Conversation not found');
      if (existing.patient.toString() !== patientId)
        throw new ForbiddenException('Not your conversation');
      if (existing.channel !== ConversationChannel.AI)
        throw new BadRequestException('Only AI conversations can be escalated');
      if (existing.status === ConversationStatus.RESOLVED)
        throw new BadRequestException(
          'Cannot escalate a resolved conversation',
        );
      throw new BadRequestException('Escalation failed');
    }

    await this.invalidateConversationCaches(conversationId);

    this.eventEmitter.emit(
      SYSTEM_EVENTS.CONVERSATION_ESCALATED,
      new ConversationEscalatedEvent(conversationId, conversation.toObject()),
    );

    this.logger.log(`Conversation ${conversationId} escalated AI → HUMAN`);
    return conversation;
  }

  async resolve(
    conversationId: string,
    userId: string,
    userRole: UserRole,
  ): Promise<ConversationDocument> {
    const ownershipFilter: Record<string, unknown> =
      userRole === UserRole.PATIENT
        ? { patient: new Types.ObjectId(userId) }
        : userRole === UserRole.AGENT
          ? { agent: new Types.ObjectId(userId) }
          : {};

    const conversation = await this.conversationModel.findOneAndUpdate(
      {
        _id: conversationId,
        status: { $ne: ConversationStatus.RESOLVED },
        ...ownershipFilter,
      },
      {
        $set: {
          status: ConversationStatus.RESOLVED,
          resolvedAt: new Date(),
        },
      },
      { new: true },
    );

    if (!conversation) {
      const existing = await this.conversationModel.findById(conversationId);
      if (!existing) throw new NotFoundException('Conversation not found');
      if (existing.status === ConversationStatus.RESOLVED) return existing;
      throw new ForbiddenException(
        'Not authorized to resolve this conversation',
      );
    }

    // Counter updates should not block resolve success.
    if (conversation.agent) {
      await this.usersService
        .incrementActiveConversations(conversation.agent.toString(), -1)
        .catch((err: Error) =>
          this.logger.warn(`Failed to decrement agent counter: ${err.message}`),
        );
    }

    await this.invalidateConversationCaches(conversationId);

    this.eventEmitter.emit(
      SYSTEM_EVENTS.CONVERSATION_RESOLVED,
      new ConversationResolvedEvent(conversationId),
    );

    this.logger.log(`Conversation ${conversationId} resolved`);
    return conversation;
  }

  async transfer(
    conversationId: string,
    currentAgentId: string,
    dto: TransferConversationDto,
  ): Promise<ConversationDocument> {
    if (dto.targetAgentId === currentAgentId) {
      throw new BadRequestException('Cannot transfer to yourself');
    }

    const targetAgent = await this.usersService.findById(dto.targetAgentId);
    if (!targetAgent || targetAgent.role !== UserRole.AGENT) {
      throw new NotFoundException('Target agent not found');
    }

    const conversation = await this.conversationModel.findOneAndUpdate(
      {
        _id: conversationId,
        agent: new Types.ObjectId(currentAgentId),
        status: {
          $in: [ConversationStatus.ASSIGNED, ConversationStatus.IN_PROGRESS],
        },
      },
      {
        $set: {
          agent: new Types.ObjectId(dto.targetAgentId),
          status: ConversationStatus.IN_PROGRESS,
        },
        $push: {
          handoffHistory: {
            from: new Types.ObjectId(currentAgentId),
            to: new Types.ObjectId(dto.targetAgentId),
            reason: dto.reason ?? 'No reason provided',
            at: new Date(),
          },
        },
      },
      { new: true },
    );

    if (!conversation) {
      const existing = await this.conversationModel.findById(conversationId);
      if (!existing) throw new NotFoundException('Conversation not found');
      if (existing.agent?.toString() !== currentAgentId)
        throw new ForbiddenException('Not assigned to this conversation');
      throw new BadRequestException(
        'Transfer failed — conversation state changed',
      );
    }

    // Counter updates should not block transfer success.
    await this.usersService
      .incrementActiveConversations(currentAgentId, -1)
      .catch((err: Error) =>
        this.logger.warn(`Failed to decrement agent counter: ${err.message}`),
      );
    await this.usersService
      .incrementActiveConversations(dto.targetAgentId, 1)
      .catch((err: Error) =>
        this.logger.warn(`Failed to increment agent counter: ${err.message}`),
      );

    await this.invalidateConversationCaches(conversationId);

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
    await this.invalidateConversationCaches(conversationId);
  }

  async updateSummary(conversationId: string, summary: string): Promise<void> {
    await this.conversationModel.findByIdAndUpdate(conversationId, { summary });
    await this.invalidateConversationCaches(conversationId);
  }

  async updateLanguage(
    conversationId: string,
    language: string,
  ): Promise<void> {
    await this.conversationModel.findByIdAndUpdate(conversationId, {
      language,
    });
    await this.invalidateConversationCaches(conversationId);
  }

  /** Returns true if the user is the patient or assigned agent. */
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
