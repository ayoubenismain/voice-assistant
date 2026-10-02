import { Test, TestingModule } from '@nestjs/testing';
import { AssistantService } from './assistant.service.js';
import { ConfigService } from '@nestjs/config';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import { LlmService } from '../llm/llm.service.js';
import { RagContextBuilderService } from '../rag/rag-context-builder.service.js';
import { RagPromptBuilderService } from '../rag/rag-prompt-builder.service.js';

describe('AssistantService', () => {
  let service: AssistantService;
  let retrievalService: Partial<RetrievalService>;
  let llmService: Partial<LlmService>;
  let ragContextBuilder: Partial<RagContextBuilderService>;
  let ragPromptBuilder: Partial<RagPromptBuilderService>;

  beforeEach(async () => {
    retrievalService = {
      semanticSearch: vi.fn().mockResolvedValue({
        retrieval: { strategy: 'hybrid_rrf', detectedIntents: [] },
        results: [
          {
            rank: 1,
            similarity: 0.9,
            chunk: {
              id: 'c1',
              chunkIndex: 0,
              content: 'Test content 1',
              sectionTitle: null,
              pageStart: 1,
              pageEnd: 1,
            },
            document: { id: 'd1', title: 'Doc 1', source: 'ISSATSO', category: 'General', academicYear: '2026' }
          }
        ]
      })
    };

    llmService = {
      generateStructuredResponse: vi.fn().mockResolvedValue({
        type: 'answer',
        answer: 'Test answer',
        clarificationQuestion: null,
        clarificationOptions: [],
        usedSourceIds: ['S1']
      })
    };

    ragContextBuilder = {
      buildContext: vi.fn().mockReturnValue({
        formattedContext: 'Formatted',
        sources: [
          { sourceId: 'S1', documentId: 'd1', title: 'Doc 1', source: 'ISSATSO', category: 'General', academicYear: '2026', sectionTitle: 'N/A', pageStart: 1, pageEnd: 1, content: 'Test content 1' }
        ]
      })
    };

    ragPromptBuilder = {
      buildMessages: vi.fn().mockReturnValue([])
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssistantService,
        {
          provide: ConfigService,
          useValue: { get: vi.fn().mockReturnValue(8) }
        },
        { provide: RetrievalService, useValue: retrievalService },
        { provide: LlmService, useValue: llmService },
        { provide: RagContextBuilderService, useValue: ragContextBuilder },
        { provide: RagPromptBuilderService, useValue: ragPromptBuilder }
      ],
    }).compile();

    service = module.get<AssistantService>(AssistantService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return an answer and validate source IDs', async () => {
    const res = await service.ask({ query: 'test query' });
    expect(res.type).toBe('answer');
    expect(res.answer).toBe('Test answer');
    expect(res.sources).toHaveLength(1);
    expect(res.sources[0].sourceId).toBe('S1');
  });

  it('should return no_verified_info if LLM hallucinates an invalid source ID', async () => {
    llmService.generateStructuredResponse = vi.fn().mockResolvedValue({
      type: 'answer',
      answer: 'Test answer',
      clarificationQuestion: null,
      clarificationOptions: [],
      usedSourceIds: ['S99'] // invalid source
    });

    const res = await service.ask({ query: 'test query' });
    expect(res.type).toBe('no_verified_info');
    expect(res.answer).toContain('Je n\'ai pas trouvé d\'information vérifiée');
    expect(res.sources).toHaveLength(0);
  });

  it('should fast-fail and return no_verified_info if retrieval yields no results', async () => {
    ragContextBuilder.buildContext = vi.fn().mockReturnValue({
      formattedContext: '',
      sources: []
    });

    const res = await service.ask({ query: 'test empty query' });
    expect(res.type).toBe('no_verified_info');
    expect(llmService.generateStructuredResponse).not.toHaveBeenCalled();
  });
});
