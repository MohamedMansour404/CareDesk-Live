import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import {
  QUEUE_NAMES,
  PRIORITY_MAP,
  MessagePriority,
} from '../common/constants.js';
import { logWithContext } from '../common/utils/log-with-context.js';
import {
  DlqJobDetailDto,
  DlqJobsResponseDto,
  DlqPayloadDto,
  DlqRetryResponseDto,
  QueueMessagePayloadDto,
} from './dto/dlq.dto.js';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private queuesClosed = false;

  constructor(
    @InjectQueue(QUEUE_NAMES.MESSAGE_PROCESSING)
    private readonly messageQueue: Queue,
    @InjectQueue('message-dlq')
    private readonly dlqQueue: Queue,
  ) {}

  /**
   * Add a message to the priority queue for human support processing.
   */
  async addToQueue(data: QueueMessagePayloadDto): Promise<void> {
    const bullPriority =
      PRIORITY_MAP[data.priority] ?? PRIORITY_MAP[MessagePriority.MEDIUM];

    await this.messageQueue.add(
      'process-message',
      {
        conversationId: data.conversationId,
        messageId: data.messageId,
        patientId: data.patientId,
        intent: data.intent,
        priority: data.priority,
        idempotencyKey: `queue:message:${data.messageId}`,
        correlationId: data.correlationId,
        enqueuedAt: new Date().toISOString(),
      },
      {
        jobId: `msg:${data.messageId}`,
        priority: bullPriority,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: false,
      },
    );

    logWithContext(
      this.logger,
      'log',
      `Message queued (bull=${bullPriority})`,
      {
        correlationId: data.correlationId,
        conversationId: data.conversationId,
        messageId: data.messageId,
      },
    );
  }

  async addToDlq(data: {
    originalJobId: string;
    reason: string;
    attemptsMade: number;
    payload: QueueMessagePayloadDto;
  }): Promise<void> {
    const dlqPayload: DlqPayloadDto = {
      originalJobId: data.originalJobId,
      reason: data.reason,
      attemptsMade: data.attemptsMade,
      failedAt: new Date().toISOString(),
      payload: data.payload,
    };

    await this.dlqQueue.add('dead-letter-message', dlqPayload, {
      jobId: `dlq:${data.payload.messageId}:${Date.now()}`,
      removeOnComplete: false,
      removeOnFail: false,
      attempts: 1,
    });

    logWithContext(this.logger, 'error', 'Message moved to DLQ', {
      correlationId: data.payload.correlationId,
      conversationId: data.payload.conversationId,
      messageId: data.payload.messageId,
      reason: data.reason,
    });
  }

  async getDlqJobs(start = 0, end = 49): Promise<DlqJobsResponseDto> {
    const [waiting, delayed, failed] = await Promise.all([
      this.dlqQueue.getWaitingCount(),
      this.dlqQueue.getDelayedCount(),
      this.dlqQueue.getFailedCount(),
    ]);

    const jobs = await this.dlqQueue.getJobs(
      ['waiting', 'delayed', 'failed'],
      start,
      end,
      true,
    );

    return {
      total: waiting + delayed + failed,
      jobs: jobs.map((job) => ({
        id: String(job.id),
        name: job.name,
        timestamp: job.timestamp,
        reason: (job.data as DlqPayloadDto).reason,
        attemptsMade: (job.data as DlqPayloadDto).attemptsMade,
        failedAt: (job.data as DlqPayloadDto).failedAt,
        payload: (job.data as DlqPayloadDto).payload,
      })),
    };
  }

  async getDlqJob(jobId: string): Promise<DlqJobDetailDto> {
    const job = await this.dlqQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException('DLQ job not found');
    }

    const state = await job.getState();
    const data = job.data as DlqPayloadDto;

    return {
      id: String(job.id),
      name: job.name,
      timestamp: job.timestamp,
      state,
      reason: data.reason,
      attemptsMade: data.attemptsMade,
      failedAt: data.failedAt,
      payload: data.payload,
    };
  }

  async retryDlqJob(jobId: string): Promise<DlqRetryResponseDto> {
    const job = await this.dlqQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException('DLQ job not found');
    }

    const data = job.data as DlqPayloadDto;
    const payload = data.payload;
    const idempotencyKey = `queue:message:${payload.messageId}`;
    const bullPriority =
      PRIORITY_MAP[payload.priority] ?? PRIORITY_MAP[MessagePriority.MEDIUM];

    await this.messageQueue.add(
      'process-message',
      {
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        patientId: payload.patientId,
        intent: payload.intent,
        priority: payload.priority,
        idempotencyKey,
        correlationId: payload.correlationId,
        enqueuedAt: new Date().toISOString(),
      },
      {
        jobId: `msg:${payload.messageId}:retry:${Date.now()}`,
        priority: bullPriority,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: false,
      },
    );

    await job.remove();

    logWithContext(this.logger, 'log', 'DLQ job retried', {
      correlationId: payload.correlationId,
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      dlqJobId: jobId,
    });

    return { retried: true, messageId: payload.messageId };
  }

  /**
   * Get queue stats for the dashboard.
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    const [waiting, active, completed, failed] = await Promise.all([
      this.messageQueue.getWaitingCount(),
      this.messageQueue.getActiveCount(),
      this.messageQueue.getCompletedCount(),
      this.messageQueue.getFailedCount(),
    ]);

    return { waiting, active, completed, failed };
  }

  async isReady(): Promise<boolean> {
    if (this.queuesClosed) {
      return false;
    }

    try {
      await Promise.all([
        this.messageQueue.getWaitingCount(),
        this.dlqQueue.getWaitingCount(),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdownGracefully('module-destroy');
  }

  async shutdownGracefully(reason: string): Promise<void> {
    await this.closeQueues(reason);
  }

  private async closeQueues(reason: string): Promise<void> {
    if (this.queuesClosed) {
      return;
    }

    this.queuesClosed = true;

    const [messageQueueResult, dlqQueueResult] = await Promise.allSettled([
      this.messageQueue.close(),
      this.dlqQueue.close(),
    ]);

    if (messageQueueResult.status === 'rejected') {
      const errMsg =
        messageQueueResult.reason instanceof Error
          ? messageQueueResult.reason.message
          : String(messageQueueResult.reason);
      this.logger.warn(`Failed to close message queue (${reason}): ${errMsg}`);
    }

    if (dlqQueueResult.status === 'rejected') {
      const errMsg =
        dlqQueueResult.reason instanceof Error
          ? dlqQueueResult.reason.message
          : String(dlqQueueResult.reason);
      this.logger.warn(`Failed to close DLQ queue (${reason}): ${errMsg}`);
    }

    this.logger.log(`Queue connections closed (${reason})`);
  }
}
