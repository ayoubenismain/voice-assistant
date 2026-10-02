import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RagContextBuilderService } from './rag-context-builder.service.js';
import { RagPromptBuilderService } from './rag-prompt-builder.service.js';

@Module({
  imports: [ConfigModule],
  providers: [RagContextBuilderService, RagPromptBuilderService],
  exports: [RagContextBuilderService, RagPromptBuilderService],
})
export class RagModule {}
