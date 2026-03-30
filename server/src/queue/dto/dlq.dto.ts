import { MessagePriority } from '../../common/constants.js';

export interface QueueMessagePayloadDto {
  conversationId: string;
  messageId: string;
  patientId: string;
  priority: MessagePriority;
  intent: string;
  idempotencyKey?: string;
  correlationId?: string;
}

export interface DlqPayloadDto {
  originalJobId: string;
  reason: string;
  failedAt: string;
  attemptsMade: number;
  payload: QueueMessagePayloadDto;
}

export interface DlqJobSummaryDto {
  id: string;
  name: string;
  timestamp: number;
  reason: string;
  attemptsMade: number;
  failedAt: string;
  payload: QueueMessagePayloadDto;
}

export interface DlqJobsResponseDto {
  total: number;
  jobs: DlqJobSummaryDto[];
}

export interface DlqJobDetailDto extends DlqJobSummaryDto {
  state: string;
}

export interface DlqRetryResponseDto {
  retried: true;
  messageId: string;
}
