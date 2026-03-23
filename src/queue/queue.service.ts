import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, PRIORITY_MAP, MessagePriority } from '../common/constants.js';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.MESSAGE_PROCESSING) private readonly messageQueue: Queue,
  ) {}

  /**
   * Add a message to the priority queue for human support processing.
   */
  async addToQueue(data: {
    conversationId: string;
    messageId: string;
    patientId: string;
    priority: MessagePriority;
    intent: string;
  }): Promise<void> {
    const bullPriority = PRIORITY_MAP[data.priority] ?? PRIORITY_MAP[MessagePriority.MEDIUM];

    await this.messageQueue.add(
      'process-message',
      {
        conversationId: data.conversationId,
        messageId: data.messageId,
        patientId: data.patientId,
        intent: data.intent,
        priority: data.priority,
        enqueuedAt: new Date().toISOString(),
      },
      {
        priority: bullPriority,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );

    this.logger.log(
      `Message queued: conversation=${data.conversationId}, ` +
        `priority=${data.priority} (bull=${bullPriority})`,
    );
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
}
