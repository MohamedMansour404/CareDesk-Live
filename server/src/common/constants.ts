// ============================================
// CareDesk AI – System-wide Constants
// ============================================

export enum UserRole {
  PATIENT = 'patient',
  AGENT = 'agent',
}

export enum ConversationChannel {
  AI = 'ai',
  HUMAN = 'human',
}

export enum ConversationStatus {
  PENDING = 'pending',
  ASSIGNED = 'assigned',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

export enum MessagePriority {
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export enum MessageIntent {
  EMERGENCY = 'emergency',
  SYMPTOM_REPORT = 'symptom_report',
  APPOINTMENT = 'appointment',
  MEDICATION = 'medication',
  FOLLOW_UP = 'follow_up',
  INQUIRY = 'inquiry',
  GENERAL = 'general',
}

export enum MessageSentiment {
  DISTRESS = 'distress',
  NEUTRAL = 'neutral',
  CALM = 'calm',
}

export enum SenderRole {
  PATIENT = 'patient',
  AGENT = 'agent',
  AI = 'ai',
}

// BullMQ priority mapping (lower number = higher priority)
export const PRIORITY_MAP: Record<MessagePriority, number> = {
  [MessagePriority.HIGH]: 1,
  [MessagePriority.MEDIUM]: 5,
  [MessagePriority.LOW]: 10,
};

// Queue names
export const QUEUE_NAMES = {
  MESSAGE_PROCESSING: 'message-processing',
};

// WebSocket events
export const WS_EVENTS = {
  CONVERSATION_NEW: 'conversation:new',
  CONVERSATION_ASSIGNED: 'conversation:assigned',
  CONVERSATION_RESOLVED: 'conversation:resolved',
  CONVERSATION_ESCALATED: 'conversation:escalated',
  MESSAGE_NEW: 'message:new',
  AGENT_TYPING: 'agent:typing',
  PATIENT_TYPING: 'patient:typing',
};

// AI Disclaimer
export const AI_DISCLAIMER =
  'This system provides assistance only and is not a substitute for professional medical advice. If you are experiencing a medical emergency, please call emergency services immediately.';

// Smart escalation thresholds
export const ESCALATION_CONFIDENCE_THRESHOLD = 0.6;
