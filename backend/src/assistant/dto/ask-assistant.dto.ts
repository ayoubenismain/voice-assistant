import { IsString, IsOptional, IsBoolean, ValidateNested, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class ClarificationContextDto {
  @IsString()
  @MaxLength(1000)
  originalQuery: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  clarificationQuestion?: string;
}

export class AskAssistantDto {
  @IsString()
  @MaxLength(1000)
  query: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ClarificationContextDto)
  clarificationContext?: ClarificationContextDto;

  @IsBoolean()
  @IsOptional()
  debug?: boolean;
}
