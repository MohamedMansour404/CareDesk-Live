import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Message,
  MessageDocument,
} from '../../messages/schemas/message.schema.js';
import { EvaluationService } from '../evaluation.service.js';
import { SenderRole } from '../../common/constants.js';
import {
  SYSTEM_EVENTS,
  AgentRepliedEvent,
  EvaluationCreatedEvent,
} from '../../common/events/index.js';

/**
 * Listens for agent replies and triggers auto-evaluation.
 * Fully decoupled from MessagesService.
 */
@Injectable()
export class EvaluationEventListeners {
  private readonly logger = new Logger(EvaluationEventListeners.name);

  constructor(
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    private evaluationService: EvaluationService,
    private eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(SYSTEM_EVENTS.MESSAGE_AGENT_REPLIED, { async: true })
  async handleAgentReplied(event: AgentRepliedEvent) {
    try {
      // Find the last patient message before this agent reply
      const lastPatientMessage = await this.messageModel
        .findOne({
          conversation: new Types.ObjectId(event.conversationId),
          senderRole: SenderRole.PATIENT,
          _id: { $lt: new Types.ObjectId(event.agentMessageId) },
        })
        .sort({ _id: -1 })
        .exec();

      if (!lastPatientMessage) {
        this.logger.debug('No patient message found for evaluation – skipping');
        return;
      }

      const evaluation = await this.evaluationService.evaluateAgentResponse(
        event.conversationId,
        event.agentId,
        lastPatientMessage._id.toString(),
        event.agentMessageId,
        lastPatientMessage.content,
        event.content,
      );

      // Emit evaluation event → WebSocket gateway broadcasts
      this.eventEmitter.emit(
        SYSTEM_EVENTS.EVALUATION_CREATED,
        new EvaluationCreatedEvent(event.conversationId, evaluation.toObject()),
      );

      this.logger.log(
        `Auto-evaluation triggered for conversation ${event.conversationId}: score=${evaluation.score}`,
      );
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Auto-evaluation failed for conversation ${event.conversationId}: ${errMsg}`,
      );
    }
  }
}
