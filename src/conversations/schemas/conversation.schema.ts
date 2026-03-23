import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  ConversationChannel,
  ConversationStatus,
  MessagePriority,
  MessageIntent,
} from '../../common/constants.js';
import { User } from '../../users/schemas/user.schema.js';

export type ConversationDocument = HydratedDocument<Conversation>;

@Schema({ timestamps: true })
export class Conversation {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, index: true })
  patient: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: User.name, index: true })
  agent?: Types.ObjectId;

  @Prop({
    required: true,
    enum: ConversationChannel,
    default: ConversationChannel.AI,
  })
  channel: ConversationChannel;

  @Prop({
    required: true,
    enum: ConversationStatus,
    default: ConversationStatus.PENDING,
    index: true,
  })
  status: ConversationStatus;

  @Prop({
    enum: MessagePriority,
    default: MessagePriority.MEDIUM,
    index: true,
  })
  priority: MessagePriority;

  @Prop({ enum: MessageIntent, default: MessageIntent.GENERAL })
  category: MessageIntent;

  @Prop()
  summary?: string;

  @Prop()
  resolvedAt?: Date;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

// Compound index for agent dashboard queries
ConversationSchema.index({ status: 1, priority: 1, createdAt: 1 });
