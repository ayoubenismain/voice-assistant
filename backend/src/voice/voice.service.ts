import { Injectable, Logger } from '@nestjs/common';
import { SttService } from '../stt/stt.service.js';
import { AssistantService } from '../assistant/assistant.service.js';
import { VoiceAskResponseDto, VoiceRespondResult } from './dto/voice-ask.dto.js';
import { TtsService } from '../tts/tts.service.js';
import { ServiceUnavailableException } from '@nestjs/common';
import { AssistantResponse } from '../assistant/types/assistant.types.js';

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
    private readonly ttsService: TtsService,
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

  async respond(input: VoiceAskInput): Promise<VoiceRespondResult> {
    const totalStart = Date.now();
    this.logger.log(`[VoiceService] respond request started`);

    // Reuse existing STT + Assistant flow
    const askResult = await this.ask(input);

    const spokenText = this.extractSpeakableText(askResult.assistant);
    if (!spokenText) {
      throw new ServiceUnavailableException('Voice response could not be generated.');
    }

    const ttsStart = Date.now();
    const ttsResult = await this.ttsService.synthesize({ text: spokenText });
    const ttsMs = Date.now() - ttsStart;

    this.logger.log(`[VoiceService] full response completed totalMs=${Date.now() - totalStart}`);

    return {
      audio: ttsResult.audio,
      mimeType: ttsResult.mimeType as 'audio/wav',
      transcript: askResult.transcript,
      assistant: askResult.assistant,
      timing: {
        sttMs: askResult.timing.sttMs,
        assistantMs: askResult.timing.assistantMs,
        ttsMs,
        totalMs: Date.now() - totalStart,
      },
      tts: {
        provider: ttsResult.provider,
        model: ttsResult.model,
        voice: ttsResult.voice,
      },
    };
  }

  private extractSpeakableText(assistant: AssistantResponse): string | undefined {
    if (assistant.type === 'clarification') {
      return assistant.clarification?.question;
    }
    return assistant.answer;
  }
}
