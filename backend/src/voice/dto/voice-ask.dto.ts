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
