// ============================================
// CareDesk AI – Internal Event Definitions
// ============================================

export const SYSTEM_EVENTS = {
  MESSAGE_CREATED: 'message.created',
  MESSAGE_AGENT_REPLIED: 'message.agent.replied',
  MESSAGE_AI_PROCESSING_COMPLETE: 'message.ai.processing.complete',
  MESSAGE_QUEUE_FAILED: 'message.queue.failed',
  CONVERSATION_CREATED: 'conversation.created',
  CONVERSATION_ASSIGNED: 'conversation.assigned',
  CONVERSATION_RESOLVED: 'conversation.resolved',
  CONVERSATION_TRANSFERRED: 'conversation.transferred',
  CONVERSATION_ESCALATED: 'conversation.escalated',
  EVALUATION_CREATED: 'evaluation.created',
} as const;

// ── Event Payloads ──────────────────────────

export class MessageCreatedEvent {
  constructor(
    public readonly conversationId: string,
    public readonly messageId: string,
    public readonly senderId: string,
    public readonly senderRole: string,
    public readonly content: string,
    public readonly channel: string,
    public readonly messageData: unknown,
    public readonly correlationId?: string,
  ) {}
}

export class AgentRepliedEvent {
  constructor(
    public readonly conversationId: string,
    public readonly agentId: string,
    public readonly agentMessageId: string,
    public readonly content: string,
    public readonly messageData: unknown,
    public readonly correlationId?: string,
  ) {}
}

export class AiProcessingCompleteEvent {
  constructor(
    public readonly conversationId: string,
    public readonly patientMessageId: string,
    public readonly analysis: unknown,
    public readonly aiResponse?: unknown,
    public readonly channel?: string,
    public readonly correlationId?: string,
  ) {}
}

export class MessageQueueFailedEvent {
  constructor(
    public readonly conversationId: string,
    public readonly messageId: string,
    public readonly reason: string,
    public readonly correlationId?: string,
  ) {}
}

export class ConversationCreatedEvent {
  constructor(
    public readonly conversationId: string,
    public readonly channel: string,
    public readonly conversationData: unknown,
  ) {}
}

export class ConversationAssignedEvent {
  constructor(
    public readonly conversationId: string,
    public readonly agentId: string,
  ) {}
}

export class ConversationResolvedEvent {
  constructor(public readonly conversationId: string) {}
}

export class ConversationTransferredEvent {
  constructor(
    public readonly conversationId: string,
    public readonly fromAgentId: string,
    public readonly toAgentId: string,
  ) {}
}

export class EvaluationCreatedEvent {
  constructor(
    public readonly conversationId: string,
    public readonly evaluationData: unknown,
  ) {}
}

export class ConversationEscalatedEvent {
  constructor(
    public readonly conversationId: string,
    public readonly conversationData: unknown,
  ) {}
}
