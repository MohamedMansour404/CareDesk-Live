import { Process, Processor, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { QUEUE_NAMES } from '../../common/constants.js';
import { logWithContext } from '../../common/utils/log-with-context.js';
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
  correlationId?: string;
  enqueuedAt: string;
}

@Injectable()
@Processor(QUEUE_NAMES.MESSAGE_PROCESSING)
export class MessageProcessor {
  private readonly logger = new Logger(MessageProcessor.name);

  // SLA thresholds per priority level
  private readonly SLA_THRESHOLDS = {
    high: 2 * 60_000,    // 2 minutes for high priority
    medium: 5 * 60_000,  // 5 minutes for medium
    low: 15 * 60_000,    // 15 minutes for low
  };

  constructor(
    @InjectModel(Conversation.name)
    private conversationModel: Model<ConversationDocument>,
  ) {}

  @Process('process-message')
  async handleMessage(job: Job<MessageJobData>): Promise<void> {
    const { conversationId, messageId, priority, intent, enqueuedAt, correlationId } = job.data;
    const waitTime = Date.now() - new Date(enqueuedAt).getTime();

    const ctx = { correlationId, conversationId, messageId, jobId: job.id };

    // ── SLA Check ────────────────────────────────────────
    const threshold = this.SLA_THRESHOLDS[priority as keyof typeof this.SLA_THRESHOLDS]
      ?? this.SLA_THRESHOLDS.medium;
    const slaBreached = waitTime > threshold;

    if (slaBreached) {
      logWithContext(this.logger, 'warn',
        `SLA BREACH: priority=${priority}, waitTime=${waitTime}ms, threshold=${threshold}ms`, ctx);

      // Auto-escalate priority if SLA is breached and conversation is still pending
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
        logWithContext(this.logger, 'log',
          'Auto-escalated to HIGH priority (SLA breach)', ctx);
      }
    }

    // ── Metrics Logging ──────────────────────────────────
    logWithContext(this.logger, 'log',
      `Processed: priority=${priority}, intent=${intent}, waitTime=${waitTime}ms, sla=${slaBreached ? 'BREACH' : 'OK'}`,
      ctx);
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
  onFailed(job: Job<MessageJobData>, error: Error) {
    const attempts = job.attemptsMade;
    const maxAttempts = job.opts?.attempts ?? 3;

    const ctx = {
      correlationId: job.data.correlationId,
      conversationId: job.data.conversationId,
      messageId: job.data.messageId,
      jobId: job.id,
    };

    logWithContext(this.logger, 'error',
      `Job FAILED (${attempts}/${maxAttempts}): ${error.message}`, ctx);

    // If all retries exhausted → DLQ candidate
    if (attempts >= maxAttempts) {
      logWithContext(this.logger, 'error',
        'DLQ: All retries exhausted. Job remains for manual inspection.', ctx);
    }
  }
}
