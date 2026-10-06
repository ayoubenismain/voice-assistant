import { TtsInput, TtsResult } from '../tts.types.js';

export interface TtsProvider {
  synthesize(input: TtsInput): Promise<TtsResult>;
}
