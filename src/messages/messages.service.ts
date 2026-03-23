import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Message, MessageDocument } from './schemas/message.schema.js';
import { CreateMessageDto } from './dto/create-message.dto.js';
import {
  SenderRole,
  ConversationChannel,
} from '../common/constants.js';
import { AiService } from '../ai/ai.service.js';
import { AnalysisResultDto } from '../ai/dto/ai-result.dto.js';
import { ConversationsService } from '../conversations/conversations.service.js';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    private aiService: AiService,
    private conversationsService: ConversationsService,
  ) {}

  /**
   * Handles the full message flow:
   * 1. Save patient message
   * 2. Analyze via AI
   * 3. If AI channel → generate AI response
   * 4. If Human channel → update priority and queue (Phase 2)
   */
  async createPatientMessage(
    conversationId: string,
    senderId: string,
    dto: CreateMessageDto,
  ) {
    const conversation =
      await this.conversationsService.findById(conversationId);

    // 1. Save the patient's message
    const patientMessage = await this.saveMessage({
      conversation: conversationId,
      sender: senderId,
      senderRole: SenderRole.PATIENT,
      content: dto.content,
    });

    // 2. Analyze the message with AI
    const analysis = await this.aiService.analyzeMessage(dto.content);

    // Update the message with analysis
    patientMessage.analysis = analysis;
    await patientMessage.save();

    // Update conversation priority & category based on analysis
    await this.conversationsService.updatePriority(
      conversationId,
      analysis.priority,
      analysis.intent,
    );

    // 3. Route based on channel
    if (conversation.channel === ConversationChannel.AI) {
      return this.handleAiChannel(conversationId, dto.content, analysis, patientMessage);
    } else {
      // HUMAN channel – message is saved and analyzed
      // Queue integration will be added in Phase 2
      this.logger.log(
        `Message queued for human support: conversation=${conversationId}, ` +
          `priority=${analysis.priority}`,
      );
      return {
        patientMessage,
        analysis,
        channel: ConversationChannel.HUMAN,
        status: 'queued_for_agent',
      };
    }
  }

  /**
   * Handles agent reply to a patient message.
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

    this.logger.log(
      `Agent ${agentId} replied in conversation ${conversationId}`,
    );

    // Evaluation will be triggered in Phase 2
    return agentMessage;
  }

  /**
   * Get all messages for a conversation.
   */
  async findByConversation(conversationId: string): Promise<MessageDocument[]> {
    return this.messageModel
      .find({ conversation: new Types.ObjectId(conversationId) })
      .sort({ createdAt: 1 })
      .populate('sender', 'name email role')
      .exec();
  }

  /**
   * Get AI assistance for a conversation (summary + suggested reply).
   */
  async getAiAssistance(conversationId: string) {
    const messages = await this.findByConversation(conversationId);

    const conversationHistory = messages
      .map((m) => {
        const role = m.senderRole.toUpperCase();
        return `[${role}]: ${m.content}`;
      })
      .join('\n');

    return this.aiService.generateAgentAssistance(conversationHistory);
  }

  // ─────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────

  private async handleAiChannel(
    conversationId: string,
    patientContent: string,
    analysis: AnalysisResultDto,
    patientMessage: MessageDocument,
  ) {
    // Generate AI response
    const aiResponseText = await this.aiService.generateResponse(
      patientContent,
      analysis,
    );

    // Save AI response as a message
    const aiMessage = await this.saveMessage({
      conversation: conversationId,
      senderRole: SenderRole.AI,
      content: aiResponseText,
    });

    this.logger.log(
      `AI responded in conversation ${conversationId} ` +
        `(escalate=${analysis.shouldEscalate})`,
    );

    return {
      patientMessage,
      analysis,
      aiResponse: aiMessage,
      channel: ConversationChannel.AI,
    };
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
