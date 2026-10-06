import { Injectable, Logger, ServiceUnavailableException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { TtsProvider } from './tts-provider.interface.js';
import { TtsInput, TtsResult } from '../tts.types.js';

@Injectable()
export class GeminiTtsProvider implements TtsProvider {
  private readonly logger = new Logger(GeminiTtsProvider.name);
  private readonly client: GoogleGenAI;
  private readonly defaultModel: string;
  private readonly defaultVoice: string;
  private readonly defaultStyle: string | undefined;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not defined.');
    }

    this.defaultModel = this.configService.get<string>('TTS_MODEL', 'gemini-3.8-flash-lite-tts');
    this.defaultVoice = this.configService.get<string>('TTS_VOICE', 'Kore');
    this.defaultStyle = this.configService.get<string>('TTS_STYLE');
    this.timeoutMs = this.configService.get<number>('TTS_TIMEOUT_MS', 15000);

    // Provide default retry configs directly since we want to disable them
    this.client = new GoogleGenAI({ 
        apiKey,
    });
  }

  async synthesize(input: TtsInput): Promise<TtsResult> {
    const voice = input.voice || this.defaultVoice;
    const style = input.style || this.defaultStyle;

    this.logger.debug(`Starting Gemini TTS synthesis (model=${this.defaultModel}, voice=${voice}, textChars=${input.text.length})`);

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs);

    try {
      const response = await this.client.models.generateContent({
        model: this.defaultModel,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: input.text,
                ...(style && {
                  speechMetadata: {
                    style,
                  }
                }),
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              voice,
            },
          },
          httpOptions: {
            signal: abortController.signal,
          },
        },
      });

      const candidate = response.candidates?.[0];
      const part = candidate?.content?.parts?.[0];
      const inlineData = part?.inlineData;

      if (!inlineData?.data) {
        throw new ServiceUnavailableException('Speech transcription returned an empty result.');
      }

      const audioBuffer = Buffer.from(inlineData.data, 'base64');
      
      // Validate WAV magic bytes: RIFF...WAVE
      if (audioBuffer.length < 12) {
         throw new ServiceUnavailableException('Received audio buffer is too small to be a valid WAV file.');
      }

      const riff = audioBuffer.subarray(0, 4).toString('ascii');
      const wave = audioBuffer.subarray(8, 12).toString('ascii');

      if (riff !== 'RIFF' || wave !== 'WAVE') {
         throw new ServiceUnavailableException('Received audio is not a valid WAV file.');
      }

      return {
        audio: audioBuffer,
        mimeType: 'audio/wav',
        provider: 'gemini',
        model: this.defaultModel,
        voice,
      };
    } catch (error: any) {
      this.logger.error(`Gemini TTS Error: ${error.message}`);
      
      if (error.name === 'AbortError') {
        throw new ServiceUnavailableException('Speech synthesis service is temporarily unavailable.');
      }

      if (error.status === 400 || error.message?.includes('INVALID_ARGUMENT')) {
        throw new BadRequestException('Invalid TTS request parameters.');
      }
      
      if (error.status === 401 || error.message?.includes('UNAUTHENTICATED')) {
        throw new UnauthorizedException('Authentication failed with TTS provider.');
      }

      throw new ServiceUnavailableException('Speech synthesis service is temporarily unavailable.');
    } finally {
      clearTimeout(timeout);
    }
  }
}
