import { IsMongoId, IsString, IsOptional } from 'class-validator';

export class TransferConversationDto {
  @IsMongoId()
  targetAgentId: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
