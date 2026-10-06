import { Test, TestingModule } from '@nestjs/testing';
import { VoiceService } from './voice.service.js';
import { SttService } from '../stt/stt.service.js';
import { AssistantService } from '../assistant/assistant.service.js';
import { AssistantResponse } from '../assistant/types/assistant.types.js';
import { SttResult } from '../stt/stt.types.js';
import { ServiceUnavailableException } from '@nestjs/common';

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

describe('VoiceService', () => {
  let service: VoiceService;
  let sttServiceMock: { transcribe: ReturnType<typeof vi.fn> };
  let assistantServiceMock: { ask: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    sttServiceMock = {
      transcribe: vi.fn().mockResolvedValue(MOCK_STT_RESULT),
    };

    assistantServiceMock = {
      ask: vi.fn().mockResolvedValue(MOCK_ASSISTANT_RESULT),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceService,
        { provide: SttService, useValue: sttServiceMock },
        { provide: AssistantService, useValue: assistantServiceMock },
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
});
