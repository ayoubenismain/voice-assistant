import type { SttInput, SttResult } from '../stt.types.js';

/**
 * Abstraction over a speech-to-text backend.
 *
 * Implementing this interface allows SttService to swap between:
 *   - Gemini 3.5 Transcribe  (Phase 8A — initial implementation)
 *   - Groq Whisper            (future)
 *   - Local Whisper           (future)
 *
 * Implementations MUST:
 *   - throw BadRequestException for invalid / unsupported input
 *   - throw UnauthorizedException for auth / API key failures
 *   - throw ServiceUnavailableException for transient / timeout failures
 *   - never expose raw API keys or auth tokens in thrown messages
 *   - enforce their own hard timeout — never hang indefinitely
 */
export interface SttProvider {
  transcribe(input: SttInput): Promise<SttResult>;
}
