import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AssistantController } from './assistant.controller.js';
import { AssistantService } from './assistant.service.js';
import { RetrievalModule } from '../retrieval/retrieval.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { RagModule } from '../rag/rag.module.js';

@Module({
  imports: [ConfigModule, RetrievalModule, LlmModule, RagModule],
  controllers: [AssistantController],
  providers: [AssistantService],
  exports: [AssistantService],
})
export class AssistantModule {}
