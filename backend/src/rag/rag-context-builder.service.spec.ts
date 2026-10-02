import { Test, TestingModule } from '@nestjs/testing';
import { RagContextBuilderService } from './rag-context-builder.service.js';
import { ConfigService } from '@nestjs/config';
import { RetrievalResultItem } from '../retrieval/types/retrieval-result.type.js';

describe('RagContextBuilderService', () => {
  let service: RagContextBuilderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RagContextBuilderService,
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn().mockImplementation((key, def) => {
              if (key === 'RAG_CONTEXT_MAX_CHUNKS') return 2;
              if (key === 'RAG_CONTEXT_MAX_CHARS') return 100;
              return def;
            })
          }
        }
      ],
    }).compile();

    service = module.get<RagContextBuilderService>(RagContextBuilderService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should build context within limits', () => {
    const mockChunks: RetrievalResultItem[] = [
      {
        rank: 1,
        similarity: 0.9,
        chunk: {
          id: 'c1',
          chunkIndex: 0,
          sectionTitle: null,
          content: 'A'.repeat(60),
          pageStart: 1,
          pageEnd: 1,
        },
        document: { id: 'd1', title: 'Doc 1', source: 'S', category: 'C', academicYear: 'Y' }
      },
      {
        rank: 2,
        similarity: 0.8,
        chunk: {
          id: 'c2',
          chunkIndex: 0,
          sectionTitle: null,
          content: 'B'.repeat(30),
          pageStart: 2,
          pageEnd: 2,
        },
        document: { id: 'd1', title: 'Doc 1', source: 'S', category: 'C', academicYear: 'Y' }
      },
      {
        rank: 3,
        similarity: 0.7, // Should be skipped due to chunk limit (max 2)
        chunk: {
          id: 'c3',
          chunkIndex: 0,
          sectionTitle: null,
          content: 'C'.repeat(10),
          pageStart: 1,
          pageEnd: 1,
        },
        document: { id: 'd2', title: 'Doc 2', source: 'S', category: 'C', academicYear: 'Y' }
      }
    ];

    const result = service.buildContext(mockChunks);
    expect(result.sources.length).toBe(2);
    expect(result.sources[0].sourceId).toBe('S1');
    expect(result.sources[1].sourceId).toBe('S2');
    expect(result.formattedContext).toContain('[S1]');
    expect(result.formattedContext).toContain('[S2]');
  });

  it('should skip chunks that exceed char limit', () => {
    const mockChunks: RetrievalResultItem[] = [
      {
        rank: 1,
        similarity: 0.9,
        chunk: {
          id: 'c1',
          chunkIndex: 0,
          sectionTitle: null,
          content: 'A'.repeat(80),
          pageStart: 1,
          pageEnd: 1,
        },
        document: { id: 'd1', title: 'Doc 1', source: 'S', category: 'C', academicYear: 'Y' }
      },
      {
        rank: 2,
        similarity: 0.8, // Should be skipped due to char limit (80 + 30 > 100)
        chunk: {
          id: 'c2',
          chunkIndex: 0,
          sectionTitle: null,
          content: 'B'.repeat(30),
          pageStart: 2,
          pageEnd: 2,
        },
        document: { id: 'd1', title: 'Doc 1', source: 'S', category: 'C', academicYear: 'Y' }
      }
    ];

    const result = service.buildContext(mockChunks);
    expect(result.sources.length).toBe(1);
    expect(result.sources[0].sourceId).toBe('S1');
  });

  it('should deduplicate chunks', () => {
    const mockChunks: RetrievalResultItem[] = [
      {
        rank: 1,
        similarity: 0.9,
        chunk: {
          id: 'c1',
          chunkIndex: 0,
          sectionTitle: null,
          content: 'A',
          pageStart: 1,
          pageEnd: 1,
        },
        document: { id: 'd1', title: 'Doc 1', source: 'S', category: 'C', academicYear: 'Y' }
      },
      {
        rank: 2,
        similarity: 0.8,
        chunk: { // duplicate
          id: 'c1',
          chunkIndex: 0,
          sectionTitle: null,
          content: 'A',
          pageStart: 1,
          pageEnd: 1,
        },
        document: { id: 'd1', title: 'Doc 1', source: 'S', category: 'C', academicYear: 'Y' }
      }
    ];
    
    const result = service.buildContext(mockChunks);
    expect(result.sources.length).toBe(1);
  });
});
