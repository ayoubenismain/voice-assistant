import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VoiceController } from './voice.controller.js';
import { SttModule } from '../stt/stt.module.js';
import { AssistantModule } from '../assistant/assistant.module.js';
import { TtsModule } from '../tts/tts.module.js';
import { VoiceService } from './voice.service.js';

/**
 * VoiceModule — Phase 8E.
 *
 * Provides:
 *   POST /api/voice/transcribe  — audio upload → transcription → transcript text
 *   POST /api/voice/ask         — audio upload → transcript + assistant JSON
 *   POST /api/voice/respond     — audio upload → spoken WAV response
 */
@Module({
  imports: [
    ConfigModule,
    SttModule,
    AssistantModule,
    TtsModule,
  ],
  controllers: [VoiceController],
  providers: [VoiceService],
})
export class VoiceModule {}
