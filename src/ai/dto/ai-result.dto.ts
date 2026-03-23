import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  MessageIntent,
  MessagePriority,
  MessageSentiment,
} from '../../common/constants.js';

export class AnalysisResultDto {
  @IsEnum(MessageIntent)
  intent: MessageIntent;

  @IsEnum(MessagePriority)
  priority: MessagePriority;

  @IsEnum(MessageSentiment)
  sentiment: MessageSentiment;

  @IsNumber()
  @Min(0)
  @Max(1)
  confidence: number;

  @IsNotEmpty()
  shouldEscalate: boolean;

  @IsString()
  @IsOptional()
  reasoning?: string;
}

export class AiAssistanceResultDto {
  @IsString()
  summary: string;

  @IsString({ each: true })
  keyPoints: string[];

  @IsString()
  suggestedReply: string;

  @IsString()
  @IsOptional()
  relevantContext?: string;
}

export class QualityEvaluationDto {
  @IsNumber()
  @Min(1)
  @Max(10)
  score: number;

  @IsString()
  feedback: string;

  @IsString({ each: true })
  issues: string[];

  @IsString({ each: true })
  suggestions: string[];
}
