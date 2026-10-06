export interface TtsInput {
  text: string;
  style?: string;
  voice?: string;
}

export interface TtsResult {
  audio: Buffer;
  mimeType: 'audio/wav';
  provider: string;
  model: string;
  voice: string;
}
