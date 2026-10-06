import { AssistantResponse } from '../../assistant/types/assistant.types.js';

export interface VoiceTiming {
  sttMs: number;
  assistantMs: number;
  totalMs: number;
}

export interface VoiceAskResponseDto {
  transcript: string;
  assistant: AssistantResponse;
  timing: VoiceTiming;
}

export interface VoiceRespondResult {
  audio: Buffer;
  mimeType: 'audio/wav';
  transcript: string;
  assistant: AssistantResponse;
  timing: {
    sttMs: number;
    assistantMs: number;
    ttsMs: number;
    totalMs: number;
  };
  tts: {
    provider: string;
    model: string;
    voice: string;
  };
}
