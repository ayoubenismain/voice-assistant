import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AssistantService } from './assistant.service.js';
import { AskAssistantDto } from './dto/ask-assistant.dto.js';
import { AssistantResponse } from './types/assistant.types.js';

@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Post('ask')
  @HttpCode(HttpStatus.OK)
  async ask(@Body() askDto: AskAssistantDto): Promise<AssistantResponse> {
    return this.assistantService.ask(askDto);
  }
}
