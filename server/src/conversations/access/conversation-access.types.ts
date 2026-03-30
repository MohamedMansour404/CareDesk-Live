import {
  ConversationChannel,
  ConversationStatus,
  UserRole,
} from '../../common/constants.js';

export interface AuthenticatedUserContext {
  userId: string;
  role: UserRole;
}

export interface ConversationAccessSnapshot {
  id: string;
  patientId: string;
  agentId?: string;
  status: ConversationStatus;
  channel: ConversationChannel;
}

export enum ConversationAccessAction {
  VIEW = 'view',
  VIEW_MESSAGES = 'view_messages',
  CREATE_MESSAGE = 'create_message',
  JOIN_REALTIME = 'join_realtime',
}

export interface ConversationAccessOptions {
  allowQueueViewForAgents?: boolean;
}
