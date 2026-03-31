/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import 'reflect-metadata';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Types } from 'mongoose';
import { InternalServerErrorException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { ConversationChannel } from '../common/constants';
import { SYSTEM_EVENTS } from '../common/events/index';

describe('ConversationsService create flow', () => {
  const patientId = new Types.ObjectId().toString();

  const createDto = {
    channel: ConversationChannel.HUMAN,
    intake: {
      demographics: {
        age: 52,
        gender: 'female' as const,
      },
      clinical: {
        chronicConditions: ['diabetes'],
        symptomDuration: { value: 3, unit: 'days' as const },
        painScale: 6,
        mainComplaint: 'Persistent chest pain and shortness of breath',
      },
    },
  };

  const buildService = (options?: {
    transactionUnsupported?: boolean;
    messageSaveFails?: boolean;
  }) => {
    const conversationId = new Types.ObjectId();
    const messageId = new Types.ObjectId();

    const conversationSave = jest.fn();
    const messageSave = jest.fn();

    const conversationDoc = {
      _id: conversationId,
      channel: ConversationChannel.HUMAN,
      toObject: jest.fn(() => ({ _id: conversationId.toString() })),
    };

    const messageDoc = {
      _id: messageId,
      content: createDto.intake.clinical.mainComplaint,
      toObject: jest.fn(() => ({ _id: messageId.toString() })),
    };

    conversationSave.mockResolvedValue(conversationDoc);
    if (options?.messageSaveFails) {
      messageSave.mockRejectedValue(new Error('message save failed'));
    } else {
      messageSave.mockResolvedValue(messageDoc);
    }

    const ConversationModel: any = jest.fn().mockImplementation(() => ({
      save: conversationSave,
    }));
    ConversationModel.findByIdAndDelete = jest.fn().mockResolvedValue(null);

    const MessageModel: any = jest.fn().mockImplementation(() => ({
      save: messageSave,
    }));

    const session = {
      startTransaction: jest.fn(() => {
        if (options?.transactionUnsupported) {
          throw new Error(
            'Transaction numbers are only allowed on a replica set member or mongos',
          );
        }
      }),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn().mockResolvedValue(undefined),
    };

    const connection = {
      startSession: jest.fn().mockResolvedValue(session),
    } as any;

    const service = new ConversationsService(
      ConversationModel,
      MessageModel,
      connection,
      {} as any,
      { emit: jest.fn() } as unknown as EventEmitter2,
      {} as any,
      { invalidateConversationList: jest.fn() } as any,
      {
        assessIntake: jest.fn(() => ({
          level: 'critical',
          score: 80,
          source: 'rules_v1',
          reasons: ['Red-flag complaint keyword detected'],
          classifiedAt: new Date(),
          mappedPriority: 'high',
        })),
      } as any,
    );

    return {
      service,
      mocks: {
        conversationSave,
        messageSave,
        conversationModelDelete: ConversationModel.findByIdAndDelete,
        eventEmit: (service as any).eventEmitter.emit,
        invalidateList: (service as any).cacheInvalidationService
          .invalidateConversationList,
        session,
      },
    };
  };

  it('creates conversation and complaint message atomically when transaction is available', async () => {
    const { service, mocks } = buildService();

    await service.create(patientId, createDto as any);

    expect(mocks.session.startTransaction).toHaveBeenCalled();
    expect(mocks.conversationSave).toHaveBeenCalledWith({
      session: expect.any(Object),
    });
    expect(mocks.messageSave).toHaveBeenCalledWith({
      session: expect.any(Object),
    });
    expect(mocks.invalidateList).toHaveBeenCalledTimes(1);
    expect(mocks.eventEmit).toHaveBeenCalledWith(
      SYSTEM_EVENTS.CONVERSATION_CREATED,
      expect.any(Object),
    );
    expect(mocks.eventEmit).toHaveBeenCalledWith(
      SYSTEM_EVENTS.MESSAGE_CREATED,
      expect.any(Object),
    );
  });

  it('falls back to compensation strategy when transaction is unsupported', async () => {
    const { service, mocks } = buildService({ transactionUnsupported: true });

    await service.create(patientId, createDto as any);

    expect(mocks.session.startTransaction).toHaveBeenCalled();
    expect(mocks.conversationSave).toHaveBeenCalledTimes(1);
    expect(mocks.messageSave).toHaveBeenCalledTimes(1);
    expect(mocks.conversationModelDelete).not.toHaveBeenCalled();
  });

  it('rolls back conversation when complaint message creation fails in compensation mode', async () => {
    const { service, mocks } = buildService({
      transactionUnsupported: true,
      messageSaveFails: true,
    });

    await expect(
      service.create(patientId, createDto as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(mocks.conversationModelDelete).toHaveBeenCalledTimes(1);
  });
});
