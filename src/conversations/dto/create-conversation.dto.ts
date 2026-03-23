import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ConversationChannel } from '../../common/constants.js';

export class CreateConversationDto {
  @IsEnum(ConversationChannel)
  @IsNotEmpty()
  channel: ConversationChannel;

  @IsString()
  @IsNotEmpty()
  initialMessage: string;

  @IsString()
  @IsOptional()
  patientName?: string;
}
