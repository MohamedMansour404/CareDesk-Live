import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Conversation,
  ConversationDocument,
} from './schemas/conversation.schema.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import {
  ConversationChannel,
  ConversationStatus,
  MessagePriority,
  MessageIntent,
  UserRole,
} from '../common/constants.js';
import { UsersService } from '../users/users.service.js';

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @InjectModel(Conversation.name)
    private conversationModel: Model<ConversationDocument>,
    private usersService: UsersService,
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

  async findByPatient(patientId: string): Promise<ConversationDocument[]> {
    return this.conversationModel
      .find({ patient: new Types.ObjectId(patientId) })
      .sort({ createdAt: -1 })
      .populate('agent', 'name email specialization')
      .exec();
  }

  async findPendingByPriority(): Promise<ConversationDocument[]> {
    return this.conversationModel
      .find({
        channel: ConversationChannel.HUMAN,
        status: {
          $in: [ConversationStatus.PENDING, ConversationStatus.ASSIGNED],
        },
      })
      .sort({
        priority: 1, // high first (we'll use a custom sort)
        createdAt: 1, // oldest first within same priority
      })
      .populate('patient', 'name email')
      .exec();
  }

  async assignAgent(
    conversationId: string,
    agentId: string,
  ): Promise<ConversationDocument> {
    const conversation = await this.conversationModel.findById(conversationId);
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
    const updated = await conversation.save();

    await this.usersService.incrementActiveConversations(agentId, 1);
    this.logger.log(
      `Conversation ${conversationId} assigned to agent ${agentId}`,
    );

    return updated;
  }

  async resolve(
    conversationId: string,
    userId: string,
    userRole: UserRole,
  ): Promise<ConversationDocument> {
    const conversation = await this.conversationModel.findById(conversationId);
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
    const updated = await conversation.save();

    if (conversation.agent) {
      await this.usersService.incrementActiveConversations(
        conversation.agent.toString(),
        -1,
      );
    }

    this.logger.log(`Conversation ${conversationId} resolved`);
    return updated;
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
}
