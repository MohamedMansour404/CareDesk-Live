import { EventEmitter2 } from '@nestjs/event-emitter';
import { MessageEventListeners } from './message-event.listeners';
import { MessageProcessingService } from './services/message-processing.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { QueueService } from '../../queue/queue.service';
import { ConversationChannel, SenderRole } from '../../common/constants';
import { SYSTEM_EVENTS } from '../../common/events';

describe('MessageEventListeners', () => {
  it('retries processing and pushes to DLQ on terminal failure', async () => {
    jest.useFakeTimers();

    const processMessage = jest.fn().mockRejectedValue(new Error('ai timeout'));
    const messageProcessingService = {
      processMessage,
    } as unknown as MessageProcessingService;

    const idempotencyService = {
      runOnce: jest.fn(
        async (
          _scope: string,
          _id: string,
          _opts: unknown,
          operation: () => Promise<void>,
        ) => {
          await operation();
          return { executed: true as const, result: undefined };
        },
      ),
    } as unknown as IdempotencyService;

    const addToDlq = jest.fn().mockResolvedValue(undefined);
    const queueService = {
      addToDlq,
    } as unknown as QueueService;

    const emit = jest.fn();
    const eventEmitter = { emit } as unknown as EventEmitter2;

    const listener = new MessageEventListeners(
      messageProcessingService,
      idempotencyService,
      queueService,
      eventEmitter,
    );

    const promise = listener.handleMessageCreated({
      conversationId: 'conv-1',
      messageId: 'msg-1',
      senderId: 'patient-1',
      senderRole: SenderRole.PATIENT,
      content: 'need help now',
      channel: ConversationChannel.HUMAN,
      messageData: {},
      correlationId: 'corr-1',
    });

    await jest.runAllTimersAsync();
    await promise;

    expect(processMessage).toHaveBeenCalledTimes(3);
    expect(addToDlq).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      SYSTEM_EVENTS.MESSAGE_QUEUE_FAILED,
      expect.objectContaining({
        conversationId: 'conv-1',
        messageId: 'msg-1',
      }),
    );

    jest.useRealTimers();
  });
});
