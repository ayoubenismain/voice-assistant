import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TimetableClient } from './timetable.client.js';
import { TimetableIntentService } from './timetable-intent.service.js';
import { TimetableToolsService } from './timetable-tools.service.js';
import { LlmModule } from '../llm/llm.module.js';

@Module({
  imports: [ConfigModule, LlmModule],
  providers: [TimetableClient, TimetableIntentService, TimetableToolsService],
  exports: [TimetableIntentService, TimetableToolsService],
})
export class TimetableModule {}
