import { Injectable, Logger } from '@nestjs/common';
import { SttService } from '../stt/stt.service.js';
import { AssistantService } from '../assistant/assistant.service.js';
import { VoiceAskResponseDto } from './dto/voice-ask.dto.js';

export interface VoiceAskInput {
  audio: Buffer;
  mimeType: string;
  fileName?: string;
  debug?: boolean;
}

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    private readonly sttService: SttService,
    private readonly assistantService: AssistantService,
  ) {}

  async ask(input: VoiceAskInput): Promise<VoiceAskResponseDto> {
    const totalStart = Date.now();

    this.logger.log(`[VoiceService] ask request started`);

    // 1. Transcription (Phase 8A/8B)
    const sttStart = Date.now();
    const sttResult = await this.sttService.transcribe({
      audio: input.audio,
      mimeType: input.mimeType,
      fileName: input.fileName,
    });
    const sttMs = Date.now() - sttStart;

    this.logger.log(`[VoiceService] STT completed in ${sttMs}ms, transcript length: ${sttResult.text.length}`);

    // 2. Assistant processing (Phase 5.6/6/7)
    // The transcript is passed exactly as query, without modification.
    const assistantStart = Date.now();
    const assistantResult = await this.assistantService.ask({
      query: sttResult.text,
      debug: input.debug,
    });
    const assistantMs = Date.now() - assistantStart;

    this.logger.log(`[VoiceService] Assistant completed in ${assistantMs}ms, type: ${assistantResult.type}`);

    // 3. Assemble response preserving exactly the assistant payload
    return {
      transcript: sttResult.text,
      assistant: assistantResult,
      timing: {
        sttMs,
        assistantMs,
        totalMs: Date.now() - totalStart,
      },
    };
  }
}
