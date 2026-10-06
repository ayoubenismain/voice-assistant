import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VoiceController } from './voice.controller.js';
import { SttModule } from '../stt/stt.module.js';
import { AssistantModule } from '../assistant/assistant.module.js';
import { VoiceService } from './voice.service.js';

/**
 * VoiceModule — Phase 8B.
 *
 * Provides:
 *   POST /api/voice/transcribe  — audio upload → transcription → transcript text
 *
 * Does NOT import AssistantModule (Phase 8C will do that).
 */
@Module({
  imports: [
    ConfigModule,
    SttModule,
    AssistantModule,
  ],
  controllers: [VoiceController],
  providers: [VoiceService],
})
export class VoiceModule {}
