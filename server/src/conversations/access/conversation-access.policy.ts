import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Conversation,
  ConversationDocument,
} from '../schemas/conversation.schema.js';
import {
  ConversationChannel,
  ConversationStatus,
  UserRole,
} from '../../common/constants.js';
import {
  AuthenticatedUserContext,
  ConversationAccessAction,
  ConversationAccessOptions,
  ConversationAccessSnapshot,
} from './conversation-access.types.js';

@Injectable()
export class ConversationAccessPolicy {
  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
  ) {}

  async getSnapshot(
    conversationId: string,
  ): Promise<ConversationAccessSnapshot | null> {
    const conversation = await this.conversationModel
      .findById(conversationId)
      .select('_id patient agent status channel')
      .lean()
      .exec();

    if (!conversation) {
      return null;
    }

    return {
      id: conversation._id.toString(),
      patientId: conversation.patient.toString(),
      agentId: conversation.agent?.toString(),
      status: conversation.status,
      channel: conversation.channel,
    };
  }

  async assertCanAccess(
    user: AuthenticatedUserContext,
    conversationId: string,
    action: ConversationAccessAction,
    options: ConversationAccessOptions = {},
  ): Promise<ConversationAccessSnapshot> {
    const snapshot = await this.getSnapshot(conversationId);
    if (!snapshot) {
      throw new NotFoundException('Conversation not found');
    }

    const allowed = this.canAccess(user, snapshot, action, options);
    if (!allowed) {
      throw new ForbiddenException('Not authorized for this conversation');
    }

    return snapshot;
  }

  canAccess(
    user: AuthenticatedUserContext,
    conversation: ConversationAccessSnapshot,
    action: ConversationAccessAction,
    options: ConversationAccessOptions = {},
  ): boolean {
    if (user.role === UserRole.PATIENT) {
      if (action === ConversationAccessAction.CREATE_MESSAGE) {
        return conversation.patientId === user.userId;
      }
      return conversation.patientId === user.userId;
    }

    if (user.role !== UserRole.AGENT) {
      return false;
    }

    const isAssignedAgent = conversation.agentId === user.userId;
    if (isAssignedAgent) {
      return true;
    }

    const allowQueueView = options.allowQueueViewForAgents ?? false;
    if (!allowQueueView) {
      return false;
    }

    const isQueueEligibleConversation =
      conversation.channel === ConversationChannel.HUMAN &&
      conversation.status === ConversationStatus.PENDING &&
      !conversation.agentId;

    if (
      action === ConversationAccessAction.VIEW ||
      action === ConversationAccessAction.VIEW_MESSAGES ||
      action === ConversationAccessAction.JOIN_REALTIME
    ) {
      return isQueueEligibleConversation;
    }

    return false;
  }
}
