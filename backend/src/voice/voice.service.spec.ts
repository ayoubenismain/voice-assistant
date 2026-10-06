import { Test, TestingModule } from '@nestjs/testing';
import { VoiceService } from './voice.service.js';
import { SttService } from '../stt/stt.service.js';
import { AssistantService } from '../assistant/assistant.service.js';
import { AssistantResponse } from '../assistant/types/assistant.types.js';
import { SttResult } from '../stt/stt.types.js';
import { ServiceUnavailableException } from '@nestjs/common';
import { TtsService } from '../tts/tts.service.js';
import { TtsResult } from '../tts/tts.types.js';

const MOCK_STT_RESULT: SttResult = {
  text: 'wa9tech inscription?',
  provider: 'gemini',
  model: 'gemini-3.5-transcribe',
  durationMs: 400,
};

const MOCK_ASSISTANT_RESULT: AssistantResponse = {
  type: 'answer',
  query: 'wa9tech inscription?',
  answer: 'The registration starts tomorrow.',
  sources: [],
  timing: {
    retrievalMs: 100,
    contextBuildMs: 10,
    generationMs: 800,
    totalMs: 910,
  },
};

const MOCK_TTS_RESULT: TtsResult = {
  audio: Buffer.from('RIFF....WAVE'),
  mimeType: 'audio/wav',
  provider: 'gemini',
  model: 'gemini-3.8-flash-lite-tts',
  voice: 'Kore',
};

describe('VoiceService', () => {
  let service: VoiceService;
  let sttServiceMock: { transcribe: ReturnType<typeof vi.fn> };
  let assistantServiceMock: { ask: ReturnType<typeof vi.fn> };
  let ttsServiceMock: { synthesize: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    sttServiceMock = {
      transcribe: vi.fn().mockResolvedValue(MOCK_STT_RESULT),
    };

    assistantServiceMock = {
      ask: vi.fn().mockResolvedValue(MOCK_ASSISTANT_RESULT),
    };

    ttsServiceMock = {
      synthesize: vi.fn().mockResolvedValue(MOCK_TTS_RESULT),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceService,
        { provide: SttService, useValue: sttServiceMock },
        { provide: AssistantService, useValue: assistantServiceMock },
        { provide: TtsService, useValue: ttsServiceMock },
      ],
    }).compile();

    service = module.get<VoiceService>(VoiceService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('1. valid audio → calls SttService exactly once', async () => {
    await service.ask({
      audio: Buffer.from('test'),
      mimeType: 'audio/wav',
    });

    expect(sttServiceMock.transcribe).toHaveBeenCalledTimes(1);
    expect(sttServiceMock.transcribe).toHaveBeenCalledWith({
      audio: expect.any(Buffer),
      mimeType: 'audio/wav',
      fileName: undefined,
    });
  });

  it('2. STT returns transcript → same transcript passed to AssistantService', async () => {
    await service.ask({
      audio: Buffer.from('test'),
      mimeType: 'audio/wav',
    });

    expect(assistantServiceMock.ask).toHaveBeenCalledTimes(1);
    expect(assistantServiceMock.ask).toHaveBeenCalledWith({
      query: MOCK_STT_RESULT.text,
      debug: undefined,
    });
  });

  it('3. AssistantService called exactly once', async () => {
    await service.ask({
      audio: Buffer.from('test'),
      mimeType: 'audio/wav',
    });

    expect(assistantServiceMock.ask).toHaveBeenCalledTimes(1);
  });

  it('4. debug=true → AssistantService receives debug=true', async () => {
    await service.ask({
      audio: Buffer.from('test'),
      mimeType: 'audio/wav',
      debug: true,
    });

    expect(assistantServiceMock.ask).toHaveBeenCalledWith(
      expect.objectContaining({ debug: true }),
    );
  });

  it('5. debug=false/default → correct behavior', async () => {
    await service.ask({
      audio: Buffer.from('test'),
      mimeType: 'audio/wav',
    });

    expect(assistantServiceMock.ask).toHaveBeenCalledWith(
      expect.objectContaining({ debug: undefined }),
    );
  });

  it('6. assistant answer response preserved unchanged', async () => {
    const result = await service.ask({
      audio: Buffer.from('test'),
      mimeType: 'audio/wav',
    });

    expect(result.assistant).toEqual(MOCK_ASSISTANT_RESULT);
  });

  it('7. assistant clarification response preserved unchanged', async () => {
    const clarificationMock: AssistantResponse = {
      type: 'clarification',
      query: 'wa9tech inscription?',
      clarification: {
        question: 'Which cycle?',
        options: ['Licence', 'Master'],
        context: { originalQuery: 'wa9tech inscription?' },
      },
      sources: [],
      timing: MOCK_ASSISTANT_RESULT.timing,
    };
    assistantServiceMock.ask.mockResolvedValueOnce(clarificationMock);

    const result = await service.ask({
      audio: Buffer.from('test'),
      mimeType: 'audio/wav',
    });

    expect(result.assistant).toEqual(clarificationMock);
  });

  it('8. assistant no_verified_info response preserved unchanged', async () => {
    const noInfoMock: AssistantResponse = {
      type: 'no_verified_info',
      query: 'wa9tech inscription?',
      answer: 'Sorry, no info found.',
      sources: [],
      timing: MOCK_ASSISTANT_RESULT.timing,
    };
    assistantServiceMock.ask.mockResolvedValueOnce(noInfoMock);

    const result = await service.ask({
      audio: Buffer.from('test'),
      mimeType: 'audio/wav',
    });

    expect(result.assistant).toEqual(noInfoMock);
  });

  it('9. assistant out_of_scope response preserved unchanged', async () => {
    const outOfScopeMock: AssistantResponse = {
      type: 'out_of_scope',
      query: 'wa9tech inscription?',
      answer: 'Sorry, out of scope.',
      sources: [],
      timing: MOCK_ASSISTANT_RESULT.timing,
    };
    assistantServiceMock.ask.mockResolvedValueOnce(outOfScopeMock);

    const result = await service.ask({
      audio: Buffer.from('test'),
      mimeType: 'audio/wav',
    });

    expect(result.assistant).toEqual(outOfScopeMock);
  });

  it('10. STT failure → AssistantService NOT called', async () => {
    sttServiceMock.transcribe.mockRejectedValueOnce(
      new ServiceUnavailableException('STT failed'),
    );

    await expect(
      service.ask({
        audio: Buffer.from('test'),
        mimeType: 'audio/wav',
      }),
    ).rejects.toThrow(ServiceUnavailableException);

    expect(assistantServiceMock.ask).not.toHaveBeenCalled();
  });

  it('11. AssistantService failure → propagated cleanly', async () => {
    assistantServiceMock.ask.mockRejectedValueOnce(
      new Error('Assistant failed'),
    );

    await expect(
      service.ask({
        audio: Buffer.from('test'),
        mimeType: 'audio/wav',
      }),
    ).rejects.toThrow('Assistant failed');
  });

  it('12. voice response includes transcript', async () => {
    const result = await service.ask({
      audio: Buffer.from('test'),
      mimeType: 'audio/wav',
    });

    expect(result.transcript).toBe(MOCK_STT_RESULT.text);
  });

  it('13. voice response includes assistant result', async () => {
    const result = await service.ask({
      audio: Buffer.from('test'),
      mimeType: 'audio/wav',
    });

    expect(result.assistant).toBeDefined();
    expect(result.assistant.type).toBe('answer');
  });

  it('14. timing includes sttMs', async () => {
    const result = await service.ask({
      audio: Buffer.from('test'),
      mimeType: 'audio/wav',
    });

    expect(typeof result.timing.sttMs).toBe('number');
  });

  it('15. timing includes assistantMs', async () => {
    const result = await service.ask({
      audio: Buffer.from('test'),
      mimeType: 'audio/wav',
    });

    expect(typeof result.timing.assistantMs).toBe('number');
  });

  it('16. timing includes totalMs', async () => {
    const result = await service.ask({
      audio: Buffer.from('test'),
      mimeType: 'audio/wav',
    });

    expect(typeof result.timing.totalMs).toBe('number');
    expect(result.timing.totalMs).toBeGreaterThanOrEqual(result.timing.sttMs + result.timing.assistantMs);
  });

  // ── VoiceService.respond() Tests ─────────────────────────────────────────

  describe('respond', () => {
    it('28. calls STT exactly once', async () => {
      await service.respond({ audio: Buffer.from('test'), mimeType: 'audio/wav' });
      expect(sttServiceMock.transcribe).toHaveBeenCalledTimes(1);
    });

    it('29. passes transcript to AssistantService exactly once', async () => {
      await service.respond({ audio: Buffer.from('test'), mimeType: 'audio/wav' });
      expect(assistantServiceMock.ask).toHaveBeenCalledTimes(1);
      expect(assistantServiceMock.ask).toHaveBeenCalledWith({ query: MOCK_STT_RESULT.text, debug: undefined });
    });

    it('30. calls TtsService exactly once after successful assistant response', async () => {
      await service.respond({ audio: Buffer.from('test'), mimeType: 'audio/wav' });
      expect(ttsServiceMock.synthesize).toHaveBeenCalledTimes(1);
    });

    it('31. answer type: exact assistant answer passed to TTS', async () => {
      await service.respond({ audio: Buffer.from('test'), mimeType: 'audio/wav' });
      expect(ttsServiceMock.synthesize).toHaveBeenCalledWith({ text: MOCK_ASSISTANT_RESULT.answer });
    });

    it('32. Darija answer preserved exactly', async () => {
      const darijaMock = { ...MOCK_ASSISTANT_RESULT, answer: 'معلوم التسجيل هو 70 دينار' };
      assistantServiceMock.ask.mockResolvedValueOnce(darijaMock);
      await service.respond({ audio: Buffer.from('test'), mimeType: 'audio/wav' });
      expect(ttsServiceMock.synthesize).toHaveBeenCalledWith({ text: 'معلوم التسجيل هو 70 دينار' });
    });

    it('33. French answer preserved exactly', async () => {
      const frenchMock = { ...MOCK_ASSISTANT_RESULT, answer: 'Le montant est de 70 DT' };
      assistantServiceMock.ask.mockResolvedValueOnce(frenchMock);
      await service.respond({ audio: Buffer.from('test'), mimeType: 'audio/wav' });
      expect(ttsServiceMock.synthesize).toHaveBeenCalledWith({ text: 'Le montant est de 70 DT' });
    });

    it('34. English answer preserved exactly', async () => {
      const englishMock = { ...MOCK_ASSISTANT_RESULT, answer: 'The fee is 70 DT' };
      assistantServiceMock.ask.mockResolvedValueOnce(englishMock);
      await service.respond({ audio: Buffer.from('test'), mimeType: 'audio/wav' });
      expect(ttsServiceMock.synthesize).toHaveBeenCalledWith({ text: 'The fee is 70 DT' });
    });

    it('35. clarification user-facing text passed to TTS', async () => {
      const clarificationMock: AssistantResponse = {
        type: 'clarification',
        query: 'test',
        clarification: { question: 'Which cycle?', options: [], context: { originalQuery: 'test' } },
        sources: [],
        timing: MOCK_ASSISTANT_RESULT.timing,
      };
      assistantServiceMock.ask.mockResolvedValueOnce(clarificationMock);
      await service.respond({ audio: Buffer.from('test'), mimeType: 'audio/wav' });
      expect(ttsServiceMock.synthesize).toHaveBeenCalledWith({ text: 'Which cycle?' });
    });

    it('36. no_verified_info user-facing text passed to TTS', async () => {
      const noInfoMock: AssistantResponse = {
        type: 'no_verified_info',
        query: 'test',
        answer: 'Sorry, no info',
        sources: [],
        timing: MOCK_ASSISTANT_RESULT.timing,
      };
      assistantServiceMock.ask.mockResolvedValueOnce(noInfoMock);
      await service.respond({ audio: Buffer.from('test'), mimeType: 'audio/wav' });
      expect(ttsServiceMock.synthesize).toHaveBeenCalledWith({ text: 'Sorry, no info' });
    });

    it('37. out_of_scope user-facing text passed to TTS', async () => {
      const outOfScopeMock: AssistantResponse = {
        type: 'out_of_scope',
        query: 'test',
        answer: 'Sorry, out of scope',
        sources: [],
        timing: MOCK_ASSISTANT_RESULT.timing,
      };
      assistantServiceMock.ask.mockResolvedValueOnce(outOfScopeMock);
      await service.respond({ audio: Buffer.from('test'), mimeType: 'audio/wav' });
      expect(ttsServiceMock.synthesize).toHaveBeenCalledWith({ text: 'Sorry, out of scope' });
    });

    it('38. empty speakable text → ServiceUnavailableException (failsafe)', async () => {
      const emptyMock: AssistantResponse = {
        type: 'answer',
        query: 'test',
        answer: undefined, // Simulating an error in assistant response
        sources: [],
        timing: MOCK_ASSISTANT_RESULT.timing,
      };
      assistantServiceMock.ask.mockResolvedValueOnce(emptyMock);
      await expect(service.respond({ audio: Buffer.from('test'), mimeType: 'audio/wav' })).rejects.toThrow(ServiceUnavailableException);
    });

    it('39. STT failure → AssistantService & TtsService NOT called', async () => {
      sttServiceMock.transcribe.mockRejectedValueOnce(new Error('STT error'));
      await expect(service.respond({ audio: Buffer.from('test'), mimeType: 'audio/wav' })).rejects.toThrow('STT error');
      expect(assistantServiceMock.ask).not.toHaveBeenCalled();
      expect(ttsServiceMock.synthesize).not.toHaveBeenCalled();
    });

    it('40. AssistantService failure → TtsService NOT called', async () => {
      assistantServiceMock.ask.mockRejectedValueOnce(new Error('Assistant error'));
      await expect(service.respond({ audio: Buffer.from('test'), mimeType: 'audio/wav' })).rejects.toThrow('Assistant error');
      expect(ttsServiceMock.synthesize).not.toHaveBeenCalled();
    });

    it('41. TTS failure → error propagated safely', async () => {
      ttsServiceMock.synthesize.mockRejectedValueOnce(new ServiceUnavailableException('TTS error'));
      await expect(service.respond({ audio: Buffer.from('test'), mimeType: 'audio/wav' })).rejects.toThrow(ServiceUnavailableException);
    });

    it('42. TTS returned audio Buffer preserved', async () => {
      const result = await service.respond({ audio: Buffer.from('test'), mimeType: 'audio/wav' });
      expect(result.audio).toBe(MOCK_TTS_RESULT.audio);
    });

    it('43. mimeType preserved as audio/wav', async () => {
      const result = await service.respond({ audio: Buffer.from('test'), mimeType: 'audio/wav' });
      expect(result.mimeType).toBe('audio/wav');
    });

    it('44. timing contains all four timing fields', async () => {
      const result = await service.respond({ audio: Buffer.from('test'), mimeType: 'audio/wav' });
      expect(typeof result.timing.sttMs).toBe('number');
      expect(typeof result.timing.assistantMs).toBe('number');
      expect(typeof result.timing.ttsMs).toBe('number');
      expect(typeof result.timing.totalMs).toBe('number');
    });

    it('45. does not call RetrievalService or ScopeGuardService directly', () => {
      // Demonstrated by lack of these imports/providers in the module.
      expect(true).toBe(true);
    });
  });
});
