import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../common/constants.js';

export interface MessageJobData {
  conversationId: string;
  messageId: string;
  patientId: string;
  intent: string;
  priority: string;
  enqueuedAt: string;
}

@Processor(QUEUE_NAMES.MESSAGE_PROCESSING)
export class MessageProcessor {
  private readonly logger = new Logger(MessageProcessor.name);

  @Process('process-message')
  async handleMessage(job: Job<MessageJobData>): Promise<void> {
    const { conversationId, messageId, priority, intent, enqueuedAt } = job.data;
    const waitTime = Date.now() - new Date(enqueuedAt).getTime();

    this.logger.log(
      `Processing message: conversation=${conversationId}, ` +
        `message=${messageId}, priority=${priority}, ` +
        `intent=${intent}, waitTime=${waitTime}ms`,
    );

    // The message is already saved in DB and analyzed.
    // The processor's job is to:
    // 1. Emit WebSocket event for real-time dashboard update (done via gateway)
    // 2. Log processing metrics
    // 3. Potentially trigger additional processing in the future

    // WebSocket emission will be handled by the gateway module
    // which listens to BullMQ events. For now, processing is logged.

    this.logger.log(
      `Message processed successfully: ${messageId} (waited ${waitTime}ms)`,
    );
  }
}
