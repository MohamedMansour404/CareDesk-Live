import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiService } from '../../../ai/ai.service.js';
import { ConversationsService } from '../../../conversations/conversations.service.js';
import { ConversationChannel } from '../../../common/constants.js';
import {
  SYSTEM_EVENTS,
  AiProcessingCompleteEvent,
} from '../../../common/events/index.js';
import {
  LogContext,
  logWithContext,
} from '../../../common/utils/log-with-context.js';
import { MessagesService } from '../../messages.service.js';
import { MessageQueueRetryService } from './message-queue-retry.service.js';

interface MessageProcessingEvent {
  conversationId: string;
  messageId: string;
  senderId: string;
  channel: ConversationChannel;
  correlationId?: string;
}

@Injectable()
export class MessageProcessingService {
  private readonly logger = new Logger(MessageProcessingService.name);

  constructor(
    private readonly aiService: AiService,
    private readonly messagesService: MessagesService,
    private readonly conversationsService: ConversationsService,
    private readonly queueRetryService: MessageQueueRetryService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async processMessage(
    event: MessageProcessingEvent,
    sanitized: string,
    ctx: LogContext,
  ): Promise<void> {
    if (event.channel === ConversationChannel.AI) {
      logWithContext(
        this.logger,
        'log',
        'AI_CALL_TRIGGER: invoking analyzeAndRespond once for patient message',
        ctx,
      );

      const { analysis, response: aiResponseText } =
        await this.aiService.analyzeAndRespond(sanitized);

      await this.messagesService.updateAnalysis(
        event.messageId,
        analysis as unknown as Record<string, unknown>,
      );

      await this.conversationsService.updatePriority(
        event.conversationId,
        analysis.priority,
        analysis.intent,
      );

      if (analysis.detectedLanguage) {
        await this.conversationsService.updateLanguage(
          event.conversationId,
          analysis.detectedLanguage,
        );
      }

      const aiMessage = await this.messagesService.saveAiResponse(
        event.conversationId,
        aiResponseText,
      );

      this.eventEmitter.emit(
        SYSTEM_EVENTS.MESSAGE_AI_PROCESSING_COMPLETE,
        new AiProcessingCompleteEvent(
          event.conversationId,
          event.messageId,
          analysis,
          aiMessage.toObject(),
          ConversationChannel.AI,
          event.correlationId,
        ),
      );

      return;
    }

    logWithContext(
      this.logger,
      'log',
      'AI_CALL_TRIGGER: invoking analyzeMessage once for patient message',
      ctx,
    );

    const analysis = await this.aiService.analyzeMessage(sanitized);

    await this.messagesService.updateAnalysis(
      event.messageId,
      analysis as unknown as Record<string, unknown>,
    );

    await this.conversationsService.updatePriority(
      event.conversationId,
      analysis.priority,
      analysis.intent,
    );

    if (analysis.detectedLanguage) {
      await this.conversationsService.updateLanguage(
        event.conversationId,
        analysis.detectedLanguage,
      );
    }

    await this.queueRetryService.enqueueWithRetry(
      {
        conversationId: event.conversationId,
        messageId: event.messageId,
        patientId: event.senderId,
        priority: analysis.priority,
        intent: analysis.intent,
        idempotencyKey: `queue:message:${event.messageId}`,
        correlationId: event.correlationId,
      },
      ctx,
    );

    this.eventEmitter.emit(
      SYSTEM_EVENTS.MESSAGE_AI_PROCESSING_COMPLETE,
      new AiProcessingCompleteEvent(
        event.conversationId,
        event.messageId,
        analysis,
        undefined,
        ConversationChannel.HUMAN,
        event.correlationId,
      ),
    );
  }
}
