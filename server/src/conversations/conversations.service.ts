import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Model, Types } from 'mongoose';
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
import { CacheService } from '../common/services/cache.service.js';
import {
  SYSTEM_EVENTS,
  ConversationCreatedEvent,
  ConversationAssignedEvent,
  ConversationResolvedEvent,
  ConversationTransferredEvent,
  ConversationEscalatedEvent,
} from '../common/events/index.js';

// Cache key patterns and TTLs
const CACHE = {
  CONV: (id: string) => `conv:${id}`,
  QUEUE: (page: number, limit: number) => `conv:queue:${page}:${limit}`,
  QUEUE_PATTERN: 'conv:queue:*',
  TTL_CONV: 30,      // 30s for individual conversations
  TTL_QUEUE: 10,     // 10s for queue list (agents need fresh data)
};

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @InjectModel(Conversation.name)
    private conversationModel: Model<ConversationDocument>,
    private usersService: UsersService,
    private eventEmitter: EventEmitter2,
    private cacheService: CacheService,
  ) {}

  /**
   * Invalidate caches related to a conversation mutation.
   */
  private async invalidateConversationCaches(conversationId: string): Promise<void> {
    await Promise.all([
      this.cacheService.invalidate(CACHE.CONV(conversationId)),
      this.cacheService.invalidatePattern(CACHE.QUEUE_PATTERN),
    ]);
  }

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

    // Invalidate queue cache (new conversation added)
    await this.cacheService.invalidatePattern(CACHE.QUEUE_PATTERN);

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
    // Check cache first
    const cached = await this.cacheService.get<ConversationDocument>(CACHE.CONV(id));
    if (cached) return cached;

    const conversation = await this.conversationModel
      .findById(id)
      .populate('patient', 'name email')
      .populate('agent', 'name email specialization');

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    // Cache the result
    await this.cacheService.set(CACHE.CONV(id), conversation.toObject(), CACHE.TTL_CONV);
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
    // Check queue cache first (short TTL for freshness)
    const cacheKey = CACHE.QUEUE(page, limit);
    const cached = await this.cacheService.get<PaginatedResult<ConversationDocument>>(cacheKey);
    if (cached) return cached;

    // Agents only see HUMAN channel conversations (AI conversations are managed by AI)
    // Include all statuses so the frontend can filter by tab (Queue/Mine/Resolved)
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

    await this.cacheService.set(cacheKey, result, CACHE.TTL_QUEUE);
    return result;
  }

  // ─────────────────────────────────────────────
  // TRANSACTIONAL OPERATIONS
  // ─────────────────────────────────────────────

  /**
   * Marks a conversation as IN_PROGRESS when an agent first replies.
   * Safe to call multiple times — only transitions from PENDING/ASSIGNED.
   */
  async markAsInProgress(
    conversationId: string,
    agentId: string,
  ): Promise<void> {
    const updated = await this.conversationModel.findOneAndUpdate(
      {
        _id: conversationId,
        status: { $in: [ConversationStatus.PENDING, ConversationStatus.ASSIGNED] },
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
      // Broadcast status change so both parties see it in real-time
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
    // First, check current state to provide meaningful errors
    const existing = await this.conversationModel.findById(conversationId);
    if (!existing) {
      throw new NotFoundException('Conversation not found');
    }

    // If already owned by a DIFFERENT agent → block (locking)
    if (
      existing.agent &&
      existing.agent.toString() !== agentId &&
      [ConversationStatus.ASSIGNED, ConversationStatus.IN_PROGRESS].includes(existing.status as ConversationStatus)
    ) {
      throw new ForbiddenException('Conversation is already assigned to another agent');
    }

    // If already owned by THIS agent → return as-is (idempotent re-click)
    if (existing.agent?.toString() === agentId) {
      return existing.populate('patient', 'name email');
    }

    // Atomic update — only PENDING conversations can be picked up
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

    // Best-effort counter update (non-critical)
    await this.usersService
      .incrementActiveConversations(agentId, 1)
      .catch((err: Error) =>
        this.logger.warn(`Failed to increment agent counter: ${err.message}`),
      );

    await this.invalidateConversationCaches(conversationId);

    // Emit event → WebSocket broadcasts to all agents
    this.eventEmitter.emit(
      SYSTEM_EVENTS.CONVERSATION_ASSIGNED,
      new ConversationAssignedEvent(conversationId, agentId),
    );

    this.logger.log(
      `Conversation ${conversationId} assigned to agent ${agentId}`,
    );
    return conversation;
  }

  /**
   * Escalate an AI conversation to human support.
   * Changes channel AI → HUMAN, status → PENDING so it enters the agent queue.
   */
  async escalateToHuman(
    conversationId: string,
    patientId: string,
  ): Promise<ConversationDocument> {
    // Atomic update — filter enforces all business rules at the DB level
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
      // Determine specific error
      const existing = await this.conversationModel.findById(conversationId);
      if (!existing) throw new NotFoundException('Conversation not found');
      if (existing.patient.toString() !== patientId)
        throw new ForbiddenException('Not your conversation');
      if (existing.channel !== ConversationChannel.AI)
        throw new BadRequestException('Only AI conversations can be escalated');
      if (existing.status === ConversationStatus.RESOLVED)
        throw new BadRequestException('Cannot escalate a resolved conversation');
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
    // Build ownership filter based on role
    const ownershipFilter: Record<string, unknown> =
      userRole === UserRole.PATIENT
        ? { patient: new Types.ObjectId(userId) }
        : userRole === UserRole.AGENT
          ? { agent: new Types.ObjectId(userId) }
          : {};

    // Atomic resolve — prevents race where two users resolve simultaneously
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
      // Check if already resolved (idempotent)
      const existing = await this.conversationModel.findById(conversationId);
      if (!existing) throw new NotFoundException('Conversation not found');
      if (existing.status === ConversationStatus.RESOLVED) return existing;
      throw new ForbiddenException('Not authorized to resolve this conversation');
    }

    // Best-effort counter update
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

    // Atomic transfer — ensures only the owning agent can transfer
    const conversation = await this.conversationModel.findOneAndUpdate(
      {
        _id: conversationId,
        agent: new Types.ObjectId(currentAgentId),
        status: { $in: [ConversationStatus.ASSIGNED, ConversationStatus.IN_PROGRESS] },
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
      throw new BadRequestException('Transfer failed — conversation state changed');
    }

    // Best-effort counter updates
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
