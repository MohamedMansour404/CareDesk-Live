import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ConversationChannel } from '../../common/constants.js';

export class IntakeSymptomDurationDto {
  @IsInt()
  @Min(1)
  @Max(3650)
  value: number;

  @IsIn(['hours', 'days', 'weeks', 'months'])
  unit: 'hours' | 'days' | 'weeks' | 'months';
}

export class IntakeDemographicsDto {
  @IsInt()
  @Min(1)
  @Max(120)
  age: number;

  @IsIn(['male', 'female', 'non_binary', 'prefer_not_to_say'])
  gender: 'male' | 'female' | 'non_binary' | 'prefer_not_to_say';
}

export class IntakeVitalsDto {
  @IsOptional()
  @IsNumber()
  @Min(50)
  @Max(250)
  heightCm?: number;

  @IsOptional()
  @IsNumber()
  @Min(2)
  @Max(300)
  weightKg?: number;
}

export class IntakeClinicalDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(60, { each: true })
  chronicConditions?: string[];

  @ValidateNested()
  @Type(() => IntakeSymptomDurationDto)
  symptomDuration: IntakeSymptomDurationDto;

  @IsInt()
  @Min(0)
  @Max(10)
  painScale: number;

  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(1000)
  mainComplaint: string;
}

export class ConversationIntakeDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  @ValidateNested()
  @Type(() => IntakeDemographicsDto)
  demographics: IntakeDemographicsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => IntakeVitalsDto)
  vitals?: IntakeVitalsDto;

  @ValidateNested()
  @Type(() => IntakeClinicalDto)
  clinical: IntakeClinicalDto;
}

export class CreateConversationDto {
  @IsEnum(ConversationChannel)
  @IsNotEmpty()
  channel: ConversationChannel;

  @IsString()
  @IsOptional()
  initialMessage?: string;

  @IsString()
  @IsOptional()
  patientName?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConversationIntakeDto)
  intake?: ConversationIntakeDto;
}
