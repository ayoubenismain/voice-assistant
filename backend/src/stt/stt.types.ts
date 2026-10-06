/**
 * Phase 8A — Speech-to-Text types.
 *
 * These are the only types shared between SttService and provider implementations.
 * Do not add fields here that cannot be reliably populated by every provider.
 */

/**
 * Supported audio MIME types accepted by SttService.
 * These match the formats Gemini Transcribe can handle.
 */
export const SUPPORTED_AUDIO_MIME_TYPES = new Set([
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/webm',
  'audio/ogg',
  'audio/flac',
  'audio/m4a',
  'audio/mp4',
  'audio/aac',
  'audio/x-m4a',
  'audio/aiff',
  'audio/x-aiff',
]);

/**
 * Input to a transcription call.
 */
export interface SttInput {
  /** Raw audio bytes. */
  audio: Buffer;

  /** IANA MIME type of the audio (e.g. "audio/webm", "audio/wav"). */
  mimeType: string;

  /** Optional original file name — used for logging only, never sent to the API. */
  fileName?: string;
}

/**
 * Result of a successful transcription call.
 * Only fields that Gemini Transcribe actually returns are included.
 */
export interface SttResult {
  /** The transcribed text, with leading/trailing whitespace trimmed. */
  text: string;

  /** Provider identifier (e.g. "gemini"). */
  provider: string;

  /** Model used (e.g. "gemini-3.5-transcribe"). */
  model: string;

  /** Wall-clock time for the transcription call in milliseconds. */
  durationMs: number;
}
