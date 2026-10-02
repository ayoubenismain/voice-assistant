import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { EmbeddingsModule } from './embeddings/embeddings.module.js';
import { RetrievalModule } from './retrieval/retrieval.module.js';

import { LlmModule } from './llm/llm.module.js';
import { RagModule } from './rag/rag.module.js';
import { AssistantModule } from './assistant/assistant.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    HealthModule,
    DocumentsModule,
    EmbeddingsModule,
    RetrievalModule,
    LlmModule,
    RagModule,
    AssistantModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
