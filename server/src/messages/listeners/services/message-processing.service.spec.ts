import { EventEmitter2 } from '@nestjs/event-emitter';
import { MessageProcessingService } from './message-processing.service';
import { AiService } from '../../../ai/ai.service';
import { MessagesService } from '../../messages.service';
import { ConversationsService } from '../../../conversations/conversations.service';
import { MessageQueueRetryService } from './message-queue-retry.service';
import {
  ConversationChannel,
  MessageIntent,
  MessagePriority,
  MessageSentiment,
} from '../../../common/constants';
import { SYSTEM_EVENTS } from '../../../common/events';

describe('MessageProcessingService', () => {
  const analysis = {
    intent: MessageIntent.GENERAL,
    priority: MessagePriority.MEDIUM,
    sentiment: MessageSentiment.NEUTRAL,
    confidence: 0.9,
    shouldEscalate: false,
    detectedLanguage: 'en',
  };

  const baseEvent = {
    conversationId: 'conv-1',
    messageId: 'msg-1',
    senderId: 'patient-1',
    channel: ConversationChannel.AI,
    correlationId: 'corr-1',
  };

  const ctx = {
    correlationId: 'corr-1',
    conversationId: 'conv-1',
    messageId: 'msg-1',
    channel: ConversationChannel.AI,
  };

  it('calls analyzeAndRespond exactly once for AI channel', async () => {
    const analyzeAndRespond = jest
      .fn()
      .mockResolvedValue({ analysis, response: 'AI reply' });
    const analyzeMessage = jest.fn();
    const aiService = {
      analyzeAndRespond,
      analyzeMessage,
    } as unknown as AiService;

    const updateAnalysis = jest.fn().mockResolvedValue(undefined);
    const saveAiResponse = jest
      .fn()
      .mockResolvedValue({ toObject: () => ({ _id: 'ai-msg-1' }) });
    const messagesService = {
      updateAnalysis,
      saveAiResponse,
    } as unknown as MessagesService;

    const updatePriority = jest.fn().mockResolvedValue(undefined);
    const updateLanguage = jest.fn().mockResolvedValue(undefined);
    const conversationsService = {
      updatePriority,
      updateLanguage,
    } as unknown as ConversationsService;

    const enqueueWithRetry = jest.fn();
    const queueRetryService = {
      enqueueWithRetry,
    } as unknown as MessageQueueRetryService;

    const emit = jest.fn();
    const eventEmitter = {
      emit,
    } as unknown as EventEmitter2;

    const service = new MessageProcessingService(
      aiService,
      messagesService,
      conversationsService,
      queueRetryService,
      eventEmitter,
    );

    await service.processMessage(baseEvent, 'hello', ctx);

    expect(analyzeAndRespond).toHaveBeenCalledTimes(1);
    expect(analyzeMessage).not.toHaveBeenCalled();
    expect(saveAiResponse).toHaveBeenCalledTimes(1);
    expect(enqueueWithRetry).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      SYSTEM_EVENTS.MESSAGE_AI_PROCESSING_COMPLETE,
      expect.anything(),
    );
  });

  it('calls analyzeMessage exactly once for HUMAN channel', async () => {
    const analyzeAndRespond = jest.fn();
    const analyzeMessage = jest.fn().mockResolvedValue(analysis);
    const aiService = {
      analyzeAndRespond,
      analyzeMessage,
    } as unknown as AiService;

    const updateAnalysis = jest.fn().mockResolvedValue(undefined);
    const saveAiResponse = jest.fn();
    const messagesService = {
      updateAnalysis,
      saveAiResponse,
    } as unknown as MessagesService;

    const updatePriority = jest.fn().mockResolvedValue(undefined);
    const updateLanguage = jest.fn().mockResolvedValue(undefined);
    const conversationsService = {
      updatePriority,
      updateLanguage,
    } as unknown as ConversationsService;

    const enqueueWithRetry = jest.fn().mockResolvedValue(undefined);
    const queueRetryService = {
      enqueueWithRetry,
    } as unknown as MessageQueueRetryService;

    const emit = jest.fn();
    const eventEmitter = {
      emit,
    } as unknown as EventEmitter2;

    const service = new MessageProcessingService(
      aiService,
      messagesService,
      conversationsService,
      queueRetryService,
      eventEmitter,
    );

    await service.processMessage(
      { ...baseEvent, channel: ConversationChannel.HUMAN },
      'hello',
      { ...ctx, channel: ConversationChannel.HUMAN },
    );

    expect(analyzeMessage).toHaveBeenCalledTimes(1);
    expect(analyzeAndRespond).not.toHaveBeenCalled();
    expect(enqueueWithRetry).toHaveBeenCalledTimes(1);
    expect(saveAiResponse).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      SYSTEM_EVENTS.MESSAGE_AI_PROCESSING_COMPLETE,
      expect.anything(),
    );
  });
});
