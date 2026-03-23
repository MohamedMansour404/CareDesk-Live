import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type EvaluationDocument = HydratedDocument<Evaluation>;

@Schema({ timestamps: true })
export class Evaluation {
  @Prop({ type: Types.ObjectId, ref: 'Conversation', required: true, index: true })
  conversation: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  agent: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Message', required: true })
  patientMessage: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Message', required: true })
  agentMessage: Types.ObjectId;

  @Prop({ required: true, min: 1, max: 10 })
  score: number;

  @Prop({ required: true })
  feedback: string;

  @Prop({ type: [String], default: [] })
  issues: string[];

  @Prop({ type: [String], default: [] })
  suggestions: string[];
}

export const EvaluationSchema = SchemaFactory.createForClass(Evaluation);
