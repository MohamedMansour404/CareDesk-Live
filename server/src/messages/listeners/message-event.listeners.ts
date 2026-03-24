import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AiService } from '../../ai/ai.service.js';
import { MessagesService } from '../messages.service.js';
import { ConversationsService } from '../../conversations/conversations.service.js';
import { QueueService } from '../../queue/queue.service.js';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConversationChannel, SenderRole } from '../../common/constants.js';
import { sanitizeForPrompt } from '../../common/utils/sanitize.js';
import { TtlSet } from '../../common/utils/ttl-set.js';
import { logWithContext, LogContext } from '../../common/utils/log-with-context.js';
import {
  SYSTEM_EVENTS,
  AiProcessingCompleteEvent,
} from '../../common/events/index.js';

/**
 * Handles message lifecycle events:
 * - AI analysis (async, after message saved)
 * - Queue routing (human channel)
 * - AI response generation (AI channel)
 *
 * IMPORTANT: Only processes PATIENT messages (senderRole === 'patient').
 * AI messages are NEVER re-processed to prevent infinite loops.
 */
@Injectable()
export class MessageEventListeners {
  private readonly logger = new Logger(MessageEventListeners.name);

  // Bounded deduplication guard with TTL (60s expiry, max 1000 entries).
  // Prevents: duplicate processing, memory leaks from stuck items.
  private readonly processingSet = new TtlSet(1000, 60_000);

  constructor(
    private aiService: AiService,
    private messagesService: MessagesService,
    private conversationsService: ConversationsService,
    private queueService: QueueService,
    private eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(SYSTEM_EVENTS.MESSAGE_CREATED, { async: true })
  async handleMessageCreated(event: {
    conversationId: string;
    messageId: string;
    senderId: string;
    senderRole: string;
    content: string;
    channel: string;
    messageData: unknown;
    correlationId?: string;
  }) {
    // ── CRITICAL GUARD: Do NOT process AI-generated messages ──────────────
    if (event.senderRole !== SenderRole.PATIENT) {
      return;
    }

    // Build log context for consistent tracing
    const ctx: LogContext = {
      correlationId: event.correlationId,
      conversationId: event.conversationId,
      messageId: event.messageId,
      channel: event.channel,
    };

    // ── Deduplication guard (TTL-bounded) ──────────────────────────────────
    if (!this.processingSet.add(event.messageId)) {
      logWithContext(this.logger, 'warn', 'Duplicate event – skipping', ctx);
      return;
    }

    try {
      const startTime = Date.now();
      const sanitized = sanitizeForPrompt(event.content);

      // Wrap processing in a timeout to prevent zombie processing
      const PROCESSING_TIMEOUT_MS = 45_000;
      const processPromise = this.processMessage(event, sanitized, ctx);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Processing timeout after ${PROCESSING_TIMEOUT_MS}ms`)),
          PROCESSING_TIMEOUT_MS,
        ),
      );

      await Promise.race([processPromise, timeoutPromise]);

      logWithContext(this.logger, 'log', 'AI processing complete', {
        ...ctx,
        duration: Date.now() - startTime,
      });
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logWithContext(this.logger, 'error', `Processing failed: ${errMsg}`, ctx);
    } finally {
      this.processingSet.delete(event.messageId);
    }
  }

  /**
   * Core processing logic — extracted for timeout wrapping.
   */
  private async processMessage(
    event: {
      conversationId: string;
      messageId: string;
      senderId: string;
      channel: string;
      correlationId?: string;
    },
    sanitized: string,
    ctx: LogContext,
  ): Promise<void> {
    // Route by channel — AI channel uses a single combined API call to conserve quota
    if (event.channel === ConversationChannel.AI) {
      // COMBINED: analyze + respond in a single API call (halves quota usage)
      const { analysis, response: aiResponseText } =
        await this.aiService.analyzeAndRespond(sanitized);

      // Update message with analysis
      await this.messagesService.updateAnalysis(
        event.messageId,
        analysis as unknown as Record<string, unknown>,
      );

      // Update conversation priority + language
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

      // Save and broadcast AI response
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
    } else {
      // HUMAN channel → analyze only (no AI response needed)
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

      // Add to priority queue with correlationId (non-blocking)
      await this.queueService.addToQueue({
        conversationId: event.conversationId,
        messageId: event.messageId,
        patientId: event.senderId,
        priority: analysis.priority,
        intent: analysis.intent,
        correlationId: event.correlationId,
      }).catch((err: Error) => {
        logWithContext(this.logger, 'error', `Queue addToQueue failed: ${err.message}`, ctx);
      });

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
}
