import { NotFoundException } from '@nestjs/common';
import { QueueService } from './queue.service';

describe('QueueService', () => {
  const buildService = () => {
    const messageQueue = {
      add: jest.fn(),
      getWaitingCount: jest.fn().mockResolvedValue(1),
      getActiveCount: jest.fn().mockResolvedValue(2),
      getCompletedCount: jest.fn().mockResolvedValue(3),
      getFailedCount: jest.fn().mockResolvedValue(4),
      close: jest.fn().mockResolvedValue(undefined),
    };

    const dlqJob = {
      id: 'dlq-1',
      name: 'dead-letter-message',
      timestamp: Date.now(),
      data: {
        reason: 'queue timeout',
        attemptsMade: 3,
        failedAt: new Date().toISOString(),
        payload: {
          conversationId: 'conv-1',
          messageId: 'msg-1',
          patientId: 'p-1',
          priority: 'high',
          intent: 'general',
        },
      },
      getState: jest.fn().mockResolvedValue('waiting'),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    const dlqQueue = {
      add: jest.fn(),
      getWaitingCount: jest.fn().mockResolvedValue(1),
      getDelayedCount: jest.fn().mockResolvedValue(0),
      getFailedCount: jest.fn().mockResolvedValue(1),
      getJobs: jest.fn().mockResolvedValue([dlqJob]),
      getJob: jest.fn().mockResolvedValue(dlqJob),
      close: jest.fn().mockResolvedValue(undefined),
    };

    const service = new QueueService(messageQueue as never, dlqQueue as never);
    return { service, messageQueue, dlqQueue, dlqJob };
  };

  it('adds failures to DLQ and exposes DLQ jobs', async () => {
    const { service, dlqQueue } = buildService();

    await service.addToDlq({
      originalJobId: 'job-1',
      reason: 'failed permanently',
      attemptsMade: 3,
      payload: {
        conversationId: 'conv-1',
        messageId: 'msg-1',
        patientId: 'p-1',
        priority: 'high' as never,
        intent: 'general',
      },
    });

    const jobs = await service.getDlqJobs(0, 10);

    expect(dlqQueue.add).toHaveBeenCalledTimes(1);
    expect(jobs.total).toBe(2);
    expect(jobs.jobs[0].id).toBe('dlq-1');
    expect(jobs.jobs[0].reason).toBe('queue timeout');
  });

  it('retries DLQ jobs into processing queue and removes original DLQ job', async () => {
    const { service, messageQueue, dlqJob } = buildService();

    const result = await service.retryDlqJob('dlq-1');

    expect(messageQueue.add).toHaveBeenCalledTimes(1);
    expect(dlqJob.remove).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ retried: true, messageId: 'msg-1' });
  });

  it('throws when retry target is missing', async () => {
    const { service, dlqQueue } = buildService();
    dlqQueue.getJob.mockResolvedValueOnce(null);

    await expect(service.retryDlqJob('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
