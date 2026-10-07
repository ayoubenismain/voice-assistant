import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AssistantController } from './assistant.controller.js';
import { AssistantService } from './assistant.service.js';
import { RetrievalModule } from '../retrieval/retrieval.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { RagModule } from '../rag/rag.module.js';
import { ScopeGuardModule } from '../scope-guard/scope-guard.module.js';
import { ConversationModule } from '../conversation/conversation.module.js';

@Module({
  imports: [ConfigModule, RetrievalModule, LlmModule, RagModule, ScopeGuardModule, ConversationModule],
  controllers: [AssistantController],
  providers: [AssistantService],
  exports: [AssistantService],
})
export class AssistantModule {}
