export type StructuredAnswerType = 'answer' | 'clarification' | 'no_verified_info';

export interface StructuredLlmResponse {
  type: StructuredAnswerType;
  answer: string | null;
  clarificationQuestion: string | null;
  clarificationOptions: string[];
  usedSourceIds: string[];
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmGenerationOptions {
  temperature?: number;
  timeoutMs?: number;
}
