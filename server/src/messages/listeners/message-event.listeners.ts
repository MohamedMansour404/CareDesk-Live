import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConversationChannel,
  MessageIntent,
  MessagePriority,
  SenderRole,
} from '../../common/constants.js';
import { sanitizeForPrompt } from '../../common/utils/sanitize.js';
import {
  logWithContext,
  LogContext,
} from '../../common/utils/log-with-context.js';
import {
  SYSTEM_EVENTS,
  MessageQueueFailedEvent,
} from '../../common/events/index.js';
import { MessageProcessingService } from './services/message-processing.service.js';
import { IdempotencyService } from '../../common/services/idempotency.service.js';
import { QueueService } from '../../queue/queue.service.js';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * Handles async processing for newly created patient messages.
 * AI-generated messages are ignored to prevent loops.
 */
@Injectable()
export class MessageEventListeners {
  private readonly logger = new Logger(MessageEventListeners.name);

  constructor(
    private readonly messageProcessingService: MessageProcessingService,
    private readonly idempotencyService: IdempotencyService,
    private readonly queueService: QueueService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(SYSTEM_EVENTS.MESSAGE_CREATED, { async: true })
  async handleMessageCreated(event: {
    conversationId: string;
    messageId: string;
    senderId: string;
    senderRole: SenderRole;
    content: string;
    channel: ConversationChannel;
    messageData: unknown;
    correlationId?: string;
  }) {
    // Ignore AI-generated messages to prevent loops.
    if (event.senderRole !== SenderRole.PATIENT) {
      return;
    }

    // Shared log context for this message flow.
    const ctx: LogContext = {
      correlationId: event.correlationId,
      conversationId: event.conversationId,
      messageId: event.messageId,
      channel: event.channel,
    };

    const maxAttempts = 3;
    const sanitized = sanitizeForPrompt(event.content);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const startTime = Date.now();
      try {
        const result = await this.idempotencyService.runOnce(
          'message-created-event',
          event.messageId,
          {
            lockTtlSeconds: 60,
            completionTtlSeconds: 24 * 60 * 60,
          },
          async () => {
            const PROCESSING_TIMEOUT_MS = 45_000;
            const processPromise = this.messageProcessingService.processMessage(
              event,
              sanitized,
              ctx,
            );
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      `Processing timeout after ${PROCESSING_TIMEOUT_MS}ms`,
                    ),
                  ),
                PROCESSING_TIMEOUT_MS,
              ),
            );

            await Promise.race([processPromise, timeoutPromise]);
          },
        );

        if (!result.executed) {
          logWithContext(
            this.logger,
            'warn',
            `Duplicate message event skipped (${result.reason})`,
            ctx,
          );
          return;
        }

        logWithContext(this.logger, 'log', 'AI processing complete', {
          ...ctx,
          duration: Date.now() - startTime,
          attempt,
        });

        return;
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);

        logWithContext(
          this.logger,
          'error',
          `Processing failed (attempt ${attempt}/${maxAttempts}): ${errMsg}`,
          ctx,
        );

        if (attempt < maxAttempts) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(attempt * 1000, 3000)),
          );
          continue;
        }

        await this.queueService.addToDlq({
          originalJobId: `listener:${event.messageId}`,
          reason: errMsg,
          attemptsMade: maxAttempts,
          payload: {
            conversationId: event.conversationId,
            messageId: event.messageId,
            patientId: event.senderId,
            priority: MessagePriority.MEDIUM,
            intent: MessageIntent.GENERAL,
            idempotencyKey: `queue:message:${event.messageId}`,
            correlationId: event.correlationId,
          },
        });

        this.eventEmitter.emit(
          SYSTEM_EVENTS.MESSAGE_QUEUE_FAILED,
          new MessageQueueFailedEvent(
            event.conversationId,
            event.messageId,
            errMsg,
            event.correlationId,
          ),
        );
      }
    }
  }
}
