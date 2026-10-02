import { Module } from '@nestjs/common';
import { LlmService } from './llm.service.js';
import { OllamaLlmProvider } from './providers/ollama-llm.provider.js';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  providers: [LlmService, OllamaLlmProvider],
  exports: [LlmService],
})
export class LlmModule {}
