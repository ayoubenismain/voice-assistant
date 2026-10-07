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

  /**
   * DEVELOPMENT / TRANSITIONAL only.
   *
   * Enables conversation-aware behavior for a specific user.
   * In production this MUST be derived from the authenticated session
   * (request.user.id) — never trust arbitrary client-supplied userId values
   * in a deployed environment.
   *
   * When omitted, the request falls back to stateless (Phase 5.6/7) behavior
   * to preserve full backward compatibility.
   */
  @IsString()
  @IsOptional()
  @MaxLength(256)
  userId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ClarificationContextDto)
  clarificationContext?: ClarificationContextDto;

  @IsBoolean()
  @IsOptional()
  debug?: boolean;
}
