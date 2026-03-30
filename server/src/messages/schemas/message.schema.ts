import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  SenderRole,
  MessageIntent,
  MessagePriority,
  MessageSentiment,
} from '../../common/constants.js';
import { Conversation } from '../../conversations/schemas/conversation.schema.js';
import { User } from '../../users/schemas/user.schema.js';

export type MessageDocument = HydratedDocument<Message>;

// Sub-document: AI Analysis result
@Schema({ _id: false })
export class MessageAnalysis {
  @Prop({ type: String, enum: MessageIntent, required: true })
  intent: MessageIntent;

  @Prop({ type: String, enum: MessagePriority, required: true })
  priority: MessagePriority;

  @Prop({ type: String, enum: MessageSentiment, required: true })
  sentiment: MessageSentiment;

  @Prop({ required: true, min: 0, max: 1 })
  confidence: number;

  @Prop({ required: true })
  shouldEscalate: boolean;

  @Prop()
  reasoning?: string;
}

export const MessageAnalysisSchema =
  SchemaFactory.createForClass(MessageAnalysis);

// Sub-document: AI suggestion for agents
@Schema({ _id: false })
export class AiSuggestion {
  @Prop()
  suggestedReply: string;

  @Prop()
  summary: string;

  @Prop({ type: [String] })
  keyPoints: string[];
}

export const AiSuggestionSchema = SchemaFactory.createForClass(AiSuggestion);

// Main Message schema
@Schema({ timestamps: true })
export class Message {
  @Prop({
    type: Types.ObjectId,
    ref: Conversation.name,
    required: true,
    index: true,
  })
  conversation: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: User.name })
  sender?: Types.ObjectId;

  @Prop({ type: String, required: true, enum: SenderRole })
  senderRole: SenderRole;

  @Prop({ required: true })
  content: string;

  @Prop({ type: MessageAnalysisSchema })
  analysis?: MessageAnalysis;

  @Prop({ type: AiSuggestionSchema })
  aiSuggestion?: AiSuggestion;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
