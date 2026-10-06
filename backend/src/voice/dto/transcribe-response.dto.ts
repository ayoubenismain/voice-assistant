/**
 * Phase 8B — Voice transcription response DTO.
 *
 * Public-facing shape returned by POST /api/voice/transcribe.
 * Only safe, non-sensitive fields are included here.
 */

/** Default (non-debug) response from the transcription endpoint. */
export interface TranscribeResponseDto {
  /** The transcribed text from the audio clip. */
  text: string;
}

/** Optional debug metadata (only present when ?debug=true). */
export interface TranscribeDebugMetadata {
  provider: string;
  model: string;
  mimeType: string;
  bytes: number;
  sttMs: number;
}

/** Full response shape when debug=true is requested. */
export interface TranscribeDebugResponseDto extends TranscribeResponseDto {
  debug: TranscribeDebugMetadata;
}
