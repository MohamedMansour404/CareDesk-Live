import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AiService } from '../../ai/ai.service.js';
import { MessagesService } from '../messages.service.js';
import { ConversationsService } from '../../conversations/conversations.service.js';
import { QueueService } from '../../queue/queue.service.js';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConversationChannel } from '../../common/constants.js';
import { sanitizeForPrompt } from '../../common/utils/sanitize.js';
import {
  SYSTEM_EVENTS,
  MessageCreatedEvent,
  AiProcessingCompleteEvent,
} from '../../common/events/index.js';

/**
 * Handles message lifecycle events:
 * - AI analysis (async, after message saved)
 * - Queue routing (human channel)
 * - AI response generation (AI channel)
 */
@Injectable()
export class MessageEventListeners {
  private readonly logger = new Logger(MessageEventListeners.name);

  constructor(
    private aiService: AiService,
    private messagesService: MessagesService,
    private conversationsService: ConversationsService,
    private queueService: QueueService,
    private eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(SYSTEM_EVENTS.MESSAGE_CREATED, { async: true })
  async handleMessageCreated(event: MessageCreatedEvent) {
    try {
      // 1. Sanitize content and run AI analysis
      const sanitized = sanitizeForPrompt(event.content);
      const analysis = await this.aiService.analyzeMessage(sanitized);

      // 2. Update message with analysis
      await this.messagesService.updateAnalysis(event.messageId, analysis as unknown as Record<string, unknown>);

      // 3. Update conversation priority
      await this.conversationsService.updatePriority(
        event.conversationId,
        analysis.priority,
        analysis.intent,
      );

      // 4. Update conversation language if detected
      if (analysis.detectedLanguage) {
        await this.conversationsService.updateLanguage(
          event.conversationId,
          analysis.detectedLanguage,
        );
      }

      // 5. Route based on channel
      if (event.channel === ConversationChannel.AI) {
        // Generate AI response
        const aiResponseText = await this.aiService.generateResponse(
          sanitized,
          analysis,
        );
        const aiMessage = await this.messagesService.saveAiResponse(
          event.conversationId,
          aiResponseText,
        );

        // Emit completion event → WebSocket listener will broadcast
        this.eventEmitter.emit(
          SYSTEM_EVENTS.MESSAGE_AI_PROCESSING_COMPLETE,
          new AiProcessingCompleteEvent(
            event.conversationId,
            event.messageId,
            analysis,
            aiMessage.toObject(),
            ConversationChannel.AI,
          ),
        );
      } else {
        // HUMAN channel → add to priority queue
        await this.queueService.addToQueue({
          conversationId: event.conversationId,
          messageId: event.messageId,
          patientId: event.senderId,
          priority: analysis.priority,
          intent: analysis.intent,
        });

        // Emit completion event
        this.eventEmitter.emit(
          SYSTEM_EVENTS.MESSAGE_AI_PROCESSING_COMPLETE,
          new AiProcessingCompleteEvent(
            event.conversationId,
            event.messageId,
            analysis,
            undefined,
            ConversationChannel.HUMAN,
          ),
        );
      }

      this.logger.log(
        `Async AI processing complete: conversation=${event.conversationId}, ` +
          `intent=${analysis.intent}, priority=${analysis.priority}`,
      );
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Async message processing failed for ${event.messageId}: ${errMsg}`,
      );
    }
  }
}
