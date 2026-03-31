import {
  Process,
  Processor,
  OnQueueFailed,
  OnQueueCompleted,
} from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { QUEUE_NAMES, MessagePriority } from '../../common/constants.js';
import { logWithContext } from '../../common/utils/log-with-context.js';
import { QueueService } from '../queue.service.js';
import { IdempotencyService } from '../../common/services/idempotency.service.js';
import {
  Conversation,
  ConversationDocument,
} from '../../conversations/schemas/conversation.schema.js';

export interface MessageJobData {
  conversationId: string;
  messageId: string;
  patientId: string;
  intent: string;
  priority: string;
  idempotencyKey?: string;
  correlationId?: string;
  enqueuedAt: string;
}

@Injectable()
@Processor(QUEUE_NAMES.MESSAGE_PROCESSING)
export class MessageProcessor {
  private readonly logger = new Logger(MessageProcessor.name);

  // SLA thresholds per priority level
  private readonly SLA_THRESHOLDS = {
    high: 2 * 60_000, // 2 minutes for high priority
    medium: 5 * 60_000, // 5 minutes for medium
    low: 15 * 60_000, // 15 minutes for low
  };

  constructor(
    @InjectModel(Conversation.name)
    private conversationModel: Model<ConversationDocument>,
    private queueService: QueueService,
    private idempotencyService: IdempotencyService,
  ) {}

  @Process('process-message')
  async handleMessage(job: Job<MessageJobData>): Promise<void> {
    const {
      conversationId,
      messageId,
      priority,
      intent,
      enqueuedAt,
      correlationId,
    } = job.data;
    const waitTime = Date.now() - new Date(enqueuedAt).getTime();
    const idempotencyKey =
      job.data.idempotencyKey ?? `queue:message:${messageId}`;

    const ctx = { correlationId, conversationId, messageId, jobId: job.id };

    const onceResult = await this.idempotencyService.runOnce(
      'queue-message-processing',
      idempotencyKey,
      {
        lockTtlSeconds: 120,
        completionTtlSeconds: 24 * 60 * 60,
      },
      async () => {
        const threshold =
          this.SLA_THRESHOLDS[priority as keyof typeof this.SLA_THRESHOLDS] ??
          this.SLA_THRESHOLDS.medium;
        const slaBreached = waitTime > threshold;

        if (slaBreached) {
          logWithContext(
            this.logger,
            'warn',
            `SLA BREACH: priority=${priority}, waitTime=${waitTime}ms, threshold=${threshold}ms`,
            ctx,
          );

          if (priority !== 'high') {
            await this.conversationModel.findOneAndUpdate(
              {
                _id: new Types.ObjectId(conversationId),
                status: 'pending',
              },
              {
                $set: { priority: 'high' },
              },
            );
            logWithContext(
              this.logger,
              'log',
              'Auto-escalated to HIGH priority (SLA breach)',
              ctx,
            );
          }
        }

        logWithContext(
          this.logger,
          'log',
          `Processed: priority=${priority}, intent=${intent}, waitTime=${waitTime}ms, sla=${slaBreached ? 'BREACH' : 'OK'}`,
          ctx,
        );
      },
    );

    if (!onceResult.executed) {
      logWithContext(
        this.logger,
        'warn',
        `Skipped duplicate queue processing (${onceResult.reason})`,
        ctx,
      );
    }
  }

  @OnQueueCompleted()
  onCompleted(job: Job<MessageJobData>) {
    logWithContext(this.logger, 'debug', 'Job completed', {
      correlationId: job.data.correlationId,
      messageId: job.data.messageId,
      jobId: job.id,
    });
  }

  @OnQueueFailed()
  async onFailed(job: Job<MessageJobData>, error: Error) {
    const attempts = job.attemptsMade;
    const maxAttempts = job.opts?.attempts ?? 3;

    const ctx = {
      correlationId: job.data.correlationId,
      conversationId: job.data.conversationId,
      messageId: job.data.messageId,
      jobId: job.id,
    };

    logWithContext(
      this.logger,
      'error',
      `Job FAILED (${attempts}/${maxAttempts}): ${error.message}`,
      ctx,
    );

    // Move to DLQ after all retries are exhausted.
    if (attempts >= maxAttempts) {
      logWithContext(
        this.logger,
        'error',
        'DLQ: All retries exhausted. Job remains for manual inspection.',
        ctx,
      );

      try {
        await this.queueService.addToDlq({
          originalJobId: String(job.id),
          reason: error.message,
          attemptsMade: attempts,
          payload: {
            conversationId: job.data.conversationId,
            messageId: job.data.messageId,
            patientId: job.data.patientId,
            priority: job.data.priority as MessagePriority,
            intent: job.data.intent,
            idempotencyKey:
              job.data.idempotencyKey ?? `queue:message:${job.data.messageId}`,
            correlationId: job.data.correlationId,
          },
        });
      } catch (dlqError: unknown) {
        const dlqErrMsg =
          dlqError instanceof Error ? dlqError.message : String(dlqError);
        logWithContext(
          this.logger,
          'error',
          `DLQ enqueue failed: ${dlqErrMsg}`,
          ctx,
        );
      }
    }
  }
}
