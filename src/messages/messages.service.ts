import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Model, Types } from 'mongoose';
import { Message, MessageDocument } from './schemas/message.schema.js';
import { CreateMessageDto } from './dto/create-message.dto.js';
import {
  SenderRole,
  ConversationChannel,
} from '../common/constants.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { PaginatedResult } from '../common/dto/pagination.dto.js';
import {
  SYSTEM_EVENTS,
  MessageCreatedEvent,
  AgentRepliedEvent,
} from '../common/events/index.js';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    private conversationsService: ConversationsService,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Patient message flow (async AI):
   * 1. Save patient message
   * 2. Return immediately
   * 3. Emit event → AI processing happens in background
   */
  async createPatientMessage(
    conversationId: string,
    senderId: string,
    dto: CreateMessageDto,
  ) {
    const conversation =
      await this.conversationsService.findById(conversationId);

    // 1. Save the patient's message immediately
    const patientMessage = await this.saveMessage({
      conversation: conversationId,
      sender: senderId,
      senderRole: SenderRole.PATIENT,
      content: dto.content,
    });

    // 2. Emit event for async processing (AI analysis, queue, WebSocket)
    this.eventEmitter.emit(
      SYSTEM_EVENTS.MESSAGE_CREATED,
      new MessageCreatedEvent(
        conversationId,
        patientMessage._id.toString(),
        senderId,
        SenderRole.PATIENT,
        dto.content,
        conversation.channel,
        patientMessage.toObject(),
      ),
    );

    this.logger.log(
      `Patient message saved: conversation=${conversationId}, processing async`,
    );

    // 3. Return immediately — AI results delivered via WebSocket
    return {
      message: patientMessage,
      status: 'processing',
      channel: conversation.channel,
    };
  }

  /**
   * Agent reply — save and emit event for auto-evaluation.
   */
  async createAgentMessage(
    conversationId: string,
    agentId: string,
    dto: CreateMessageDto,
  ) {
    const agentMessage = await this.saveMessage({
      conversation: conversationId,
      sender: agentId,
      senderRole: SenderRole.AGENT,
      content: dto.content,
    });

    // Emit event — evaluation + WebSocket handled by listeners
    this.eventEmitter.emit(
      SYSTEM_EVENTS.MESSAGE_AGENT_REPLIED,
      new AgentRepliedEvent(
        conversationId,
        agentId,
        agentMessage._id.toString(),
        dto.content,
        agentMessage.toObject(),
      ),
    );

    this.logger.log(
      `Agent ${agentId} replied in conversation ${conversationId}`,
    );

    return agentMessage;
  }

  /**
   * Get paginated messages for a conversation.
   */
  async findByConversation(
    conversationId: string,
    page = 1,
    limit = 50,
  ): Promise<PaginatedResult<MessageDocument>> {
    const filter = { conversation: new Types.ObjectId(conversationId) };
    const total = await this.messageModel.countDocuments(filter);

    const data = await this.messageModel
      .find(filter)
      .sort({ createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('sender', 'name email role')
      .exec();

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find messages by conversation (unpaginated, for internal use).
   */
  async findAllByConversation(
    conversationId: string,
  ): Promise<MessageDocument[]> {
    return this.messageModel
      .find({ conversation: new Types.ObjectId(conversationId) })
      .sort({ createdAt: 1 })
      .populate('sender', 'name email role')
      .exec();
  }

  /**
   * Find last patient message before a given message ID.
   */
  async findLastPatientMessage(
    conversationId: string,
    beforeMessageId: string,
  ): Promise<MessageDocument | null> {
    return this.messageModel
      .findOne({
        conversation: new Types.ObjectId(conversationId),
        senderRole: SenderRole.PATIENT,
        _id: { $lt: new Types.ObjectId(beforeMessageId) },
      })
      .sort({ _id: -1 })
      .exec();
  }

  /**
   * Update a message with AI analysis result.
   */
  async updateAnalysis(
    messageId: string,
    analysis: Record<string, unknown>,
  ): Promise<void> {
    await this.messageModel.findByIdAndUpdate(messageId, { analysis });
  }

  /**
   * Save an AI response message.
   */
  async saveAiResponse(
    conversationId: string,
    content: string,
  ): Promise<MessageDocument> {
    return this.saveMessage({
      conversation: conversationId,
      senderRole: SenderRole.AI,
      content,
    });
  }

  private async saveMessage(data: {
    conversation: string;
    sender?: string;
    senderRole: SenderRole;
    content: string;
  }): Promise<MessageDocument> {
    const message = new this.messageModel({
      conversation: new Types.ObjectId(data.conversation),
      sender: data.sender ? new Types.ObjectId(data.sender) : undefined,
      senderRole: data.senderRole,
      content: data.content,
    });

    return message.save();
  }
}
