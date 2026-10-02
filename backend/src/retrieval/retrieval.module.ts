import { Module } from '@nestjs/common';
import { RetrievalController } from './retrieval.controller.js';
import { RetrievalService } from './retrieval.service.js';
import { DarijaNormalizerService } from './darija/darija-normalizer.service.js';

@Module({
  controllers: [RetrievalController],
  providers: [RetrievalService, DarijaNormalizerService],
  exports: [RetrievalService],
})
export class RetrievalModule {}
