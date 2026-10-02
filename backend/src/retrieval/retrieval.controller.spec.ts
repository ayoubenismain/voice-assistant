import { Test, TestingModule } from '@nestjs/testing';
import { RetrievalController } from './retrieval.controller.js';
import { RetrievalService } from './retrieval.service.js';

describe('RetrievalController', () => {
  let controller: RetrievalController;
  let service: RetrievalService;

  beforeEach(async () => {
    const mockService = {
      semanticSearch: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RetrievalController],
      providers: [
        { provide: RetrievalService, useValue: mockService },
      ],
    }).compile();

    controller = module.get<RetrievalController>(RetrievalController);
    service = module.get<RetrievalService>(RetrievalService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate to semanticSearch service', async () => {
    const dto = { query: 'test', topK: 5 };
    const expectedResponse = { results: [] };
    vi.spyOn(service, 'semanticSearch').mockResolvedValue(expectedResponse as any);

    const result = await controller.search(dto);

    expect(service.semanticSearch).toHaveBeenCalledWith(dto);
    expect(result).toBe(expectedResponse);
  });
});
