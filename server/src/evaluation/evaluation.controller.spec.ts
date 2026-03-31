import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { EvaluationController } from './evaluation.controller';
import { UserRole } from '../common/constants';
import { ConversationAccessAction } from '../conversations/access/conversation-access.types';
import { CONVERSATION_ACCESS_KEY } from '../conversations/access/conversation-access.decorator';
import { ConversationAccessGuard } from '../conversations/access/conversation-access.guard';

describe('EvaluationController authorization', () => {
  const buildController = () => {
    const evaluationService = {
      findByAgent: jest.fn().mockResolvedValue([]),
      getAgentAverageScore: jest
        .fn()
        .mockResolvedValue({ averageScore: 0, totalEvaluations: 0 }),
      findByConversation: jest.fn().mockResolvedValue([]),
    };

    return {
      controller: new EvaluationController(evaluationService as never),
      evaluationService,
    };
  };

  it('blocks agent from accessing another agent metrics', async () => {
    const { controller } = buildController();

    await expect(
      controller.findByAgent('agent-2', {
        user: { userId: 'agent-1', role: UserRole.AGENT },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows agent to access own metrics', async () => {
    const { controller, evaluationService } = buildController();

    await controller.findByAgent('agent-1', {
      user: { userId: 'agent-1', role: UserRole.AGENT },
    });

    expect(evaluationService.findByAgent).toHaveBeenCalledWith('agent-1');
    expect(evaluationService.getAgentAverageScore).toHaveBeenCalledWith(
      'agent-1',
    );
  });

  it('allows admin to access any agent metrics', async () => {
    const { controller, evaluationService } = buildController();

    await controller.findByAgent('agent-2', {
      user: { userId: 'admin-1', role: UserRole.ADMIN },
    });

    expect(evaluationService.findByAgent).toHaveBeenCalledWith('agent-2');
    expect(evaluationService.getAgentAverageScore).toHaveBeenCalledWith(
      'agent-2',
    );
  });

  it('applies conversation-level access metadata for evaluations by conversation', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      EvaluationController.prototype,
      'findByConversation',
    );
    const targetMethod = descriptor?.value as
      | ((...args: unknown[]) => unknown)
      | undefined;
    expect(typeof targetMethod).toBe('function');
    expect(targetMethod).toBeDefined();

    if (!targetMethod) {
      throw new Error('findByConversation descriptor is missing');
    }

    const accessMeta = Reflect.getMetadata(
      CONVERSATION_ACCESS_KEY,
      targetMethod,
    ) as unknown;

    expect(accessMeta).toEqual({
      action: ConversationAccessAction.VIEW_MESSAGES,
      paramName: 'conversationId',
      options: { allowQueueViewForAgents: false },
    });

    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      targetMethod,
    ) as Array<unknown>;

    expect(guards).toContain(ConversationAccessGuard);
  });
});
