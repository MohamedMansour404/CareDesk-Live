import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MessagePriority } from '../../../common/constants.js';
import {
  SYSTEM_EVENTS,
  MessageQueueFailedEvent,
} from '../../../common/events/index.js';
import {
  LogContext,
  logWithContext,
} from '../../../common/utils/log-with-context.js';
import { QueueService } from '../../../queue/queue.service.js';

export interface QueueRetryPayload {
  conversationId: string;
  messageId: string;
  patientId: string;
  priority: MessagePriority;
  intent: string;
  idempotencyKey?: string;
  correlationId?: string;
}

@Injectable()
export class MessageQueueRetryService {
  private readonly logger = new Logger(MessageQueueRetryService.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async enqueueWithRetry(
    data: QueueRetryPayload,
    ctx: LogContext,
  ): Promise<void> {
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.queueService.addToQueue(data);
        return;
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logWithContext(
          this.logger,
          'error',
          `Queue addToQueue failed (attempt ${attempt}/${maxAttempts}): ${errMsg}`,
          ctx,
        );

        if (attempt === maxAttempts) {
          this.eventEmitter.emit(
            SYSTEM_EVENTS.MESSAGE_QUEUE_FAILED,
            new MessageQueueFailedEvent(
              data.conversationId,
              data.messageId,
              errMsg,
              data.correlationId,
            ),
          );

          throw new Error(
            `Queue enqueue failed after ${maxAttempts} attempts: ${errMsg}`,
          );
        }

        const backoffMs = attempt * 1000;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }
}
