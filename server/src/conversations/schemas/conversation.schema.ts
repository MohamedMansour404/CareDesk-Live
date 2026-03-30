import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  ConversationChannel,
  ConversationStatus,
  MessagePriority,
  MessageIntent,
  TriageLevel,
  TriageSource,
} from '../../common/constants.js';
import { User } from '../../users/schemas/user.schema.js';

export type ConversationDocument = HydratedDocument<Conversation>;

// ── Embedded sub-schema for handoff history ──
export class HandoffEntry {
  from: Types.ObjectId;
  to: Types.ObjectId;
  reason: string;
  at: Date;
}

@Schema({ _id: false })
export class IntakeSymptomDuration {
  @Prop({ required: true, min: 1, max: 3650 })
  value: number;

  @Prop({ required: true, enum: ['hours', 'days', 'weeks', 'months'] })
  unit: 'hours' | 'days' | 'weeks' | 'months';
}

@Schema({ _id: false })
export class IntakeDemographics {
  @Prop({ required: true, min: 1, max: 120 })
  age: number;

  @Prop({
    required: true,
    enum: ['male', 'female', 'non_binary', 'prefer_not_to_say'],
  })
  gender: 'male' | 'female' | 'non_binary' | 'prefer_not_to_say';
}

@Schema({ _id: false })
export class IntakeVitals {
  @Prop({ min: 50, max: 250 })
  heightCm?: number;

  @Prop({ min: 2, max: 300 })
  weightKg?: number;
}

@Schema({ _id: false })
export class IntakeClinical {
  @Prop({
    type: [String],
    default: [],
    validate: {
      validator: (conditions: string[]) =>
        Array.isArray(conditions) && conditions.length <= 20,
      message: 'chronicConditions can include up to 20 entries',
    },
  })
  chronicConditions: string[];

  @Prop({ type: IntakeSymptomDuration, required: true })
  symptomDuration: IntakeSymptomDuration;

  @Prop({ required: true, min: 0, max: 10 })
  painScale: number;

  @Prop({ required: true, trim: true, minlength: 10, maxlength: 1000 })
  mainComplaint: string;
}

@Schema({ _id: false })
export class IntakeTriage {
  @Prop({ type: String, required: true, enum: TriageLevel })
  level: TriageLevel;

  @Prop({ required: true, min: 0, max: 100 })
  score: number;

  @Prop({
    type: String,
    required: true,
    enum: TriageSource,
    default: TriageSource.RULES_V1,
  })
  source: TriageSource;

  @Prop({
    type: [String],
    required: true,
    validate: {
      validator: (reasons: string[]) =>
        Array.isArray(reasons) && reasons.length > 0,
      message: 'triage reasons must include at least one entry',
    },
  })
  reasons: string[];

  @Prop({ required: true })
  classifiedAt: Date;
}

@Schema({ _id: false })
export class ConversationIntake {
  @Prop({ required: true, default: 1 })
  version: number;

  @Prop({ type: IntakeDemographics, required: true })
  demographics: IntakeDemographics;

  @Prop({ type: IntakeVitals, default: {} })
  vitals?: IntakeVitals;

  @Prop({ type: IntakeClinical, required: true })
  clinical: IntakeClinical;

  @Prop({ type: IntakeTriage, required: true })
  triage: IntakeTriage;
}

@Schema({ timestamps: true, optimisticConcurrency: true })
export class Conversation {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, index: true })
  patient: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: User.name, index: true })
  agent?: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: ConversationChannel,
    default: ConversationChannel.AI,
  })
  channel: ConversationChannel;

  @Prop({
    type: String,
    required: true,
    enum: ConversationStatus,
    default: ConversationStatus.PENDING,
    index: true,
  })
  status: ConversationStatus;

  @Prop({
    type: String,
    enum: MessagePriority,
    default: MessagePriority.MEDIUM,
    index: true,
  })
  priority: MessagePriority;

  @Prop({ type: String, enum: MessageIntent, default: MessageIntent.GENERAL })
  category: MessageIntent;

  @Prop()
  summary?: string;

  @Prop()
  resolvedAt?: Date;

  // ── Phase 2 additions ──

  @Prop({ default: 'en' })
  language: string;

  @Prop({
    type: [
      {
        from: { type: Types.ObjectId, ref: User.name },
        to: { type: Types.ObjectId, ref: User.name },
        reason: String,
        at: Date,
      },
    ],
    default: [],
  })
  handoffHistory: HandoffEntry[];

  @Prop({ type: ConversationIntake })
  intake?: ConversationIntake;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

// Compound index for agent dashboard queries (matches findPendingByPriority filter + sort)
ConversationSchema.index({ channel: 1, status: 1, priority: 1, createdAt: 1 });
// Compound index for general status-based queries
ConversationSchema.index({ status: 1, priority: 1, createdAt: 1 });
