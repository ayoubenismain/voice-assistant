import { RetrievalService } from './retrieval.service.js';
import { SemanticSearchDto } from './dto/semantic-search.dto.js';
import { SemanticSearchResponse } from './types/retrieval-result.type.js';
export declare class RetrievalController {
    private readonly retrievalService;
    constructor(retrievalService: RetrievalService);
    search(dto: SemanticSearchDto): Promise<SemanticSearchResponse>;
}
